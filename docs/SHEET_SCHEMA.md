# Sheet schema

One spreadsheet, four kinds of tab. Column order does not matter: every read and
write looks columns up by header name, so you can insert a column of your own
without touching code. Header text does matter, so do not rename them.

All example data below is placeholder.

## `Roster` — one row per person, ever

The identity spine. Nothing is ever deleted from this tab.

| person_id | display_name | role | group | subgroup | telegram_user_id | telegram_username | status | joined_on | left_on | sort_key | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P0001 | Alice Example | Role A | Team A | Dept 1 | 000000001 | aliceexample | ACTIVE | 05/01/2026 | | 10 | |
| P0002 | Bob Example | Role B | Team A | Dept 1 | 000000002 | bobexample | ACTIVE | 05/01/2026 | | 20 | |
| P0003 | Carol Example | Role A | Team A | Dept 2 | | | DETACHED | 05/01/2026 | | 10 | course until Q3 |
| P0004 | Dan Example | Role C | Team B | Dept 3 | 000000004 | danexample | DEPARTED | 05/01/2026 | 28/06/2026 | 10 | |

- `person_id` is minted once and never reused. It is the only column other tabs
  key on.
- `display_name`, `role`, `group` and `subgroup` are **snapshots**. Change them
  freely; no historical row moves.
- `status` is one of `ACTIVE`, `DETACHED`, `DEPARTED`.
  - `ACTIVE` gets the daily prompt.
  - `DETACHED` stays on the roster and on the month tab, gets no prompt.
  - `DEPARTED` is off both, and their past rows stay untouched.
- `telegram_user_id` is a link to an account, not an identity. People change
  accounts; a person who does keeps their `person_id`.
- `sort_key` is presentation only. Lower sorts first within a subgroup.

## `2026-10` — one month tab per month

Named `yyyy-MM`. That sorts correctly and reads the same in every locale, which
matters more than looking nice.

| person_id | display_name | role | group | subgroup | d01 | d02 | d03 | … | d31 |
|---|---|---|---|---|---|---|---|---|---|
| P0001 | Alice Example | Role A | Team A | Dept 1 | IN | IN | AWAY | | |
| P0002 | Bob Example | Role B | Team A | Dept 1 | IN | OUT | | | |
| P0003 | Carol Example | Role A | Team A | Dept 2 | | | | | |

- Day columns are `d01`…`d31`, not `01`…`31`. A header of `01` is coerced to the
  number `1` by Sheets and then stops matching a string lookup.
- The name and role columns are the snapshot taken when the tab was generated.
  A tab from eight months ago shows who those people were then.
- Cell values come from `CONFIG.RESPONSES`. `AWAY` is written by the absence
  suppressor, never by a person.
- A blank cell means no reply. That is why `AWAY` is written explicitly: so a
  blank is unambiguous.
- The cell note records when the reply arrived and from which account. The value
  stays clean so the grid is readable by a human.

## `Absence` — planned absence

| absence_id | person_id | kind | start_date | end_date | location | status | recorded_at | recorded_by |
|---|---|---|---|---|---|---|---|---|
| A20261001093012-417 | P0001 | LEAVE | 03/11/2026 | 07/11/2026 | home | OPEN | 01/10/2026 09:30 | @aliceexample |
| A20260915140755-882 | P0003 | COURSE | 01/07/2026 | 30/09/2026 | Site 2 | CANCELLED | 15/09/2026 14:07 | @admin |

- `start_date` and `end_date` are real `Date` values with a `dd/MM/yyyy` format,
  never strings. See the locale note in the README.
- Cancelling sets `status` and leaves the row, so "who told us, and when" stays
  answerable.
- A row whose dates cannot be read is reported by `/health`, not silently
  skipped. A quietly ignored absence row means somebody gets chased while they
  are away.

## `History` — append-only audit

| timestamp | person_id | field | old_value | new_value | actor | note |
|---|---|---|---|---|---|---|
| 05/01/2026 09:02 | P0001 | joined | | Alice Example | @admin | |
| 14/04/2026 11:20 | P0001 | role | Role A | Role B | @admin | |
| 28/06/2026 16:45 | P0004 | status | ACTIVE | DEPARTED | @admin | end of posting |

Every roster mutation writes a row here. This is what lets you answer "was this
person in Role B in April", which is the question a role-keyed sheet cannot
answer at all.
