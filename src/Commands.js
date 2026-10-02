/**
 * Command surface.
 *
 * One registry, used for three things: dispatch, /help text, and the published
 * command list that Telegram shows in its menu. Keeping a hand-written list in
 * a README and pasting it into BotFather guarantees the menu goes stale the
 * first time a command is renamed, so the bot publishes its own list on setup.
 *
 * Ordering rule in the router: /cancel is checked before any open flow, and any
 * slash command abandons an open flow rather than being eaten as an answer to
 * it. Without that, a person stuck in a half-finished wizard cannot type their
 * way out of it, which is a very fast way to lose someone's trust in the thing.
 */

var COMMANDS = [
  { name: 'start',       admin: false, args: '',                  help: 'Link your account and see what you can do' },
  { name: 'help',        admin: false, args: '',                  help: 'Show this list' },
  { name: 'me',          admin: false, args: '',                  help: 'Your roster record and today’s reply' },
  { name: 'in',          admin: false, args: '',                  help: 'Record yourself present for today' },
  { name: 'away',        admin: false, args: '<kind> <from> <to> [place]', help: 'Record planned absence, dates as dd/mm/yyyy' },
  { name: 'cancel',      admin: false, args: '',                  help: 'Abandon whatever you started' },
  { name: 'whoami',      admin: false, args: '',                  help: 'Show your Telegram id' },

  { name: 'summary',     admin: true,  args: '[dd/mm/yyyy]',      help: 'Counts for a day' },
  { name: 'outstanding', admin: true,  args: '[dd/mm/yyyy]',      help: 'Who still owes a reply' },
  { name: 'prompt',      admin: true,  args: '',                  help: 'Send the daily prompt now' },
  { name: 'broadcast',   admin: true,  args: '',                  help: 'Message everyone, with a preview first' },
  { name: 'join',        admin: true,  args: '',                  help: 'Add a person to the roster' },
  { name: 'leave',       admin: true,  args: '<person_id>',       help: 'Mark a person as departed' },
  { name: 'setrole',     admin: true,  args: '<person_id> <role>', help: 'Change a person’s role snapshot' },
  { name: 'detach',      admin: true,  args: '<person_id>',       help: 'Temporarily detach a person' },
  { name: 'attach',      admin: true,  args: '<person_id>',       help: 'Return a detached person' },
  { name: 'link',        admin: true,  args: '<person_id> <telegram_id>', help: 'Link an account to a person' },
  { name: 'rollover',    admin: true,  args: '',                  help: 'Build or refresh this month’s tab' },
  { name: 'health',      admin: true,  args: '',                  help: 'Configuration and data checks' }
];

function Commands_isAdmin(telegramUserId) {
  return CONFIG.ADMIN_TELEGRAM_IDS
    .map(String)
    .indexOf(String(telegramUserId)) !== -1;
}

