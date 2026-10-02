/**
 * The roster ledger: one row per person, ever.
 *
 * This file is the point of the project.
 *
 * The obvious way to build an attendance sheet is to key it on the thing you
 * read out at the muster: the role, the post, the job title. It works for a
 * month and then it rots, because roles rotate and people do not. When the
 * person holding "Role 3" changes, every historical row filed under "Role 3"
 * silently becomes a record about somebody else. You cannot tell from the data
 * that it happened, you cannot repair it afterwards without external knowledge,
 * and the longer the system runs the more records it quietly mis-attributes.
 *
 * So: a person gets a person_id on the day they join, keeps it until the
 * records are deleted, and never gets it reused. Name, role and grouping are
 * snapshots. They can all change without touching a single historical row.
 *
 * Consequences worth stating, because they are the actual design:
 *
 *   - Month tabs store person_id as the key and name/role/group as frozen
 *     display copies. A tab from eight months ago still shows the role that
 *     person held that month, which is what you want when reading history.
 *   - Lifecycle is a status change plus a history row, never a deletion. A
 *     person who leaves is DEPARTED, not absent from the file.
 *   - A temporary detachment is a third status, not a departure, because the
 *     two need opposite treatment: a detached person stays on the roster and
 *     off the prompt list, a departed person leaves both.
 *   - telegram_user_id is a link, not an identity. People change accounts.
 */

var ROSTER_HEADERS = [
  'person_id',
  'display_name',
  'role',
  'group',
  'subgroup',
  'telegram_user_id',
  'telegram_username',
  'status',            // ACTIVE | DETACHED | DEPARTED
  'joined_on',
  'left_on',
  'sort_key',
  'notes'
];

var HISTORY_HEADERS = [
  'timestamp',
  'person_id',
  'field',
  'old_value',
  'new_value',
  'actor',
  'note'
];

var ROSTER_STATUS = { ACTIVE: 'ACTIVE', DETACHED: 'DETACHED', DEPARTED: 'DEPARTED' };

function Roster_sheet() {
  return Sheets_tab(CONFIG.SHEETS.ROSTER, ROSTER_HEADERS);
}

function History_sheet() {
  return Sheets_tab(CONFIG.SHEETS.HISTORY, HISTORY_HEADERS);
}

/** Every person ever on the roster, in sheet order. */
function Roster_all() {
  return Sheets_readRecords(Roster_sheet());
}

/** People who should receive the daily prompt: ACTIVE only. */
function Roster_active() {
  return Roster_all().filter(function (p) {
    return String(p.status).toUpperCase() === ROSTER_STATUS.ACTIVE;
  });
}

/** People who belong on a month tab: ACTIVE and DETACHED. */
function Roster_onBooks() {
  return Roster_all().filter(function (p) {
    var s = String(p.status).toUpperCase();
    return s === ROSTER_STATUS.ACTIVE || s === ROSTER_STATUS.DETACHED;
  });
}

function Roster_byPersonId(personId) {
  var want = String(personId).trim().toUpperCase();
  var found = Roster_all().filter(function (p) {
    return String(p.person_id).trim().toUpperCase() === want;
  });
  return found.length ? found[0] : null;
}

/**
 * Resolve a Telegram account to a person. Returns null if the account is not
 * linked, which is the normal state for someone who has never run /start.
 */
function Roster_byTelegramId(telegramUserId) {
  var want = String(telegramUserId).trim();
  var found = Roster_all().filter(function (p) {
    return String(p.telegram_user_id).trim() === want;
  });
  return found.length ? found[0] : null;
}

