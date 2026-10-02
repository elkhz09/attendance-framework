/**
 * One-time and occasional setup. Run these from the Apps Script editor.
 *
 * Every function here is idempotent, because the only setup instructions people
 * actually follow are the ones that are safe to run twice.
 */

/**
 * Store the secrets in Script Properties.
 *
 * Fill the two values in, run this once, then blank them out again and push.
 * They are secrets: they do not belong in a file that git can see, which is why
 * they are not in config.example.js.
 *
 * You can do the same thing without code in
 * Project Settings > Script Properties, which is the better habit.
 */
function Setup_writeSecrets() {
  var BOT_TOKEN = '';        // from BotFather
  var WEBHOOK_SECRET = '';   // any long random string you generate yourself

  if (!BOT_TOKEN || !WEBHOOK_SECRET) {
    throw new Error('Fill in BOT_TOKEN and WEBHOOK_SECRET inside Setup_writeSecrets first.');
  }
  PropertiesService.getScriptProperties().setProperties({
    BOT_TOKEN: BOT_TOKEN,
    WEBHOOK_SECRET: WEBHOOK_SECRET
  }, false);
  Logger.log('secrets stored');
}

/** Create the roster, absence and history tabs, plus the current month tab. */
function Setup_bootstrapSheets() {
  Roster_sheet();
  Absence_sheet();
  History_sheet();
  var month = Attendance_monthSheet(Dates_today());
  Logger.log('tabs ready, current month tab is %s', month.getSheetName());
}

/**
 * Install the scheduled triggers, removing any duplicates first.
 *
 * Duplicates are the failure this guards against. Creating a trigger by hand in
 * the Triggers panel leaves no trace in the code, and two triggers on the daily
 * prompt means two messages to every person. The idempotency claim in Prompt.js
 * stops the double send; this stops the duplicate existing in the first place.
 *
 * Apps Script time triggers are best-effort. atHour(7) means "some time in the
 * 07:00 hour", usually within a few minutes but not guaranteed. If a process
 * genuinely needs the message at an exact minute, drive it from an external
 * scheduler hitting the web app and keep this trigger as the idempotent backup.
 */
function Setup_installTriggers() {
  var wanted = ['sendDailyPrompt', 'rolloverMonth', 'State_sweep'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (wanted.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('sendDailyPrompt')
    .timeBased()
    .atHour(CONFIG.PROMPT_HOUR)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  ScriptApp.newTrigger('rolloverMonth')
    .timeBased()
    .onMonthDay(1)
    .atHour(Math.max(0, CONFIG.PROMPT_HOUR - 1))
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  ScriptApp.newTrigger('State_sweep')
    .timeBased()
    .everyHours(6)
    .create();

  Logger.log('triggers installed: %s', wanted.join(', '));
}

/**
 * Point Telegram at the pinned deployment.
 *
 * Pass the full /exec URL of the deployment, not the /dev URL. The /dev URL
 * requires a signed-in Google session and Telegram does not have one, so it
 * fails with an HTML login page and no useful error.
 *
 * The token is appended here, because Apps Script cannot read the header that
 * Telegram's own secret_token mechanism uses. See the note in Main.js.
 */
function Setup_registerWebhook(execUrl) {
  if (!execUrl || execUrl.indexOf('/exec') === -1) {
    throw new Error('Pass the deployment /exec URL, e.g. ' +
                    'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec');
  }
  var secret = PropertiesService.getScriptProperties().getProperty(CONFIG.PROPS.WEBHOOK_SECRET);
  if (!secret) throw new Error('WEBHOOK_SECRET is not set. Run Setup_writeSecrets first.');

  var result = Telegram_setWebhook(execUrl + '?token=' + encodeURIComponent(secret));
  Logger.log(JSON.stringify(result));
  return result;
}

/** Publish the command list so Telegram's menu matches the code. */
function Setup_publishCommands() {
  var result = Telegram_setCommands(Commands_published());
  Logger.log(JSON.stringify(result));
  return result;
}

/** Print the webhook state. First thing to check when commands go quiet. */
function Setup_diagnoseWebhook() {
  Logger.log(JSON.stringify(Telegram_getWebhookInfo(), null, 2));
}

/**
 * Seed a handful of placeholder people so you can see the shape of the sheet
 * before putting real names in it. Refuses to run on a non-empty roster.
 */
function Setup_seedExample() {
  if (Roster_all().length) {
    throw new Error('Roster is not empty. Seeding would mix example rows into real data.');
  }
  var examples = [
    { displayName: 'Alice Example', role: 'Role A', group: 'Team A', subgroup: 'Dept 1', sortKey: 10 },
    { displayName: 'Bob Example',   role: 'Role B', group: 'Team A', subgroup: 'Dept 1', sortKey: 20 },
    { displayName: 'Carol Example', role: 'Role A', group: 'Team A', subgroup: 'Dept 2', sortKey: 10 },
    { displayName: 'Dan Example',   role: 'Role C', group: 'Team B', subgroup: 'Dept 3', sortKey: 10 }
  ];
  examples.forEach(function (person) { Roster_join(person, 'setup'); });
  Rollover_syncCurrentMonth();
  Logger.log('seeded %s example people', examples.length);
}
