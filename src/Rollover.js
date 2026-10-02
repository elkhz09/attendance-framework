/**
 * Month rollover.
 *
 * Month tabs are created lazily, so strictly speaking nothing has to run on the
 * 1st. This exists so the tab is present and populated before the first prompt
 * of the month rather than being built inside a webhook execution while someone
 * is waiting, and so old tabs get hidden instead of accumulating in front of the
 * people who use the sheet by hand.
 *
 * Who carries forward:
 *   ACTIVE    yes
 *   DETACHED  yes, they are still on the books
 *   DEPARTED  no
 *
 * Nothing is deleted. A departed person's rows on previous tabs stay exactly as
 * they were, which is the whole reason identity is keyed on person_id.
 */

/**
 * Trigger entry point. Same argument trap as the daily prompt: a trigger passes
 * an event object, so only the literal true counts as a manual force.
 */
function rolloverMonth(force) {
  var manual = (force === true);
  var today = Dates_today();
  var tab = Dates_monthTab(today);
  var props = PropertiesService.getScriptProperties();

  if (!manual && props.getProperty(CONFIG.PROPS.LAST_ROLLOVER) === tab) {
    Logger.log('rollover: %s already done', tab);
    return { skipped: 'already-done', month: tab };
  }

  var sheet = Attendance_monthSheet(today);
  var carried = Sheets_readRecords(sheet).length;
  Rollover_hideOldTabs_();
  props.setProperty(CONFIG.PROPS.LAST_ROLLOVER, tab);

  var report = { month: tab, carried: carried, manual: manual };
  Logger.log(JSON.stringify(report));
  return report;
}

/**
 * Hide month tabs older than CONFIG.VISIBLE_MONTHS. Hidden, not deleted, and
 * not moved to another file: a second workbook sounds tidier until you need the
 * identity spine to span both of them.
 */
function Rollover_hideOldTabs_() {
  var keep = Number(CONFIG.VISIBLE_MONTHS) || 3;
  var pattern = /^\d{4}-\d{2}$/;
  var months = Sheets_book().getSheets()
    .filter(function (s) { return pattern.test(s.getName()); })
    .sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });

  var hidden = 0;
  months.forEach(function (sheet, index) {
    if (index < keep) {
      if (sheet.isSheetHidden()) sheet.showSheet();
    } else if (!sheet.isSheetHidden()) {
      sheet.hideSheet();
      hidden++;
    }
  });
  return hidden;
}

/**
 * Bring forward anyone who joined after this month's tab was generated.
 * Safe to run repeatedly; it only appends rows that are missing.
 */
function Rollover_syncCurrentMonth() {
  var today = Dates_today();
  var sheet = Attendance_monthSheet(today);

  return Locks_with('month-tab', function () {
    var present = {};
    Sheets_readRecords(sheet).forEach(function (r) {
      present[String(r.person_id).trim().toUpperCase()] = true;
    });

    var added = 0;
    Roster_sorted(Roster_onBooks()).forEach(function (p) {
      if (present[String(p.person_id).trim().toUpperCase()]) return;
      Sheets_appendRecord(sheet, {
        person_id: p.person_id,
        display_name: p.display_name,
        role: p.role,
        group: p.group,
        subgroup: p.subgroup
      });
      added++;
    });
    Locks_flush();
    return added;
  });
}
