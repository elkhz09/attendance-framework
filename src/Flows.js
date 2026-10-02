/**
 * Multi-step flows and button callbacks.
 *
 * Callback ordering, which is not obvious and cost real data to learn:
 * do the work first, then acknowledge the tap.
 *
 * Telegram rejects an answerCallbackQuery for a query that is too old, so if you
 * acknowledge first and the acknowledgement throws, the work below it never
 * runs. The person is then told "nothing was saved" by the error path while
 * believing they answered, or worse, is shown a success message for a write that
 * did not happen. Telegram_answerCallback never throws, and it is called after
 * the write, so a failed acknowledgement costs a spinner and nothing else.
 */

// ---------------------------------------------------------------------------
// Flow starters
// ---------------------------------------------------------------------------

function Cmd_broadcastStart_(tgId, chatId) {
  State_set(tgId, 'broadcast', 'text', {});
  Telegram_send(chatId,
    'Send the message to broadcast. I will show you a preview before anything goes out.\n' +
    '/cancel to stop.');
}

function Cmd_joinStart_(tgId, chatId) {
  State_set(tgId, 'join', 'name', {});
  Telegram_send(chatId, 'New roster entry. What is their name? /cancel to stop.');
}

// ---------------------------------------------------------------------------
// Flow advance
// ---------------------------------------------------------------------------

function Flows_advance(state, tgId, chatId, text) {
  if (state.flow === 'broadcast') return Flows_broadcast_(state, tgId, chatId, text);
  if (state.flow === 'join') return Flows_join_(state, tgId, chatId, text);
  State_clear(tgId);
  Telegram_send(chatId, 'I lost track of that. Start again.');
}

function Flows_broadcast_(state, tgId, chatId, text) {
  if (state.step !== 'text') { State_clear(tgId); return; }
  if (!text) return Telegram_send(chatId, 'Nothing to send. /cancel to stop.');

  State_set(tgId, 'broadcast', 'confirm', { text: text });
  var recipients = Flows_broadcastRecipients_().length;
  Telegram_send(chatId,
    '<b>Preview</b>\n\n' + Telegram_escape(text) +
    '\n\nThis goes to ' + recipients + ' people.',
    { keyboard: [[
      { text: 'Send', callback_data: 'bc:send' },
      { text: 'Discard', callback_data: 'bc:abort' }
    ]] });
}

function Flows_broadcastRecipients_() {
  return Roster_active().filter(function (p) {
    return String(p.telegram_user_id || '').trim();
  });
}

