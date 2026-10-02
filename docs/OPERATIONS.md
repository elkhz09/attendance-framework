# Operations

Day-to-day running, and the handful of things that will bite.

## The daily loop

| When | What |
|---|---|
| `PROMPT_HOUR` | Month tab created if needed, planned absences written as `AWAY`, prompt sent to everyone `ACTIVE` and not away |
| During the morning | Replies land in the day column as people tap |
| At the muster | `/outstanding` — the short list of people who have not answered |
| Any time | `/summary` — counts for a day, plus the outstanding list |

The number that matters is the length of the outstanding list. If it is long
every morning, something is wrong with delivery or with linking, not with the
people. Run `/health`.

## Lifecycle

| Event | Command | What happens |
|---|---|---|
| Person joins | `/join` | New `person_id`, roster row, month tab row |
| Account linked | `/link P0001 000000001` | `telegram_user_id` set, history row written |
| Role changes | `/setrole P0001 Role B` | Snapshot updated; no historical row moves |
| Temporary detachment | `/detach P0001` | Status `DETACHED`, off the prompt, stays on the roster |
| Returns | `/attach P0001` | Status `ACTIVE` |
| Leaves for good | `/leave P0001` | Status `DEPARTED`, `left_on` stamped, nothing deleted |

Nothing in that table deletes anything. If you find yourself wanting to delete a
person to make the sheet tidy, the answer is `/leave` and `VISIBLE_MONTHS`.

## Absence

A person records their own:

```
/away LEAVE 03/11/2026 07/11/2026 home
```

Kinds are `LEAVE`, `OFFSITE`, `COURSE`, `MEDICAL`. Dates are `dd/mm/yyyy` and a
date that does not exist is refused rather than guessed at, so `31/04/2026` comes
back as an error.

They are not prompted on those days, and the day cells read `AWAY` rather than
being blank. That distinction is the reason the outstanding list is short enough
to be read.

## Month rollover

Runs on the 1st, an hour before the prompt. It creates the month tab from the
current roster, carrying `ACTIVE` and `DETACHED` forward and leaving `DEPARTED`
behind, then hides month tabs older than `VISIBLE_MONTHS`.

Hidden, not deleted, and not moved to a second workbook. A second workbook sounds
tidier right up to the point where you need the identity spine to span both of
them.

Tabs are also created lazily, so a missed rollover is not an outage. `/rollover`
re-runs it by hand and also picks up anyone who joined since.

## Amending a past day

Type the value into the cell. The grid is the record and editing it is allowed;
that is a feature of keeping the data in a spreadsheet rather than hiding it in a
database somebody has to ask you about.

Use the values in `CONFIG.RESPONSES` so the counts stay right. The bot refuses
button taps on a closed month on purpose: a correction belongs with somebody who
can see the whole row.

## Broadcast

`/broadcast`, then the message, then a preview with the recipient count, then
confirm. It reports how many were delivered and names the ones that failed.

The preview expires with the conversation state, after `STATE_TTL_MINUTES`.
Confirming an expired preview sends nothing and says so.

## Health

`/health` reports:

- roster totals, active count
- active people with no linked Telegram account. These are invisible on every
  other surface, which is why they are listed
- absence rows whose dates cannot be read
- webhook `pending_update_count` and `last_error_message`
- whether today's send has been claimed
- how many expired conversation flows it just swept

## Things that will bite

**Push without redeploy.** Half the system stays on the old code. See
[DEPLOYMENT.md](DEPLOYMENT.md).

**Duplicate triggers.** Creating one by hand in the Triggers panel leaves no
trace in the code. `Setup_installTriggers` deletes its own duplicates, and the
once-per-day claim in `src/Prompt.js` means a duplicate cannot double-send, but
check the panel if the Executions list looks busier than it should.

**Timezone mismatch.** `CONFIG.TIMEZONE` and the `timeZone` in
`src/appsscript.json` must be the same string. If they are not, the send time and
the date a reply is filed under drift apart, and the drift is one day wide at the
edges of the month.

**Blank versus away.** A blank cell means no reply, which is why the suppressor
writes `AWAY` explicitly. If you add your own absence path, write the marker too.

**A silent report is not an empty report.** When an integration degrades, the
code says so rather than sending an empty list. Treat "unavailable" as a problem,
not as good news.

## Rotating the bot token

1. BotFather, `/revoke`.
2. Update the `BOT_TOKEN` script property.
3. `Setup_registerWebhook(...)` again, because revoking drops the webhook.
4. `Setup_publishCommands`.

Rotate if the token has ever been in a chat message, a screenshot, a shared
document or a transcript. That is more likely than it sounds.
