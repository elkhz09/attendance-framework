/**
 * The scheduled daily prompt.
 *
 * Three things here exist because of production failures, not theory.
 *
 * 1. The trigger argument trap.
 *    A time-driven trigger calls its function with an event object as the first
 *    argument. If that function is declared as sendDailyPrompt(force), then
 *    every scheduled run arrives with force set to a truthy object, and every
 *    `if (!force)` guard inside is bypassed. Weekend skips stop working, dry-run
 *    guards stop working, and it only happens on the scheduled path, which is
 *    the one you cannot easily watch. So: only the literal value true counts as
 *    a manual force. Anything else, including an event object, is a normal run.
 *
 * 2. Idempotency.
 *    Triggers are best-effort and can be duplicated by hand in the Triggers
 *    panel, which is easy to do and leaves no obvious trace. Two triggers means
 *    two prompts to every person. The claim below is a once-per-day atomic
 *    check-and-set under a lock, so a duplicate or concurrent run finds the day
 *    already claimed and exits without sending.
 *
 * 3. Failures are collected, not thrown.
 *    One blocked recipient must not stop the loop. See Telegram.js.
 */

/**
 * Entry point for the time-driven trigger and for the admin /prompt command.
 *
 * @param {*} force  true only when called manually. A trigger passes an event
 *                   object here, which must not be read as a force.
 */
function sendDailyPrompt(force) {
  var manual = (force === true);
  var today = Dates_today();

  if (!manual) {
    var weekday = Dates_isoWeekday(today);
    if (CONFIG.PROMPT_DAYS.indexOf(weekday) === -1) {
      Logger.log('skip: weekday %s is not a prompt day', weekday);
      return { skipped: 'not-a-prompt-day' };
    }
    if (!Prompt_claimDay_(Dates_dayKey(today))) {
      Logger.log('skip: %s already claimed', Dates_dayKey(today));
      return { skipped: 'already-sent' };
    }
  }

  return Prompt_run_(today, manual);
}

/**
 * Atomic once-per-day claim.
 *
 * Takes the lock, compares the stored day key, writes it, releases. Returns
 * true only to the first caller of the day. A manual send bypasses this on
 * purpose, so an admin can re-send after a failure.
 *
 * Note this takes the 'claim' lock, so it must not be called from inside
 * another critical section holding the same name.
 */
function Prompt_claimDay_(dayKey) {
  return Locks_with('claim', function () {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(CONFIG.PROPS.DAILY_CLAIM) === dayKey) return false;
    props.setProperty(CONFIG.PROPS.DAILY_CLAIM, dayKey);
    return true;
  }, 20000);
}

/** Clear today's claim so a re-send can happen on the scheduled path. */
function Prompt_releaseClaim() {
  PropertiesService.getScriptProperties().deleteProperty(CONFIG.PROPS.DAILY_CLAIM);
}

/**
 * Do the work: mark planned absences, then message everyone still expected.
 * @return {{sent: number, away: number, unlinked: Array, failed: Array}}
 */
function Prompt_run_(date, manual) {
  Attendance_monthSheet(date);          // generate the tab if this is the 1st
  var awayMarked = Attendance_markAway(date);
  var away = Absence_onDate(date);
  var dayKey = Dates_dayKey(date);

  var sent = 0;
  var failed = [];
  var unlinked = [];

  Roster_sorted(Roster_active()).forEach(function (person) {
    if (away[String(person.person_id)]) return;

    var chatId = String(person.telegram_user_id || '').trim();
    if (!chatId) {
      // Nobody to message. Collected and reported rather than silently dropped,
      // because an unlinked person is invisible on every other surface.
      unlinked.push(person);
      return;
    }

    var res = Telegram_send(chatId, Prompt_text_(person, date), {
      keyboard: Prompt_keyboard_(dayKey)
    });

    if (res.ok) {
      sent++;
    } else {
      failed.push({
        person_id: person.person_id,
        display_name: person.display_name,
        description: res.description || ('HTTP ' + res.code)
      });
    }
  });

  var report = {
    date: dayKey,
    manual: !!manual,
    sent: sent,
    awayMarked: awayMarked,
    away: Object.keys(away).length,
    unlinked: unlinked,
    failed: failed
  };
  Logger.log(JSON.stringify(report));
  if (failed.length || unlinked.length) Prompt_notifyAdmins_(report);
  return report;
}

/** The message body. Deliberately short; the buttons carry the interaction. */
function Prompt_text_(person, date) {
  var name = Telegram_escape(person.display_name || person.person_id);
  return '<b>' + Dates_format(date, 'EEEE d MMM') + '</b>\n' +
         'Morning ' + name + '. Attendance for today, please.\n' +
         'Reply by ' + CONFIG.REPLY_CUTOFF_HOUR + ':00.';
}

/**
 * Inline keyboard.
 *
 * The day key is carried in the callback data, so a tap on yesterday's message
 * cannot be recorded against today. Buttons live a long time in a chat history
 * and people do scroll back.
 */
function Prompt_keyboard_(dayKey) {
  var row = CONFIG.PROMPT_OPTIONS.map(function (key) {
    return { text: CONFIG.RESPONSES[key], callback_data: 'ans:' + dayKey + ':' + key };
  });
  return [row];
}

/** Tell the admins about delivery failures and unlinked people. */
function Prompt_notifyAdmins_(report) {
  var lines = ['<b>Prompt report ' + report.date + '</b>',
               'sent: ' + report.sent + '   away: ' + report.away];

  if (report.failed.length) {
    lines.push('', '<b>Delivery failed (' + report.failed.length + ')</b>');
    report.failed.forEach(function (f) {
      lines.push('· ' + Telegram_escape(f.display_name) + ' — ' + Telegram_escape(f.description));
    });
  }
  if (report.unlinked.length) {
    lines.push('', '<b>No Telegram account linked (' + report.unlinked.length + ')</b>');
    report.unlinked.forEach(function (p) {
      lines.push('· ' + Telegram_escape(p.display_name) + ' (' + p.person_id + ')');
    });
  }

  var text = lines.join('\n');
  CONFIG.ADMIN_TELEGRAM_IDS.forEach(function (id) {
    Telegram_sendLong(id, text);
  });
}