function Flows_join_(state, tgId, chatId, text) {
  var data = state.data || {};

  if (state.step === 'name') {
    data.displayName = text;
    State_set(tgId, 'join', 'role', data);
    return Telegram_send(chatId, 'Role?');
  }
  if (state.step === 'role') {
    data.role = text;
    State_set(tgId, 'join', 'group', data);
    return Telegram_send(chatId, CONFIG.GROUP_LABEL + '?');
  }
  if (state.step === 'group') {
    data.group = text;
    State_set(tgId, 'join', 'subgroup', data);
    return Telegram_send(chatId, CONFIG.SUBGROUP_LABEL + '?');
  }
  if (state.step === 'subgroup') {
    data.subgroup = text;
    State_set(tgId, 'join', 'confirm', data);
    return Telegram_send(chatId,
      '<b>Confirm</b>\n' +
      'Name: ' + Telegram_escape(data.displayName) + '\n' +
      'Role: ' + Telegram_escape(data.role) + '\n' +
      CONFIG.GROUP_LABEL + ': ' + Telegram_escape(data.group) + '\n' +
      CONFIG.SUBGROUP_LABEL + ': ' + Telegram_escape(data.subgroup),
      { keyboard: [[
        { text: 'Add', callback_data: 'join:save' },
        { text: 'Discard', callback_data: 'join:abort' }
      ]] });
  }

  State_clear(tgId);
  Telegram_send(chatId, 'I lost track of that. Start again with /join.');
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

function Flows_handleCallback(callback) {
  var data = String(callback.data || '');
  var from = callback.from || {};
  var tgId = String(from.id || '');
  var message = callback.message || {};
  var chatId = message.chat && message.chat.id;

  // A tap forwarded into a group, or a message the bot can no longer read.
  if (!chatId || (message.chat && message.chat.type !== 'private')) {
    Telegram_answerCallback(callback.id, 'Not here.');
    return;
  }

  try {
    if (data.indexOf('ans:') === 0) return Flows_answerTap_(data, tgId, chatId, callback, from);
    if (data === 'bc:send')         return Flows_broadcastSend_(tgId, chatId, callback);
    if (data === 'bc:abort')        return Flows_abort_(tgId, chatId, callback, 'Broadcast discarded.');
    if (data === 'join:save')       return Flows_joinSave_(tgId, chatId, callback, from);
    if (data === 'join:abort')      return Flows_abort_(tgId, chatId, callback, 'Discarded.');
  } catch (err) {
    Logger.log('callback %s failed: %s', data, err);
    Telegram_answerCallback(callback.id, 'That failed.');
    Telegram_send(chatId, 'That failed: ' + Telegram_escape(String(err.message || err)));
    return;
  }

  Telegram_answerCallback(callback.id, '');
}

/**
 * Attendance button.
 *
 * The day is carried in the callback data rather than read from the clock, so
 * scrolling back and tapping last Tuesday's message records against last
 * Tuesday and not against today. Replies for a closed month are refused,
 * because the tab for it may already be hidden and the correction belongs with
 * an admin.
 */
function Flows_answerTap_(data, tgId, chatId, callback, from) {
  var parts = data.split(':');
  var dayKey = parts[1];
  var responseKey = parts[2];

  var date = Dates_fromIso(dayKey);
  if (!date || !CONFIG.RESPONSES[responseKey]) {
    Telegram_answerCallback(callback.id, 'That button is no longer valid.');
    return;
  }
  if (Dates_monthTab(date) !== Dates_monthTab(Dates_today())) {
    Telegram_answerCallback(callback.id, 'That month is closed.');
    Telegram_send(chatId, 'That reply is for a closed month. Ask an admin to amend it.');
    return;
  }

  var person = Roster_byTelegramId(tgId);
  if (!person) {
    Telegram_answerCallback(callback.id, 'You are not on the roster.');
    return;
  }

  // Write first. Acknowledge second. See the note at the top of this file.
  var result = Attendance_record(person.person_id, date, responseKey, Cmd_actor_(from));
  Telegram_answerCallback(callback.id, 'Recorded ' + result.value);
  Telegram_editText(chatId, callback.message.message_id,
    Dates_format(date, 'EEE d MMM') + ': recorded <b>' + result.value + '</b>' +
    (result.late ? ' (late)' : '') + '.');
}

function Flows_broadcastSend_(tgId, chatId, callback) {
  var state = State_get(tgId);
  if (!state || state.flow !== 'broadcast' || state.step !== 'confirm') {
    Telegram_answerCallback(callback.id, 'That preview has expired.');
    return;
  }
  if (!Commands_isAdmin(tgId)) {
    Telegram_answerCallback(callback.id, 'Not allowed.');
    return;
  }

  var recipients = Flows_broadcastRecipients_().map(function (p) {
    return String(p.telegram_user_id);
  });
  var outcome = Telegram_broadcast(recipients, state.data.text);

  State_clear(tgId);
  Telegram_answerCallback(callback.id, 'Sent to ' + outcome.sent);

  var lines = ['Broadcast sent to ' + outcome.sent + ' of ' + recipients.length + '.'];
  if (outcome.failed.length) {
    lines.push('', '<b>Failed</b>');
    outcome.failed.forEach(function (f) {
      lines.push('· ' + f.chatId + ' — ' + Telegram_escape(f.description));
    });
  }
  Telegram_sendLong(chatId, lines.join('\n'));
}

function Flows_joinSave_(tgId, chatId, callback, from) {
  var state = State_get(tgId);
  if (!state || state.flow !== 'join' || state.step !== 'confirm') {
    Telegram_answerCallback(callback.id, 'That form has expired.');
    return;
  }
  if (!Commands_isAdmin(tgId)) {
    Telegram_answerCallback(callback.id, 'Not allowed.');
    return;
  }

  var record = Roster_join(state.data, Cmd_actor_(from));
  Rollover_syncCurrentMonth();
  State_clear(tgId);

  Telegram_answerCallback(callback.id, 'Added');
  Telegram_send(chatId,
    'Added ' + Telegram_escape(record.display_name) + ' as <code>' + record.person_id + '</code>.\n' +
    'Ask them to send /start, then /link ' + record.person_id + ' &lt;their id&gt;.');
}

function Flows_abort_(tgId, chatId, callback, note) {
  State_clear(tgId);
  Telegram_answerCallback(callback.id, 'Discarded');
  Telegram_send(chatId, note);
}
