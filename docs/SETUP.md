# Setup

About thirty minutes end to end, most of it waiting for Google's consent screens.

You need a Google account, a Telegram account, and Node for `clasp`.

## 1. Spreadsheet

Create an empty spreadsheet. Copy the id out of its URL:

```
https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit
```

Set **File > Settings > Locale** to a locale you actually use. The code writes
real `Date` objects so it does not depend on this, but anything typed in by hand
does.

## 2. Telegram bot

Message `@BotFather`, send `/newbot`, keep the token it gives you.

Leave **privacy mode on**, which is the default. Do not enable
`can_read_all_group_messages`. The bot never needs to read group chatter, and
asking for that permission is a bad trade for both of you.

## 3. Apps Script project

```bash
git clone <this repo> attendance-framework
cd attendance-framework
npm install

cp config.example.js src/Config.js
cp .clasp.json.example .clasp.json
```

Create a standalone Apps Script project at <https://script.google.com>, then put
its script id into `.clasp.json`:

```json
{ "scriptId": "YOUR_SCRIPT_ID", "rootDir": "src" }
```

Edit `src/Config.js`:

- `SPREADSHEET_ID` — from step 1.
- `TIMEZONE` — and set the same value in `src/appsscript.json`. If the two
  disagree, the send time and the date a reply is filed under drift apart.
- `PROMPT_HOUR`, `PROMPT_DAYS`, `REPLY_CUTOFF_HOUR`.
- `ADMIN_TELEGRAM_IDS` — leave the placeholders for now; step 6 fills them.
- `GROUP_LABEL`, `SUBGROUP_LABEL`, `SUBGROUP_ORDER` — your own vocabulary.

Then:

```bash
npx clasp login
npx clasp push
```

## 4. Secrets

In the Apps Script editor: **Project Settings > Script Properties**. Add two.

| Property | Value |
|---|---|
| `BOT_TOKEN` | the token from BotFather |
| `WEBHOOK_SECRET` | a long random string you generate yourself |

They are kept here rather than in `Config.js` so they cannot reach the
repository. `src/Config.js` is gitignored as a second line of defence.

## 5. Tabs and triggers

From the editor, run these in order. Each is safe to run twice.

1. `Setup_bootstrapSheets` — creates `Roster`, `Absence`, `History` and the
   current month tab.
2. `SelfTest_run` — checks the date parser and the message chunker. Touches no
   sheet, sends no message.
3. `Setup_installTriggers` — the daily prompt, the monthly rollover, and a
   six-hourly sweep of expired conversation state. It deletes its own duplicates
   first.

The first run asks for authorisation. Grant it with the account that owns the
spreadsheet.

Optionally run `Setup_seedExample` to put four placeholder people on the roster
so you can see the shape of it. It refuses to run once the roster has real rows.

## 6. Deploy and connect

Follow [DEPLOYMENT.md](DEPLOYMENT.md) to create the web app deployment, then come
back here.

With the deployment URL in hand, from the editor:

```
Setup_registerWebhook('https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec')
```

It appends `?token=<WEBHOOK_SECRET>` itself.

Then run `Setup_publishCommands` so Telegram's menu matches the code.

Now message your bot `/whoami`. It replies with your numeric Telegram id. Put
that id into `ADMIN_TELEGRAM_IDS` in `src/Config.js`, push, **and redeploy**.
See DEPLOYMENT.md for why the redeploy is not optional.

## 7. First roster

As an admin, `/join`, and answer the four questions. The bot mints a
`person_id`, adds the row and the month tab entry.

Ask the person to message the bot `/whoami`, then link them:

```
/link P0001 000000001
```

Repeat. For more than a handful of people, type them straight into the `Roster`
tab instead: fill `person_id` by hand following the `P0001` pattern, set `status`
to `ACTIVE`, then run `Rollover_syncCurrentMonth` to bring them onto the month
tab.

## 8. Check it

- `/health` — roster counts, people with no linked account, unreadable absence
  rows, webhook pending count and last error.
- `/prompt` — sends the daily prompt immediately, bypassing the once-per-day
  claim. Tap a button and confirm the cell fills.
- `/outstanding` — the morning list.
