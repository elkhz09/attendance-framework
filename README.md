# attendance-framework

A daily attendance and readiness tracker built on Google Apps Script, Telegram
and a Google Sheet. Person-keyed, so staff rotation does not quietly corrupt the
record.

Free to run. No server, no database, no hosting bill. The sheet stays a sheet, so
the people who already work in it keep working in it.

## The problem

A roll-call across roughly 130 people, done by hand, costs somebody their
morning. The usual shape of it:

Each section lead asks their own people. Some answer, some do not. The lead
chases the rest. Someone collates the answers into a spreadsheet, usually by
reading them off a chat thread and typing them in. By the time the muster starts,
the number is ten minutes old and nobody is confident in it. The list of people
still unaccounted for exists only in the collator's head.

None of that is hard. All of it is daily, and it absorbs attention that the
morning needs for other things.

## What it does

A scheduled prompt goes out to each person. They answer with one tap. The answer
lands in the month sheet directly, in that person's row, in that day's column.

At the muster, an admin sends `/outstanding` and gets the short list of people
who have not answered yet, grouped the way the organisation is grouped. People on
recorded leave are not prompted and are not on the list, because chasing someone
who is on leave is how a list stops being read.

That is the whole product. The interesting part is underneath it.

## What actually changes

- The prompt goes out to everyone, on schedule, whether or not anyone remembers
  to send it.
- Replies arrive in the sheet without a human transcription step.
- The morning question changes from "has everyone answered" to "who has not",
  which is a list rather than a conversation.
- Leave is recorded once in advance instead of being remembered each morning.
- Role changes stop damaging history. More on that below.

## The design decision that matters

The obvious way to build this is to key it on the thing you read out at the
muster: the role, the post, the job title. It works for a month. Then it rots.

When the person holding a role changes, every past row filed under that role
silently becomes a record about somebody else. You cannot see from the data that
it happened. You cannot repair it afterwards without knowledge that lives outside
the system. And it gets worse the longer the system runs, which is the opposite
of what you want from a record.

So a person gets a `person_id` on the day they join, keeps it until the records
are deleted, and never has it reused. Name, role and grouping are snapshots that
can all change without touching a single historical row. The month sheet stores
the id as the key and the name and role as frozen display copies, so a sheet read
a year later shows who those people were at the time, not who holds those roles
now.

Everything else follows from that:

- Leaving is a status change plus an audit row, never a deletion.
- A temporary detachment is a third status, not a departure. The two need
  opposite treatment, and conflating them means a detached person is either
  chased every morning or dropped from the roster and lost.
- The Telegram account is a link, not an identity. People change accounts.

There is a roster ledger tab separate from the month tabs, so people persist
across months and the rollover is a copy of the roster rather than a copy of last
month's sheet. Last month's sheet has last month's mistakes in it.

## Features

- Scheduled daily prompt with inline buttons, per person.
- Reply capture into a month sheet, one row per person, one column per day.
- Roster ledger: join, link account, change role, change grouping, detach,
  reattach, leave. Every mutation writes an audit row.
- Planned absence by date range, which suppresses the prompt and marks the day
  cells so a blank cell always means "no reply".
- Admin commands: daily summary, outstanding list, manual send, broadcast with a
  preview and a confirmation, roster lifecycle, health check.
- Month rollover that carries the roster forward and hides old tabs rather than
  deleting or splitting them.
- Self-test for the parts that can be checked without a spreadsheet.

## Getting started

- [docs/SETUP.md](docs/SETUP.md) — spreadsheet, bot, `clasp`, first roster.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — the deploy discipline, and why the
  webhook secret is a query parameter.
- [docs/SHEET_SCHEMA.md](docs/SHEET_SCHEMA.md) — every tab, with a worked example.
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — the daily loop, and what will bite.

```
src/
  Main.js          web app entry points, webhook auth
  Commands.js      command registry and router
  Flows.js         multi-step flows, button callbacks
  Prompt.js        the scheduled send
  Attendance.js    month tabs, reply capture, summaries
  Roster.js        the identity spine
  Absence.js       planned absence
  Rollover.js      month rollover and housekeeping
  State.js         conversation state with a TTL
  Sheets.js        header-name sheet access
  Dates.js         parsing and locale-proof writing
  Locks.js         read-modify-write locking
  Telegram.js      transport, chunking, guarded fetch
  Setup.js         one-time setup, run from the editor
  SelfTest.js      checks for the pure functions
```

## What this got wrong first

The architecture above is the second version of my thinking. Each item here cost
something to learn, and the code carries a comment at the site of each one.

