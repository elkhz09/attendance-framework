# Deployment

## The thing to understand first

Apps Script runs two copies of your code.

| Path | Runs | Updated by |
|---|---|---|
| Time-driven triggers | HEAD | `clasp push` |
| Web app (the Telegram webhook) | the pinned deployment | `clasp deploy -i <id>` |

So `clasp push` fixes the scheduled prompt and leaves every interactive command
running the old code. The symptom is a fix that works on the schedule and not
when you type it, or the reverse, and it is genuinely confusing the first time
because nothing anywhere reports a version mismatch.

The rule: **push and redeploy in the same breath, always.**

## First deployment

In the editor: **Deploy > New deployment > Web app**.

| Field | Value |
|---|---|
| Execute as | Me |
| Who has access | Anyone |

"Anyone" is not a choice. Telegram posts updates without a Google session, so
anything narrower returns an HTML login page that Telegram cannot read. The
mitigation is the secret query parameter described below.

Copy two things from the result:

- the **deployment id**, which looks like `AKfycb...`. This is `YOUR_DEPLOYMENT_ID`.
- the **web app URL**, `https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec`

Keep the deployment id. Every later update goes to this same deployment, which
keeps the URL stable and means you never have to re-register the webhook.

## Every update after that

```bash
npx clasp push
npx clasp deploy -i YOUR_DEPLOYMENT_ID -d "what changed"
```

Both lines. The URL does not change.

## Rolling back

Deployment versions are numbered, and you can repoint the same deployment id at
an older one:

```bash
npx clasp deployments                       # list versions
npx clasp deploy -i YOUR_DEPLOYMENT_ID -V 7 -d "rollback to 7"
```

Note the version number you are deploying from before you ship anything
interesting, so the rollback is one command and not an archaeology exercise.

## Webhook authentication

Telegram's `setWebhook` secret arrives as an HTTP request header, and Apps Script
cannot read request headers. There is no workaround for that; it is a platform
limitation.

What Apps Script *can* read is query parameters, via `e.parameter`. So the
webhook is registered with the secret in the URL:

```
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?token=YOUR_WEBHOOK_SECRET
```

and `doPost` rejects anything that does not carry it.

Consequences, stated plainly:

- The webhook URL now contains a secret. Treat the whole URL as a credential.
- Rotating `WEBHOOK_SECRET` means re-registering the webhook in the same change,
  or the bot goes deaf. Run `Setup_registerWebhook` immediately after.
- This stops casual forgery. It is not a substitute for not putting anything
  sensitive in the sheet.

## Staging

Attendance data is other people's records, so test against a copy.

1. Duplicate the spreadsheet.
2. Create a second Apps Script project and a second bot with BotFather.
3. Keep a second `.clasp.json` and a second `src/Config.js` pointing at them.

A freshly copied Apps Script project has ungranted OAuth scopes, so its web app
returns 403 until the deploying account has run any function once from the editor
and accepted the consent screen. That 403 looks like a deployment problem and is
not.

## Quotas and timing

Consumer Google accounts get roughly 90 minutes of total trigger runtime per day,
six minutes per execution, and 20,000 `UrlFetchApp` calls per day. A roster of a
few hundred people sits well inside that.

Time triggers are **best-effort**. `atHour(7)` means some time in the 07:00 hour.
If the message genuinely has to land at an exact minute, drive it from an
external scheduler that calls the web app, and keep the trigger as the idempotent
backup. It cannot double-send: see the daily claim in `src/Prompt.js`.

A 40-minute gap between the slot and the send is a queued execution, not a
six-minute timeout. Check **Executions** in the editor before assuming the code
is at fault.

## When commands go quiet

In order:

1. `Setup_diagnoseWebhook`, or `/health`. A clean webhook with
   `pending_update_count: 0` and no `last_error_message` means Telegram is
   delivering and the problem is on the Apps Script side.
2. **Executions** in the editor. Look for failures and for queueing.
3. Did you push without redeploying? This is usually it.
