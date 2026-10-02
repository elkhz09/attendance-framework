/**
 * Month tabs and reply capture.
 *
 * Layout: one row per person, one column per day of the month. Keyed on
 * person_id; display_name, role and subgroup are frozen snapshots taken when
 * the tab was generated, so a tab read a year later shows who those people were
 * at the time rather than who holds those roles now.
 *
 * Day columns are named d01..d31 rather than 1..31. A header of "01" gets
 * coerced to the number 1 by Sheets, which then no longer matches a string
 * lookup. The prefix costs nothing and removes the class of bug.
 *
 * The cell value is the response and nothing else. When the reply was received,
 * and from which account, goes in the cell note. That keeps the grid readable
 * by a human and still answers "when did they actually say this".
 */

var ATTENDANCE_FIXED_HEADERS = ['person_id', 'display_name', 'role', 'group', 'subgroup'];

/** Column header for a day number. */
function Attendance_dayHeader(dayNumber) {
  var n = String(dayNumber);
  return 'd' + (n.length < 2 ? '0' + n : n);
}

/**
 * The month tab for a date, generated from the roster if it does not exist.
 * Generation is idempotent: calling it twice does not duplicate rows.
 */
function Attendance_monthSheet(date) {
  var name = Dates_monthTab(date);
  var book = Sheets_book();
  var existing = book.getSheetByName(name);
  if (existing) return existing;

  return Locks_with('month-tab', function () {
    // Re-check inside the lock. Two webhook executions on the 1st of the month
    // will both find the tab missing outside it.
    var again = Sheets_book().getSheetByName(name);
    if (again) return again;
    return Attendance_buildMonth_nolock_(name, date);
  });
}

