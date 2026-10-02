/**
 * Configuration template.
 *
 * Copy this file to src/Config.js and fill it in. src/Config.js is gitignored,
 * so your real identifiers never enter version control.
 *
 *   cp config.example.js src/Config.js
 *
 * The bot token and the webhook secret do NOT belong in this file either. Put
 * them in Script Properties (File > Project Settings > Script Properties, or
 * run Setup_writeSecrets once from the editor) so they are not in the code at
 * all. Everything here is non-secret wiring.
 */

var CONFIG = {

  // ---- Spreadsheet -------------------------------------------------------
  // The sheet that holds the roster, the month tabs and the absence log.
  // From its URL: docs.google.com/spreadsheets/d/<THIS PART>/edit
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',

  // Tab names. Change them if you prefer, but keep them stable afterwards.
  SHEETS: {
    ROSTER: 'Roster',
    ABSENCE: 'Absence',
    HISTORY: 'History'
  },

  // Month tabs are named with this pattern. yyyy-MM sorts correctly and is
  // locale-proof, which matters more than looking pretty.
  MONTH_TAB_FORMAT: 'yyyy-MM',

  // ---- Time -------------------------------------------------------------
  // Must match the timeZone in src/appsscript.json. If they disagree, the
  // scheduled send and the date the reply is written against will drift apart.
  TIMEZONE: 'UTC',

  // Hour of the daily prompt, 0-23, in TIMEZONE. Apps Script time triggers are
  // best-effort and fire within roughly an hour of the slot, so do not build a
  // process that needs the message at an exact minute. See docs/OPERATIONS.md.
  PROMPT_HOUR: 7,

  // Days the prompt goes out. 1 = Monday ... 7 = Sunday.
  PROMPT_DAYS: [1, 2, 3, 4, 5],

  // Replies are accepted for the current day only, up to this hour. After it,
  // a late reply is still recorded but flagged late in the summary.
  REPLY_CUTOFF_HOUR: 9,

  // ---- Identity ---------------------------------------------------------
  // person_id prefix and width. P0001, P0002, ... Never reuse an id.
  PERSON_ID_PREFIX: 'P',
  PERSON_ID_WIDTH: 4,

  // ---- Organisation vocabulary -------------------------------------------
  // Two free-text grouping levels. Rename them to whatever your organisation
  // actually uses. They are snapshots on the month tab, not keys.
  GROUP_LABEL: 'Team',
  SUBGROUP_LABEL: 'Dept',

  // Display order for the subgroup column. Anything not listed sorts last,
  // alphabetically. This only affects presentation.
  SUBGROUP_ORDER: ['Dept 1', 'Dept 2', 'Dept 3'],

  // ---- Attendance vocabulary --------------------------------------------
  // The values written into a day cell. Keys are stable, labels are cosmetic.
  RESPONSES: {
    PRESENT: 'IN',
    REMOTE: 'REMOTE',
    ABSENT: 'OUT',
    AWAY: 'AWAY',        // written by the absence suppressor, not by a person
    DETACHED: 'DET'      // temporarily posted elsewhere, still on the roster
  },

  // Buttons offered on the daily prompt, in order.
  PROMPT_OPTIONS: ['PRESENT', 'REMOTE', 'ABSENT'],

  // ---- Telegram ---------------------------------------------------------
  // Telegram numeric user ids allowed to run admin commands. Find yours by
  // sending /whoami to the bot once it is live.
  ADMIN_TELEGRAM_IDS: [000000001, 000000002],

  // Longest single outbound message. Telegram's hard cap is 4096 characters
  // and it rejects the whole message, not the tail. Leave headroom.
  MAX_MESSAGE_CHARS: 3500,

  // ---- Conversation state ------------------------------------------------
  // How long a half-finished flow (/broadcast, /join) stays open before it is
  // discarded. Without a TTL an abandoned flow swallows the person's next
  // unrelated message, possibly days later.
  STATE_TTL_MINUTES: 30,

  // ---- Housekeeping ------------------------------------------------------
  // How many month tabs stay visible. Older ones are hidden, never deleted and
  // never moved to a second workbook: splitting the data across files breaks
  // the one thing the roster ledger exists to provide, a single identity spine.
  VISIBLE_MONTHS: 3,

  // ---- Property keys ----------------------------------------------------
  // Script Property names. Secrets live under the first two.
  PROPS: {
    BOT_TOKEN: 'BOT_TOKEN',
    WEBHOOK_SECRET: 'WEBHOOK_SECRET',
    DAILY_CLAIM: 'DAILY_SEND_CLAIM',
    LAST_ROLLOVER: 'LAST_ROLLOVER'
  }
};
