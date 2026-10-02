/**
 * Web app entry points.
 *
 * ---------------------------------------------------------------------------
 * The deployment split, which catches everyone once
 * ---------------------------------------------------------------------------
 * Apps Script runs two copies of your code.
 *
 *   - Time-driven triggers execute the HEAD of the project, which is what
 *     `clasp push` updates.
 *   - The web app executes the PINNED DEPLOYMENT, which only changes when you
 *     run `clasp deploy -i <deploymentId>`.
 *
 * So pushing a fix updates the scheduled prompt and leaves the webhook, which
 * is every interactive command, running the old code. The symptom is a fix that
 * "works on the schedule but not when I type it", and it will waste an afternoon
 * if you do not know about it. Push and redeploy together, every time. The
 * recipe is in docs/DEPLOYMENT.md.
 *
 * ---------------------------------------------------------------------------
 * Webhook authentication
 * ---------------------------------------------------------------------------
 * Telegram's own setWebhook secret arrives as an HTTP header, and Apps Script
 * cannot read request headers. A web app that Telegram can reach must also be
 * deployed with access ANYONE_ANONYMOUS, so the URL alone is the only thing
 * standing between an outsider and a forged update.
 *
 * The practical mitigation is a secret query parameter, which Apps Script does
 * expose via e.parameter. Register the webhook as
 *
 *     https://script.google.com/macros/s/<DEPLOYMENT>/exec?token=<SECRET>
 *
 * and reject anything without it. The URL now contains a secret, so treat it as
 * one: it goes in Script Properties, not in the repository, and rotating the
 * token means re-registering the webhook in the same change.
 */

function doPost(e) {
  try {
    if (!Main_authorised_(e)) {
      // Deliberately terse. An unauthenticated caller learns nothing.
      return Main_ok_();
    }

    var update = JSON.parse(e.postData.contents);

    if (update.message) {
      Commands_handleMessage(update.message);
    } else if (update.callback_query) {
      Flows_handleCallback(update.callback_query);
    }
  } catch (err) {
    // Always return 200. A non-200 makes Telegram retry the same update, and a
    // deterministic bug then becomes an endless retry loop against a function
    // that will fail every time.
    Logger.log('doPost failed: %s\n%s', err, err && err.stack);
  }
  return Main_ok_();
}

/**
 * Health endpoint. Also gated, because it reports configuration.
 * Open it in a browser as .../exec?token=<SECRET>&ping=1
 */
function doGet(e) {
  if (!Main_authorised_(e)) {
    return ContentService.createTextOutput('no').setMimeType(ContentService.MimeType.TEXT);
  }
  var body = {
    ok: true,
    timezone: CONFIG.TIMEZONE,
    today: Dates_dayKey(Dates_today()),
    monthTab: Dates_monthTab(Dates_today()),
    rosterActive: Roster_active().length
  };
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function Main_authorised_(e) {
  var expected = PropertiesService.getScriptProperties()
    .getProperty(CONFIG.PROPS.WEBHOOK_SECRET);
  if (!expected) {
    Logger.log('refusing request: ' + CONFIG.PROPS.WEBHOOK_SECRET + ' is not set');
    return false;
  }
  var supplied = e && e.parameter && e.parameter.token;
  return supplied === expected;
}

function Main_ok_() {
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}