/** Payload for Telegram_setCommands. */
function Commands_published() {
  return COMMANDS.map(function (c) {
    return { command: c.name, description: c.help };
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function Commands_handleMessage(message) {
  var chatId = message.chat && message.chat.id;
  var from = message.from || {};
  var tgId = String(from.id || '');
  var text = String(message.text || '').trim();
  if (!chatId || !tgId) return;

  // A group chat is not a place for attendance. One signpost, then nothing.
  if (message.chat.type !== 'private') {
    if (/^\//.test(text)) {
      Telegram_send(chatId, 'Attendance is handled in a direct message. Open a chat with me and send /start.');
    }
    return;
  }

  if (/^\/cancel\b/i.test(text)) {
    State_clear(tgId);
    Telegram_send(chatId, 'Cancelled. Nothing was saved.');
    return;
  }

  var state = State_get(tgId);
  if (state && !/^\//.test(text)) {
    Flows_advance(state, tgId, chatId, text);
    return;
  }
  if (state) {
    // A command interrupts the flow on purpose.
    State_clear(tgId);
  }

  var match = /^\/([A-Za-z_]+)(?:@\w+)?\s*([\s\S]*)$/.exec(text);
  if (!match) {
    Telegram_send(chatId, 'I only read commands here. Send /help.');
    return;
  }

  var name = match[1].toLowerCase();
  var args = match[2].trim();
  var spec = null;
  COMMANDS.forEach(function (c) { if (c.name === name) spec = c; });

  if (!spec) {
    Telegram_send(chatId, 'Unknown command. Send /help.');
    return;
  }
  if (spec.admin && !Commands_isAdmin(tgId)) {
    Telegram_send(chatId, 'That one is for admins.');
    return;
  }

  try {
    Commands_dispatch_(name, args, tgId, chatId, from);
  } catch (err) {
    Logger.log('command %s failed: %s', name, err);
    Telegram_send(chatId, 'That failed: ' + Telegram_escape(String(err.message || err)));
  }
}

function Commands_dispatch_(name, args, tgId, chatId, from) {
  switch (name) {
    case 'start':       return Cmd_start_(tgId, chatId, from);
    case 'help':        return Cmd_help_(tgId, chatId);
    case 'me':          return Cmd_me_(tgId, chatId);
    case 'in':          return Cmd_in_(tgId, chatId, from);
    case 'away':        return Cmd_away_(tgId, chatId, args, from);
    case 'whoami':      return Telegram_send(chatId, 'Your Telegram id is <code>' + tgId + '</code>.');

    case 'summary':     return Cmd_summary_(chatId, args);
    case 'outstanding': return Cmd_outstanding_(chatId, args);
    case 'prompt':      return Cmd_prompt_(chatId);
    case 'broadcast':   return Cmd_broadcastStart_(tgId, chatId);
    case 'join':        return Cmd_joinStart_(tgId, chatId);
    case 'leave':       return Cmd_leave_(chatId, args, from);
    case 'setrole':     return Cmd_setRole_(chatId, args, from);
    case 'detach':      return Cmd_detach_(chatId, args, from);
    case 'attach':      return Cmd_attach_(chatId, args, from);
    case 'link':        return Cmd_link_(chatId, args, from);
    case 'rollover':    return Cmd_rollover_(chatId);
    case 'health':      return Cmd_health_(chatId);
  }
}

// ---------------------------------------------------------------------------
// Person commands
// ---------------------------------------------------------------------------

function Cmd_start_(tgId, chatId, from) {
  var person = Roster_byTelegramId(tgId);
  if (!person) {
    Telegram_send(chatId,
      'You are not linked to a roster entry yet.\n\n' +
      'Send an admin your id, <code>' + tgId + '</code>, and they will link you.');
    return;
  }
  if (!String(person.telegram_username || '').trim() && from.username) {
    Roster_linkTelegram(person.person_id, tgId, from.username, tgId);
  }
  Cmd_help_(tgId, chatId);
}

function Cmd_help_(tgId, chatId) {
  var admin = Commands_isAdmin(tgId);
  var lines = ['<b>Commands</b>'];
  COMMANDS.filter(function (c) { return !c.admin; }).forEach(function (c) {
    lines.push('/' + c.name + (c.args ? ' ' + Telegram_escape(c.args) : '') + ' — ' + c.help);
  });
  if (admin) {
    lines.push('', '<b>Admin</b>');
    COMMANDS.filter(function (c) { return c.admin; }).forEach(function (c) {
      lines.push('/' + c.name + (c.args ? ' ' + Telegram_escape(c.args) : '') + ' — ' + c.help);
    });
  }
  Telegram_sendLong(chatId, lines.join('\n'));
}

function Cmd_me_(tgId, chatId) {
  var person = Roster_byTelegramId(tgId);
  if (!person) return Telegram_send(chatId, 'You are not on the roster. Send /start.');
  var today = Dates_today();
  var current = Attendance_get(person.person_id, today) || 'nothing yet';
  Telegram_send(chatId,
    '<b>' + Telegram_escape(person.display_name) + '</b> (' + person.person_id + ')\n' +
    'Role: ' + Telegram_escape(person.role || '-') + '\n' +
    CONFIG.GROUP_LABEL + ': ' + Telegram_escape(person.group || '-') + '\n' +
    CONFIG.SUBGROUP_LABEL + ': ' + Telegram_escape(person.subgroup || '-') + '\n' +
    'Status: ' + person.status + '\n' +
    'Today: ' + Telegram_escape(current));
}

function Cmd_in_(tgId, chatId, from) {
  var person = Roster_byTelegramId(tgId);
  if (!person) return Telegram_send(chatId, 'You are not on the roster. Send /start.');
  var result = Attendance_record(person.person_id, Dates_today(), 'PRESENT',
                                 from.username ? '@' + from.username : tgId);
  Telegram_send(chatId, 'Recorded: ' + result.value + (result.late ? ' (late)' : '') + '.');
}

/** /away LEAVE 03/11/2026 07/11/2026 somewhere */
function Cmd_away_(tgId, chatId, args, from) {
  var person = Roster_byTelegramId(tgId);
  if (!person) return Telegram_send(chatId, 'You are not on the roster. Send /start.');

  var parts = args.split(/\s+/).filter(String);
  if (parts.length < 3) {
    return Telegram_send(chatId,
      'Usage: /away &lt;kind&gt; &lt;from&gt; &lt;to&gt; [place]\n' +
      'Kinds: ' + ABSENCE_KINDS.join(', ') + '\n' +
      'Dates as dd/mm/yyyy. Example: /away LEAVE 03/11/2026 07/11/2026 home');
  }

  var kind = parts[0].toUpperCase();
  var start = Dates_parseUserDate(parts[1]);
  var end = Dates_parseUserDate(parts[2]);
  if (!start || !end) {
    return Telegram_send(chatId, 'I could not read those dates. Use dd/mm/yyyy, and a date that exists.');
  }

  var id = Absence_add(person.person_id, kind, start, end,
                       parts.slice(3).join(' '), from.username ? '@' + from.username : tgId);
  Telegram_send(chatId,
    'Recorded ' + kind + ' from ' + Dates_format(start, 'dd/MM/yyyy') +
    ' to ' + Dates_format(end, 'dd/MM/yyyy') + '.\n' +
    'You will not be prompted on those days. Reference <code>' + id + '</code>.');
}

// ---------------------------------------------------------------------------
// Admin commands
// ---------------------------------------------------------------------------

function Cmd_dateArg_(args) {
  if (!args) return Dates_today();
  return Dates_parseUserDate(args.split(/\s+/)[0]);
}

function Cmd_summary_(chatId, args) {
  var date = Cmd_dateArg_(args);
  if (!date) return Telegram_send(chatId, 'I could not read that date. Use dd/mm/yyyy.');

  var s = Attendance_summary(date);
  var lines = ['<b>' + Dates_format(date, 'EEE d MMM yyyy') + '</b>',
               'On the active roster: ' + s.rosterActive,
               'Away: ' + s.awayCount];

  Object.keys(s.counts).sort().forEach(function (value) {
    lines.push(value + ': ' + s.counts[value]);
  });
  lines.push('Outstanding: ' + s.outstanding.length);

  if (s.outstanding.length) {
    lines.push('', '<b>Outstanding</b>');
    lines = lines.concat(Cmd_groupedList_(s.outstanding));
  }
  Telegram_sendLong(chatId, lines.join('\n'));
}

function Cmd_outstanding_(chatId, args) {
  var date = Cmd_dateArg_(args);
  if (!date) return Telegram_send(chatId, 'I could not read that date. Use dd/mm/yyyy.');

  var people = Attendance_outstanding(date);
  if (!people.length) {
    return Telegram_send(chatId, 'Nobody outstanding for ' + Dates_format(date, 'EEE d MMM') + '.');
  }
  var lines = ['<b>Outstanding ' + Dates_format(date, 'EEE d MMM') + '</b> (' + people.length + ')'];
  Telegram_sendLong(chatId, lines.concat(Cmd_groupedList_(people)).join('\n'));
}

/** Group a list of people under their subgroup heading, in display order. */
function Cmd_groupedList_(people) {
  var lines = [];
  var currentGroup = null;
  Roster_sorted(people).forEach(function (p) {
    var sub = String(p.subgroup || '-');
    if (sub !== currentGroup) {
      lines.push('', '<i>' + Telegram_escape(sub) + '</i>');
      currentGroup = sub;
    }
    lines.push('· ' + Telegram_escape(p.display_name) +
               (p.role ? ' (' + Telegram_escape(p.role) + ')' : ''));
  });
  return lines;
}

function Cmd_prompt_(chatId) {
  // The literal true is what distinguishes a manual send from a trigger run.
  var report = sendDailyPrompt(true);
  Telegram_send(chatId,
    'Sent to ' + report.sent + '. Away ' + report.away +
    '. Failed ' + report.failed.length + '. Unlinked ' + report.unlinked.length + '.');
}

function Cmd_leave_(chatId, args, from) {
  var id = args.split(/\s+/)[0];
  if (!id) return Telegram_send(chatId, 'Usage: /leave &lt;person_id&gt;');
  var p = Roster_leave(id, Dates_today(), Cmd_actor_(from), '');
  Telegram_send(chatId, Telegram_escape(p.display_name) + ' is now ' + p.status +
                        '. Their records are untouched.');
}

function Cmd_setRole_(chatId, args, from) {
  var parts = args.split(/\s+/);
  var id = parts.shift();
  var role = parts.join(' ').trim();
  if (!id || !role) return Telegram_send(chatId, 'Usage: /setrole &lt;person_id&gt; &lt;role&gt;');
  var p = Roster_setRole(id, role, Cmd_actor_(from));
  Telegram_send(chatId, Telegram_escape(p.display_name) + ' is now ' + Telegram_escape(p.role) +
                        '. Past months still show the role held at the time.');
}

function Cmd_detach_(chatId, args, from) {
  var id = args.split(/\s+/)[0];
  if (!id) return Telegram_send(chatId, 'Usage: /detach &lt;person_id&gt;');
  var p = Roster_detach(id, Cmd_actor_(from), '');
  Telegram_send(chatId, Telegram_escape(p.display_name) + ' is detached: off the prompt list, still on the roster.');
}

function Cmd_attach_(chatId, args, from) {
  var id = args.split(/\s+/)[0];
  if (!id) return Telegram_send(chatId, 'Usage: /attach &lt;person_id&gt;');
  var p = Roster_reattach(id, Cmd_actor_(from), '');
  Telegram_send(chatId, Telegram_escape(p.display_name) + ' is active again.');
}

function Cmd_link_(chatId, args, from) {
  var parts = args.split(/\s+/);
  if (parts.length < 2) return Telegram_send(chatId, 'Usage: /link &lt;person_id&gt; &lt;telegram_id&gt;');
  var p = Roster_linkTelegram(parts[0], parts[1], '', Cmd_actor_(from));
  Telegram_send(chatId, Telegram_escape(p.display_name) + ' is linked to ' + parts[1] + '.');
}

function Cmd_rollover_(chatId) {
  var report = rolloverMonth(true);
  var added = Rollover_syncCurrentMonth();
  Telegram_send(chatId, 'Month ' + report.month + ': ' + report.carried +
                        ' on the tab, ' + added + ' added just now.');
}

function Cmd_health_(chatId) {
  var lines = ['<b>Health</b>'];
  lines.push('Timezone: ' + CONFIG.TIMEZONE + ' (manifest and config must agree)');
  lines.push('Roster: ' + Roster_all().length + ' total, ' + Roster_active().length + ' active');

  var unlinked = Roster_active().filter(function (p) {
    return !String(p.telegram_user_id || '').trim();
  });
  lines.push('Active without a linked account: ' + unlinked.length);

  var bad = Absence_malformed();
  lines.push('Absence rows with unreadable dates: ' + bad.length);
  if (bad.length) {
    bad.slice(0, 10).forEach(function (a) { lines.push('· row ' + a._row + ' (' + a.absence_id + ')'); });
  }

  var info = Telegram_getWebhookInfo();
  if (info.ok && info.result) {
    lines.push('Webhook pending: ' + info.result.pending_update_count);
    if (info.result.last_error_message) {
      lines.push('Last webhook error: ' + Telegram_escape(info.result.last_error_message));
    }
  } else {
    lines.push('Webhook info unavailable: ' + Telegram_escape(info.description));
  }

  var claim = PropertiesService.getScriptProperties().getProperty(CONFIG.PROPS.DAILY_CLAIM);
  lines.push('Today claimed: ' + (claim || 'no'));
  lines.push('Open conversation flows swept: ' + State_sweep());

  Telegram_sendLong(chatId, lines.join('\n'));
}

function Cmd_actor_(from) {
  return from && from.username ? '@' + from.username : String((from && from.id) || 'system');
}
