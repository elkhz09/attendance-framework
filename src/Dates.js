/**
 * Date handling.
 *
 * The one rule that matters: never write a user-typed "DD/MM/YYYY" string into
 * a cell. A sheet whose locale is MM/DD will accept "01/08/2026" and silently
 * store the 8th of January. Nothing errors, the cell looks plausible, and you
 * find out months later when a date range is wrong. Parse the string in code,
 * write a real Date object, then set an explicit number format.
 *
 * Dates_parseUserDate is deliberately strict. A string it cannot read with
 * certainty returns null so the caller can ask again, rather than guessing.
 */

/** Current date in the configured timezone, truncated to midnight. */
function Dates_today() {
  var now = new Date();
  var stamp = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return Dates_fromIso(stamp);
}

/** Parse 'yyyy-MM-dd' into a Date. Returns null if malformed. */
function Dates_fromIso(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  return Dates_build_(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** 'yyyy-MM-dd'. The only string form used as a key anywhere. */
function Dates_dayKey(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

/** Month tab name for a date, e.g. '2026-10'. */
function Dates_monthTab(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, CONFIG.MONTH_TAB_FORMAT);
}

/** Arbitrary display formatting. */
function Dates_format(date, pattern) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, pattern);
}

/** 1 = Monday ... 7 = Sunday, in the configured timezone. */
function Dates_isoWeekday(date) {
  return Number(Utilities.formatDate(date, CONFIG.TIMEZONE, 'u'));
}

/** Day of month as a number, 1-31. */
function Dates_dayOfMonth(date) {
  return Number(Utilities.formatDate(date, CONFIG.TIMEZONE, 'd'));
}

/** Number of days in the month containing date. */
function Dates_daysInMonth(date) {
  var y = Number(Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy'));
  var m = Number(Utilities.formatDate(date, CONFIG.TIMEZONE, 'MM'));
  return new Date(y, m, 0).getDate();
}

/** First day of the month containing date. */
function Dates_startOfMonth(date) {
  var y = Number(Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy'));
  var m = Number(Utilities.formatDate(date, CONFIG.TIMEZONE, 'MM'));
  return Dates_build_(y, m, 1);
}

/** First day of the month after the one containing date. */
function Dates_startOfNextMonth(date) {
  var y = Number(Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy'));
  var m = Number(Utilities.formatDate(date, CONFIG.TIMEZONE, 'MM'));
  return (m === 12) ? Dates_build_(y + 1, 1, 1) : Dates_build_(y, m + 1, 1);
}

/** date plus n days. */
function Dates_addDays(date, n) {
  var out = new Date(date.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

/** True if a <= d <= b, comparing day keys so time of day is irrelevant. */
function Dates_withinInclusive(d, a, b) {
  var k = Dates_dayKey(d);
  return k >= Dates_dayKey(a) && k <= Dates_dayKey(b);
}

/**
 * Parse a date typed by a human.
 *
 * Accepted:   dd/mm/yyyy   dd-mm-yyyy   dd.mm.yyyy   yyyy-mm-dd
 * Rejected:   anything ambiguous, and any calendar date that does not exist
 *             (31/04, 29/02 in a non-leap year).
 *
 * Two-digit years are rejected on purpose. "01/02/26" is not worth guessing at.
 */
function Dates_parseUserDate(text) {
  var s = String(text == null ? '' : text).trim();
  if (!s) return null;

  var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return Dates_build_(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  var dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (dmy) return Dates_build_(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return null;
}

/**
 * Write a Date into a cell with an explicit format.
 * Pass anything that is not a Date and the cell is cleared rather than
 * filled with a string that looks like a date but is not one.
 */
function Dates_writeDateCell(range, date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    range.clearContent();
    return;
  }
  range.setValue(date);
  range.setNumberFormat('dd/MM/yyyy');
}

/** Read a cell that should hold a Date. Returns a Date or null, never a guess. */
function Dates_readDateCell(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  // Legacy rows may hold a string. Only accept unambiguous forms.
  return Dates_parseUserDate(value);
}

/** Build and validate. Returns null if the calendar date does not exist. */
function Dates_build_(year, month, day) {
  if (!(year >= 1970 && year <= 2999)) return null;
  if (!(month >= 1 && month <= 12)) return null;
  if (!(day >= 1 && day <= 31)) return null;
  var d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;  // 31 April rolled over into 1 May
  }
  return d;
}
