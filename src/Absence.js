/**
 * Planned absence.
 *
 * A person who is on leave should not be prompted every morning, and should not
 * appear on the outstanding list at the muster. Both of those are noise, and
 * noise is what makes an outstanding list stop being read.
 *
 * An absence is a date range recorded once, in advance. The daily prompt reads
 * it and suppresses that person; the month tab is marked AWAY for those days so
 * the record says why the cell is not a reply, rather than leaving a blank that
 * looks like a missing answer.
 *
 * Absences are never edited in place. Cancelling one sets its status and leaves
 * the row, so the question "who told us they would be away, and when did they
 * tell us" stays answerable.
 */

var ABSENCE_HEADERS = [
  'absence_id',
  'person_id',
  'kind',
  'start_date',
  'end_date',
  'location',
  'status',          // OPEN | CANCELLED
  'recorded_at',
  'recorded_by'
];

var ABSENCE_KINDS = ['LEAVE', 'OFFSITE', 'COURSE', 'MEDICAL'];
var ABSENCE_STATUS = { OPEN: 'OPEN', CANCELLED: 'CANCELLED' };

function Absence_sheet() {
  return Sheets_tab(CONFIG.SHEETS.ABSENCE, ABSENCE_HEADERS);
}

/**
 * Record an absence.
 * Dates must already be Date objects; the caller parses user input with
 * Dates_parseUserDate and asks again on null rather than passing a guess.
 */
function Absence_add(personId, kind, startDate, endDate, location, actor) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
    throw new Error('Absence_add requires Date objects, not strings.');
  }
  if (Dates_dayKey(endDate) < Dates_dayKey(startDate)) {
    throw new Error('End date is before start date.');
  }
  if (ABSENCE_KINDS.indexOf(String(kind).toUpperCase()) === -1) {
    throw new Error('Unknown absence kind: ' + kind);
  }

  return Locks_with('absence', function () {
    var sheet = Absence_sheet();
    var id = 'A' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMddHHmmss') +
             '-' + Math.floor(Math.random() * 1000);
    Sheets_appendRecord(sheet, {
      absence_id: id,
      person_id: personId,
      kind: String(kind).toUpperCase(),
      start_date: startDate,
      end_date: endDate,
      location: location || '',
      status: ABSENCE_STATUS.OPEN,
      recorded_at: new Date(),
      recorded_by: actor == null ? '' : String(actor)
    });
    Locks_flush();
    return id;
  });
}

/** Cancel an absence. The row stays; only the status changes. */
function Absence_cancel(absenceId, actor) {
  return Locks_with('absence', function () {
    var sheet = Absence_sheet();
    var target = null;
    Sheets_readRecords(sheet).forEach(function (a) {
      if (String(a.absence_id) === String(absenceId)) target = a;
    });
    if (!target) throw new Error('Unknown absence_id: ' + absenceId);
    Sheets_setCell(sheet, target._row, 'status', ABSENCE_STATUS.CANCELLED);
    History_record_nolock_(target.person_id, 'absence_cancelled',
      absenceId, ABSENCE_STATUS.CANCELLED, actor, '');
    Locks_flush();
    return true;
  });
}

/**
 * Map of person_id to the absence covering a given date.
 * One read of the sheet, used by both the prompt and the summary so the two
 * cannot disagree about who is away.
 */
function Absence_onDate(date) {
  var out = {};
  Sheets_readRecords(Absence_sheet()).forEach(function (a) {
    if (String(a.status).toUpperCase() !== ABSENCE_STATUS.OPEN) return;
    var start = Dates_readDateCell(a.start_date);
    var end = Dates_readDateCell(a.end_date);
    if (!start || !end) return;   // unreadable row: ignored, never guessed at
    if (Dates_withinInclusive(date, start, end)) {
      out[String(a.person_id)] = a;
    }
  });
  return out;
}

/** All absences for one person, newest first. */
function Absence_forPerson(personId) {
  return Sheets_readRecords(Absence_sheet())
    .filter(function (a) { return String(a.person_id) === String(personId); })
    .sort(function (x, y) {
      var a = Dates_readDateCell(x.start_date), b = Dates_readDateCell(y.start_date);
      if (!a || !b) return 0;
      return b.getTime() - a.getTime();
    });
}

/**
 * Rows on the absence sheet that cannot be read as dates.
 * Surfaced by /health rather than silently skipped, because a quietly ignored
 * absence row means someone gets chased while they are on leave.
 */
function Absence_malformed() {
  return Sheets_readRecords(Absence_sheet()).filter(function (a) {
    return !Dates_readDateCell(a.start_date) || !Dates_readDateCell(a.end_date);
  });
}