/** Presentation order: configured subgroup order, then sort_key, then name. */
function Roster_sorted(people) {
  var order = CONFIG.SUBGROUP_ORDER || [];
  function rank(sub) {
    var i = order.indexOf(String(sub));
    return i === -1 ? order.length : i;
  }
  return people.slice().sort(function (a, b) {
    var ra = rank(a.subgroup), rb = rank(b.subgroup);
    if (ra !== rb) return ra - rb;
    var sa = String(a.subgroup), sb = String(b.subgroup);
    if (sa !== sb) return sa < sb ? -1 : 1;
    var ka = Number(a.sort_key) || 0, kb = Number(b.sort_key) || 0;
    if (ka !== kb) return ka - kb;
    return String(a.display_name) < String(b.display_name) ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle. Every mutation writes a history row.
// ---------------------------------------------------------------------------

/**
 * Add a person. Mints the next person_id inside the lock, so two concurrent
 * joins cannot collide on the same id.
 *
 * @return {Object} the new roster record
 */
function Roster_join(fields, actor) {
  return Locks_with('roster', function () {
    var sheet = Roster_sheet();
    var personId = Roster_nextPersonId_nolock_(sheet);
    var record = {
      person_id: personId,
      display_name: String(fields.displayName || '').trim(),
      role: String(fields.role || '').trim(),
      group: String(fields.group || '').trim(),
      subgroup: String(fields.subgroup || '').trim(),
      telegram_user_id: fields.telegramUserId ? String(fields.telegramUserId) : '',
      telegram_username: fields.telegramUsername ? String(fields.telegramUsername) : '',
      status: ROSTER_STATUS.ACTIVE,
      joined_on: fields.joinedOn instanceof Date ? fields.joinedOn : Dates_today(),
      left_on: '',
      sort_key: fields.sortKey == null ? '' : fields.sortKey,
      notes: fields.notes || ''
    };
    Sheets_appendRecord(sheet, record);
    History_record_nolock_(personId, 'joined', '', record.display_name, actor, '');
    Locks_flush();
    return record;
  });
}

/** Mint the next person_id. Must be called with the roster lock held. */
function Roster_nextPersonId_nolock_(sheet) {
  var prefix = CONFIG.PERSON_ID_PREFIX;
  var width = CONFIG.PERSON_ID_WIDTH;
  var highest = 0;
  Sheets_readRecords(sheet).forEach(function (p) {
    var m = new RegExp('^' + prefix + '(\\d+)$').exec(String(p.person_id).trim().toUpperCase());
    if (m) highest = Math.max(highest, Number(m[1]));
  });
  var next = String(highest + 1);
  while (next.length < width) next = '0' + next;
  return prefix + next;
}

/** Link a Telegram account to an existing person, e.g. on /start. */
function Roster_linkTelegram(personId, telegramUserId, telegramUsername, actor) {
  return Roster_update_(personId, actor, function (sheet, row, before) {
    Sheets_setCell(sheet, row, 'telegram_user_id', String(telegramUserId));
    Sheets_setCell(sheet, row, 'telegram_username', String(telegramUsername || ''));
    History_record_nolock_(personId, 'telegram_user_id',
      before.telegram_user_id, telegramUserId, actor, '');
  });
}

/** Change the role snapshot. History is preserved because the key never moves. */
function Roster_setRole(personId, newRole, actor) {
  return Roster_update_(personId, actor, function (sheet, row, before) {
    Sheets_setCell(sheet, row, 'role', String(newRole).trim());
    History_record_nolock_(personId, 'role', before.role, newRole, actor, '');
  });
}

/** Change the display name snapshot. */
function Roster_rename(personId, newName, actor) {
  return Roster_update_(personId, actor, function (sheet, row, before) {
    Sheets_setCell(sheet, row, 'display_name', String(newName).trim());
    History_record_nolock_(personId, 'display_name', before.display_name, newName, actor, '');
  });
}

/** Move a person between groupings. */
function Roster_setGroup(personId, group, subgroup, actor) {
  return Roster_update_(personId, actor, function (sheet, row, before) {
    Sheets_setCell(sheet, row, 'group', String(group).trim());
    Sheets_setCell(sheet, row, 'subgroup', String(subgroup).trim());
    History_record_nolock_(personId, 'group',
      before.group + '/' + before.subgroup, group + '/' + subgroup, actor, '');
  });
}

/**
 * Person leaves. The row stays, the status changes, left_on is stamped.
 * Nothing historical is touched or deleted.
 */
function Roster_leave(personId, leftOn, actor, note) {
  return Roster_update_(personId, actor, function (sheet, row, before) {
    Sheets_setCell(sheet, row, 'status', ROSTER_STATUS.DEPARTED);
    Sheets_setCell(sheet, row, 'left_on', leftOn instanceof Date ? leftOn : Dates_today());
    History_record_nolock_(personId, 'status', before.status, ROSTER_STATUS.DEPARTED, actor, note || '');
  });
}

/**
 * Temporary detachment. Off the prompt list, still on the roster, still on the
 * month tab. Deliberately a separate status from DEPARTED: conflating the two
 * is how a detached person ends up chased every morning, or dropped from the
 * roster and quietly lost.
 */
function Roster_detach(personId, actor, note) {
  return Roster_update_(personId, actor, function (sheet, row, before) {
    Sheets_setCell(sheet, row, 'status', ROSTER_STATUS.DETACHED);
    History_record_nolock_(personId, 'status', before.status, ROSTER_STATUS.DETACHED, actor, note || '');
  });
}

/** Return a detached person to the active list. */
function Roster_reattach(personId, actor, note) {
  return Roster_update_(personId, actor, function (sheet, row, before) {
    Sheets_setCell(sheet, row, 'status', ROSTER_STATUS.ACTIVE);
    History_record_nolock_(personId, 'status', before.status, ROSTER_STATUS.ACTIVE, actor, note || '');
  });
}

/** Shared read-modify-write wrapper. Holds the roster lock for the whole edit. */
function Roster_update_(personId, actor, mutate) {
  return Locks_with('roster', function () {
    var sheet = Roster_sheet();
    var before = null;
    Sheets_readRecords(sheet).forEach(function (p) {
      if (String(p.person_id).trim().toUpperCase() === String(personId).trim().toUpperCase()) {
        before = p;
      }
    });
    if (!before) throw new Error('Unknown person_id: ' + personId);
    mutate(sheet, before._row, before);
    Locks_flush();
    return Roster_byPersonId(personId);
  });
}

/**
 * Append a history row.
 *
 * The _nolock_ suffix is the convention used throughout: it means "this
 * function does not take a lock and must only be called from inside one".
 * History_record is the version safe to call from outside.
 */
function History_record_nolock_(personId, field, oldValue, newValue, actor, note) {
  Sheets_appendRecord(History_sheet(), {
    timestamp: new Date(),
    person_id: personId,
    field: field,
    old_value: oldValue == null ? '' : String(oldValue),
    new_value: newValue == null ? '' : String(newValue),
    actor: actor == null ? '' : String(actor),
    note: note || ''
  });
}

/** Lock-taking wrapper, for callers not already inside a critical section. */
function History_record(personId, field, oldValue, newValue, actor, note) {
  return Locks_with('roster', function () {
    History_record_nolock_(personId, field, oldValue, newValue, actor, note);
  });
}