/** Build a month tab from the current roster. Requires the month-tab lock. */
function Attendance_buildMonth_nolock_(name, date) {
  var days = Dates_daysInMonth(date);
  var headers = ATTENDANCE_FIXED_HEADERS.slice();
  for (var d = 1; d <= days; d++) headers.push(Attendance_dayHeader(d));

  var sheet = Sheets_tab(name, headers);
  Sheets_resetCache();

  var people = Roster_sorted(Roster_onBooks());
  if (people.length) {
    var rows = people.map(function (p) {
      var row = [p.person_id, p.display_name, p.role, p.group, p.subgroup];
      for (var i = 0; i < days; i++) row.push('');
      return row;
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenColumns(2);
  Locks_flush();
  return sheet;
}

/**
 * Row number for a person on a month tab, adding the row if they joined after
 * the tab was generated. Requires the month-tab lock.
 */
function Attendance_personRow_nolock_(sheet, personId) {
  var records = Sheets_readRecords(sheet);
  for (var i = 0; i < records.length; i++) {
    if (String(records[i].person_id).trim().toUpperCase() === String(personId).trim().toUpperCase()) {
      return records[i]._row;
    }
  }
  var person = Roster_byPersonId(personId);
  if (!person) throw new Error('Unknown person_id: ' + personId);
  return Sheets_appendRecord(sheet, {
    person_id: person.person_id,
    display_name: person.display_name,
    role: person.role,
    group: person.group,
    subgroup: person.subgroup
  });
}

/**
 * Record one person's reply for one day.
 *
 * Holds the month-tab lock across read-and-write, because a person tapping the
 * button twice in quick succession produces two concurrent executions, and
 * because a mid-month joiner may need a row appended as part of the same
 * operation.
 *
 * @param {string} responseKey  A key of CONFIG.RESPONSES, e.g. 'PRESENT'.
 * @return {{value: string, late: boolean}}
 */
function Attendance_record(personId, date, responseKey, actor) {
  var value = CONFIG.RESPONSES[responseKey];
  if (!value) throw new Error('Unknown response: ' + responseKey);

  var sheet = Attendance_monthSheet(date);
  var header = Attendance_dayHeader(Dates_dayOfMonth(date));

  return Locks_with('month-tab', function () {
    var row = Attendance_personRow_nolock_(sheet, personId);
    var cell = sheet.getRange(row, Sheets_col(sheet, header));
    cell.setValue(value);
    cell.setNote('recorded ' + Dates_format(new Date(), 'yyyy-MM-dd HH:mm') +
                 (actor ? ' by ' + actor : ''));
    // Flush before the caller tells the person it was saved. Without this the
    // write can still be pending when the execution ends.
    Locks_flush();
    var hour = Number(Dates_format(new Date(), 'H'));
    return { value: value, late: hour >= CONFIG.REPLY_CUTOFF_HOUR };
  });
}

/** Current cell value for a person on a date, or '' if blank. */
function Attendance_get(personId, date) {
  var sheet = Attendance_monthSheet(date);
  var header = Attendance_dayHeader(Dates_dayOfMonth(date));
  var records = Sheets_readRecords(sheet);
  for (var i = 0; i < records.length; i++) {
    if (String(records[i].person_id).trim().toUpperCase() === String(personId).trim().toUpperCase()) {
      return String(records[i][header] == null ? '' : records[i][header]).trim();
    }
  }
  return '';
}

/**
 * Write AWAY into the day cell for everyone with an open absence covering it.
 * Run before the prompt goes out, so the grid distinguishes "away" from
 * "has not answered".
 */
function Attendance_markAway(date) {
  var away = Absence_onDate(date);
  var ids = Object.keys(away);
  if (!ids.length) return 0;

  var sheet = Attendance_monthSheet(date);
  var header = Attendance_dayHeader(Dates_dayOfMonth(date));

  return Locks_with('month-tab', function () {
    var col = Sheets_col(sheet, header);
    var written = 0;
    var records = Sheets_readRecords(sheet);
    records.forEach(function (rec) {
      var id = String(rec.person_id);
      if (!away[id]) return;
      var current = String(rec[header] == null ? '' : rec[header]).trim();
      if (current) return;              // never overwrite a real answer
      var cell = sheet.getRange(rec._row, col);
      cell.setValue(CONFIG.RESPONSES.AWAY);
      cell.setNote(away[id].kind + ' recorded ' + away[id].absence_id);
      written++;
    });
    Locks_flush();
    return written;
  });
}

/**
 * Who still owes a reply for a date.
 * Active roster, minus anyone away, minus anyone whose cell is already filled.
 */
function Attendance_outstanding(date) {
  var away = Absence_onDate(date);
  var sheet = Attendance_monthSheet(date);
  var header = Attendance_dayHeader(Dates_dayOfMonth(date));
  var filled = {};
  Sheets_readRecords(sheet).forEach(function (rec) {
    var v = String(rec[header] == null ? '' : rec[header]).trim();
    if (v) filled[String(rec.person_id)] = v;
  });

  return Roster_sorted(Roster_active()).filter(function (p) {
    var id = String(p.person_id);
    return !away[id] && !filled[id];
  });
}

/**
 * Counts and lists for a date.
 * Reads the month tab once and the absence sheet once, so every figure in the
 * summary is derived from the same snapshot.
 */
function Attendance_summary(date) {
  var sheet = Attendance_monthSheet(date);
  var header = Attendance_dayHeader(Dates_dayOfMonth(date));
  var away = Absence_onDate(date);

  // One read of the roster, indexed twice. Re-reading it per row turns a
  // summary into dozens of sheet calls and a slow command looks like a broken one.
  var everyone = {};
  Roster_all().forEach(function (p) { everyone[String(p.person_id)] = p; });
  var active = Roster_active();
  var activeIds = {};
  active.forEach(function (p) { activeIds[String(p.person_id)] = true; });

  var counts = {};
  var byValue = {};
  Sheets_readRecords(sheet).forEach(function (rec) {
    var id = String(rec.person_id);
    if (!activeIds[id] && !away[id]) return;       // departed people are not counted
    var v = String(rec[header] == null ? '' : rec[header]).trim();
    if (!v) return;
    counts[v] = (counts[v] || 0) + 1;
    (byValue[v] = byValue[v] || []).push(everyone[id] || { person_id: id, display_name: id });
  });

  var outstanding = Attendance_outstanding(date);
  return {
    date: date,
    rosterActive: active.length,
    awayCount: Object.keys(away).length,
    counts: counts,
    byValue: byValue,
    outstanding: outstanding
  };
}
