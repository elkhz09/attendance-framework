/**
 * Telegram transport.
 *
 * Two things here are load-bearing.
 *
 * 1. muteHttpExceptions: true on every outbound call.
 *    UrlFetchApp.fetch throws on any non-2xx response. Telegram returns 403 for
 *    a user who has blocked the bot, which is a completely ordinary thing for a
 *    person to do. Without the mute flag, that one 403 throws, the surrounding
 *    broadcast loop dies, and everyone further down the roster gets nothing.
 *    Because the loop skips people who have already replied, the row that
 *    happens to be first-and-blocked moves from day to day, so the symptom
 *    reads as "the prompt randomly doesn't send to some people". It is not
 *    random. It is one unguarded fetch.
 *
 *    Telegram_send therefore never throws. It returns a result object and the
 *    caller decides what to do with a failure.
 *
 * 2. The 4096-character cap applies to the whole message.
 *    Telegram does not truncate a long message, it rejects it, so a report that
 *    grows past the cap stops arriving entirely. Telegram_sendLong splits on
 *    line boundaries before sending.
 */

var TELEGRAM_API_ = 'https://api.telegram.org/bot';

function Telegram_token_() {
  var token = PropertiesService.getScriptProperties().getProperty(CONFIG.PROPS.BOT_TOKEN);
  if (!token) throw new Error('Script Property ' + CONFIG.PROPS.BOT_TOKEN + ' is not set.');
  return token;
}

/**
 * Low-level call. Never throws on an HTTP error.
 * @return {{ok: boolean, result: *, code: number, description: string}}
 */
function Telegram_call(method, payload) {
  var url = TELEGRAM_API_ + Telegram_token_() + '/' + method;
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (err) {
    // DNS failure, timeout, quota. Still must not propagate.
    return { ok: false, result: null, code: 0, description: String(err) };
  }

  var code = response.getResponseCode();
  var body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (err) {
    body = { description: 'unparseable response body' };
  }

  return {
    ok: code === 200 && body.ok === true,
    result: body.result,
    code: code,
    description: body.description || ''
  };
}

/** Send one message. Returns the call result; does not throw. */
function Telegram_send(chatId, text, options) {
  var payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (options && options.keyboard) payload.reply_markup = { inline_keyboard: options.keyboard };
  if (options && options.silent) payload.disable_notification = true;
  return Telegram_call('sendMessage', payload);
}

/**
 * Send text of any length, split on line boundaries.
 * Returns the array of per-chunk results.
 */
function Telegram_sendLong(chatId, text, options) {
  var chunks = Telegram_chunk(text, CONFIG.MAX_MESSAGE_CHARS);
  var results = [];
  for (var i = 0; i < chunks.length; i++) {
    results.push(Telegram_send(chatId, chunks[i], options));
  }
  return results;
}

/**
 * Split text into pieces no longer than limit, preferring line breaks.
 * A single line longer than the limit is hard-split rather than dropped.
 * Pure function, covered by SelfTest.js.
 */
function Telegram_chunk(text, limit) {
  var out = [];
  var lines = String(text == null ? '' : text).split('\n');
  var buffer = '';

  function flush() {
    if (buffer.length) { out.push(buffer); buffer = ''; }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    while (line.length > limit) {
      flush();
      out.push(line.substring(0, limit));
      line = line.substring(limit);
    }
    var candidate = buffer ? (buffer + '\n' + line) : line;
    if (candidate.length > limit) {
      flush();
      buffer = line;
    } else {
      buffer = candidate;
    }
  }
  flush();
  return out.length ? out : [''];
}

/**
 * Send the same message to many chats, tolerating individual failures.
 * @return {{sent: number, failed: Array<{chatId: *, description: string}>}}
 */
function Telegram_broadcast(chatIds, text, options) {
  var sent = 0;
  var failed = [];
  for (var i = 0; i < chatIds.length; i++) {
    var res = Telegram_send(chatIds[i], text, options);
    if (res.ok) {
      sent++;
    } else {
      failed.push({ chatId: chatIds[i], description: res.description || ('HTTP ' + res.code) });
    }
  }
  return { sent: sent, failed: failed };
}

/** Acknowledge a button tap. Telegram shows a spinner until this arrives. */
function Telegram_answerCallback(callbackId, text) {
  return Telegram_call('answerCallbackQuery', {
    callback_query_id: callbackId,
    text: text || '',
    show_alert: false
  });
}

/** Replace the text of an existing message, dropping its keyboard. */
function Telegram_editText(chatId, messageId, text) {
  return Telegram_call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML'
  });
}

/** Register the webhook URL. See docs/DEPLOYMENT.md for the secret parameter. */
function Telegram_setWebhook(url) {
  return Telegram_call('setWebhook', {
    url: url,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false
  });
}

/** Diagnostics: pending_update_count and last_error_message. */
function Telegram_getWebhookInfo() {
  return Telegram_call('getWebhookInfo', {});
}

/** Publish the command list so it appears in the Telegram client menu. */
function Telegram_setCommands(commands) {
  return Telegram_call('setMyCommands', { commands: commands });
}

/** Escape text that will be sent with parse_mode HTML. */
function Telegram_escape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