**One blocked recipient killed the whole broadcast.**
`UrlFetchApp.fetch` throws on any non-2xx response. Telegram returns 403 for a
user who has blocked the bot, which is an entirely ordinary thing for a person to
do. Without `muteHttpExceptions: true`, that single 403 threw, the broadcast loop
died, and everyone further down the roster got nothing. Because the loop skips
people who have already replied, the row that happened to be first-and-blocked
moved from day to day, so the symptom presented as "the prompt randomly doesn't
reach some people". It was not random. It was one unguarded fetch. Every outbound
call is now muted and returns a result object, and failures are collected and
reported rather than thrown.

**Half the system was running old code and nothing said so.**
Apps Script executes triggers from HEAD and the web app from the pinned
deployment. I pushed fixes for weeks and the interactive path, which is every
command anyone types, stayed frozen on an old version. There is no version
mismatch warning anywhere. Push and redeploy are now one step in the docs, with
the rollback command written down next to it.

**A spreadsheet silently transposed every date it was given.**
User-typed `01/08/2026` written straight into a cell on a sheet with a US locale
becomes the 8th of January. Nothing errors. The cell looks plausible. You find
out months later when a date range is wrong, and by then you cannot tell the
correct rows from the broken ones. Dates are now parsed in code, written as real
`Date` objects with an explicit number format, and a string that cannot be read
with certainty is refused rather than guessed at. Including `31/04`, which
otherwise rolls over into May without complaint.

**Two triggers meant two prompts.**
A trigger created by hand in the Triggers panel leaves no trace in the code, so
it is easy to end up with two and hard to notice. Scheduled sends now take an
atomic once-per-day claim under a lock. The setup function also deletes its own
duplicates before installing.

**A trigger argument quietly inverted a guard.**
A time-driven trigger calls its function with an event object as the first
argument. My function was declared `sendDailyPrompt(force)`, so every scheduled
run arrived with `force` set to a truthy object and bypassed the weekend skip. It
only misbehaved on the scheduled path, which is the one you cannot easily watch.
Only the literal `true` counts as a force now.

**Abandoned conversations swallowed unrelated messages.**
A half-finished multi-step flow with no expiry sits there forever. The person's
next message, whenever it comes, gets read as an answer to a question they have
long forgotten. Flows now carry a TTL, `/cancel` is always available, and any
slash command abandons an open flow instead of being eaten by it.

**Long reports stopped arriving instead of arriving truncated.**
Telegram's 4096-character limit rejects the whole message. A report that grows
past the cap does not lose its tail, it fails. Reports are chunked on line
boundaries now, and the chunker is one of the two things the self-test covers.

**A race lost replies.**
Concurrent executions both read "no reply yet" and wrote. Read-modify-write is
locked now. Apps Script locks are not reentrant, which is easy to trip over
because the helper that takes the lock is usually the convenient one to call, so
the wrapper detects reentrancy and throws a named error rather than failing
intermittently under load.

**"Saved" was reported before the write landed.**
Sheet writes are batched and may still be pending when a function returns. For an
attendance system that is the worst available failure, because the person
believes they have answered. `SpreadsheetApp.flush()` now runs before any success
message.

The pattern across all of these is the same. Every one presented as intermittent
or random, and every one had a specific, findable mechanism. None of them were
caught by reading the code, and most were found by somebody using the thing on
their phone.

## What this is not

- Not a leave management or HR system. Absence here exists only to suppress the
  prompt and mark the sheet.
- Not multi-tenant. One spreadsheet, one organisation, one bot.
- Not realtime. Apps Script time triggers are best-effort and fire within the
  hour. If a message must land at an exact minute, drive it from an external
  scheduler and keep the trigger as the idempotent backup.
- Not a place for sensitive data. It is a Google Sheet, and the webhook is a
  public URL with a secret in it. Names, roles and a daily status, and nothing
  that would matter if the sheet were shared with the wrong person.
- Not tested in the way server code can be. Apps Script has no test runner. The
  self-test covers the pure functions and the rest is checked against a copy of
  the spreadsheet with a second bot.

## Status

Clean-room implementation of an architecture that runs in production with a
roughly 130-person operational unit. This repository is generic by design and
shares no code with that deployment. The lessons above are from it; the code here
was written from scratch.

The deployment it is drawn from is not described here beyond that. No
organisation, identifiers, configuration or operational detail from it appears
in this repository, and none will. What is published is the architecture and the
failure modes, both of which generalise to any organisation running a daily
roll-call.

Issues and pull requests welcome. If you are adapting it for your own
organisation, the three things to change first are `CONFIG.RESPONSES`,
`GROUP_LABEL` and `SUBGROUP_LABEL`.

## Licence

MIT. See [LICENSE](LICENSE).
