/**
 * Sheet access.
 *
 * Every read and write goes through a header-name lookup, never a hardcoded
 * column index. Someone will insert a column one day, and when they do nothing
 * here should move. The cost is one extra read of row 1; the benefit is that
 * the sheet stays a human-editable artefact rather than a fragile fixture.
 */

var SHEETS_CACHE_ = { book: null, headers: {} };

/** The spreadsheet. Opened once per execution. */
function Sheets_book() {
  if (!SHEETS_CACHE_.book) {
    SHEETS_CACHE_.book = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return SHEETS_CACHE_.book;
}

/**
 * Get a tab, creating it with the given headers if absent.
 * Headers are written once, on creation, and never rewritten afterwards.
 */
function Sheets_tab(name, headers) {
  var book = Sheets_book();
  var sheet = book.getSheetByName(name);
  if (sheet) return sheet;
  if (!headers) {
    throw new Error('Tab "' + name + '" does not exist and no headers were supplied.');
  }
  sheet = book.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

/** Map of header text to 1-based column number. */
function Sheets_headerMap(sheet) {
  var key = sheet.getSheetName();
  if (SHEETS_CACHE_.headers[key]) return SHEETS_CACHE_.headers[key];
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  var row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < row.length; i++) {
    var h = String(row[i]).trim();
    if (h) map[h] = i + 1;
  }
  SHEETS_CACHE_.headers[key] = map;
  return map;
}

/** Column number for a header. Throws rather than writing to the wrong column. */
function Sheets_col(sheet, header) {
  var col = Sheets_headerMap(sheet)[header];
  if (!col) {
    throw new Error('Column "' + header + '" not found on tab "' + sheet.getSheetName() + '".');
  }
  return col;
}

/** True if the header exists. For optional columns added by later versions. */
function Sheets_hasCol(sheet, header) {
  return !!Sheets_headerMap(sheet)[header];
}

/**
 * All data rows as objects, plus a _row property holding the sheet row number.
 * Blank rows are skipped. Cell values are returned raw, so a Date stays a Date.
 */
function Sheets_readRecords(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var map = Sheets_headerMap(sheet);
  var headers = Object.keys(map);
  var out = [];

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var blank = true;
    for (var c = 0; c < row.length; c++) {
      if (row[c] !== '' && row[c] !== null) { blank = false; break; }
    }
    if (blank) continue;

    var rec = { _row: r + 2 };
    for (var h = 0; h < headers.length; h++) {
      rec[headers[h]] = row[map[headers[h]] - 1];
    }
    out.push(rec);
  }
  return out;
}

/**
 * Append one record. Values are placed by header name; unknown keys are
 * ignored rather than shifting the row.
 *
 * Caller is responsible for holding a lock if the append is part of a
 * read-modify-write. See Locks.js.
 */
function Sheets_appendRecord(sheet, record) {
  var map = Sheets_headerMap(sheet);
  var width = sheet.getLastColumn();
  var row = new Array(width).fill('');
  var dateCols = [];

  Object.keys(record).forEach(function (key) {
    var col = map[key];
    if (!col) return;
    var value = record[key];
    if (value instanceof Date) {
      dateCols.push(col);
      row[col - 1] = value;
    } else {
      row[col - 1] = (value == null) ? '' : value;
    }
  });

  var target = sheet.getLastRow() + 1;
  sheet.getRange(target, 1, 1, width).setValues([row]);
  dateCols.forEach(function (col) {
    sheet.getRange(target, col).setNumberFormat('dd/MM/yyyy');
  });
  return target;
}

/** Write one cell by header name. Dates get a real Date plus a format. */
function Sheets_setCell(sheet, row, header, value) {
  var range = sheet.getRange(row, Sheets_col(sheet, header));
  if (value instanceof Date) {
    Dates_writeDateCell(range, value);
  } else {
    range.setValue(value == null ? '' : value);
  }
}

/** Read one cell by header name. */
function Sheets_getCell(sheet, row, header) {
  return sheet.getRange(row, Sheets_col(sheet, header)).getValue();
}

/**
 * Drop the per-execution header cache. Call after inserting a column, because
 * the cached map is now one column short and every later write would be off.
 */
function Sheets_resetCache() {
  SHEETS_CACHE_.headers = {};
}
