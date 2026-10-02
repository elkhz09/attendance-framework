/**
 * Checks for the pure functions.
 *
 * Apps Script has no test runner, so this is a plain function you run from the
 * editor. It touches no sheet and sends no message, which means it is safe to
 * run against production. It only covers the parts that are decidable without
 * a spreadsheet, which is honest about what it is: the date parser and the
 * message chunker, the two places where a quiet wrong answer does real damage.
 *
 * Run SelfTest_run and read the log. A failure throws at the end with the list.
 */

function SelfTest_run() {
  var failures = [];

  function check(label, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    if (a !== b) failures.push(label + ': got ' + a + ', wanted ' + b);
  }

  // --- date parsing -------------------------------------------------------
  // The whole point is that dd/mm is read as dd/mm regardless of any locale.
  var d = Dates_parseUserDate('01/08/2026');
  check('01/08/2026 is the 1st of August',
    d && [d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 8, 1]);

  var iso = Dates_parseUserDate('2026-08-01');
  check('iso form agrees',
    iso && [iso.getFullYear(), iso.getMonth() + 1, iso.getDate()], [2026, 8, 1]);

  check('separators are interchangeable',
    !!Dates_parseUserDate('01-08-2026') && !!Dates_parseUserDate('01.08.2026'), true);

  // Dates that do not exist must be refused, not rolled over into the next
  // month. new Date(2026, 3, 31) silently becomes 1 May.
  check('31 April is refused', Dates_parseUserDate('31/04/2026'), null);
  check('29 Feb in a non-leap year is refused', Dates_parseUserDate('29/02/2026'), null);
  check('29 Feb in a leap year is accepted', !!Dates_parseUserDate('29/02/2028'), true);

  // Ambiguity is refused rather than guessed.
  check('two-digit years are refused', Dates_parseUserDate('01/08/26'), null);
  check('month 13 is refused', Dates_parseUserDate('01/13/2026'), null);
  check('empty is refused', Dates_parseUserDate(''), null);
  check('nonsense is refused', Dates_parseUserDate('tomorrow'), null);

  // --- day column headers -------------------------------------------------
  check('day 1 header', Attendance_dayHeader(1), 'd01');
  check('day 31 header', Attendance_dayHeader(31), 'd31');

  // --- message chunking ---------------------------------------------------
  // Telegram rejects an over-long message outright rather than truncating, so
  // the chunker must never emit a piece above the limit.
  var long = [];
  for (var i = 0; i < 400; i++) long.push('line ' + i);
  var chunks = Telegram_chunk(long.join('\n'), 200);
  var oversize = chunks.filter(function (c) { return c.length > 200; });
  check('no chunk exceeds the limit', oversize.length, 0);
  check('nothing is lost', chunks.join('\n').replace(/\n/g, ''), long.join('').replace(/\n/g, ''));

  var single = Telegram_chunk('x'.repeat(500), 200);
  check('an over-long single line is split, not dropped', single.length, 3);
  check('empty text yields one empty chunk', Telegram_chunk('', 200), ['']);

  // --- HTML escaping ------------------------------------------------------
  check('escaping', Telegram_escape('a<b>&c'), 'a&lt;b&gt;&amp;c');

  // --- report -------------------------------------------------------------
  if (failures.length) {
    failures.forEach(function (f) { Logger.log('FAIL %s', f); });
    throw new Error(failures.length + ' self-test failure(s); see the log.');
  }
  Logger.log('self-test passed');
  return true;
}
