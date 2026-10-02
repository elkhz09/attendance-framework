/**
 * Conversation state for multi-step flows.
 *
 * Two traps.
 *
 * 1. Do not use UserProperties for this.
 *    A web app deployed as USER_DEPLOYING runs as one account for everybody, so
 *    PropertiesService.getUserProperties() is a single shared store rather than
 *    per-person storage. Two people in a flow at once would overwrite each
 *    other. State is therefore kept in Script Properties, explicitly keyed by
 *    the Telegram user id.
 *
 * 2. State needs a TTL and an explicit exit.
 *    Script Properties do not expire. A person who starts /broadcast, gets
 *    distracted and closes the app leaves an open flow behind. Their next
 *    message, whenever it comes, gets swallowed as an answer to a question they
 *    have long forgotten. Every flow therefore carries an expiry, and /cancel is
 *    always available and always acknowledged.
 */

function State_key_(telegramUserId) {
  return 'state:' + String(telegramUserId);
}

/**
 * Current flow for a user, or null.
 * An expired record is deleted on read rather than returned.
 */
function State_get(telegramUserId) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(State_key_(telegramUserId));
  if (!raw) return null;

  var state;
  try {
    state = JSON.parse(raw);
  } catch (err) {
    props.deleteProperty(State_key_(telegramUserId));
    return null;
  }

  if (!state.expiresAt || new Date().getTime() > state.expiresAt) {
    props.deleteProperty(State_key_(telegramUserId));
    return null;
  }
  return state;
}

/** Open or advance a flow. Resets the expiry on every step. */
function State_set(telegramUserId, flow, step, data) {
  var state = {
    flow: flow,
    step: step,
    data: data || {},
    expiresAt: new Date().getTime() + CONFIG.STATE_TTL_MINUTES * 60 * 1000
  };
  PropertiesService.getScriptProperties()
    .setProperty(State_key_(telegramUserId), JSON.stringify(state));
  return state;
}

/** End a flow. Safe to call when none is open. */
function State_clear(telegramUserId) {
  PropertiesService.getScriptProperties().deleteProperty(State_key_(telegramUserId));
}

/**
 * Remove every expired flow.
 *
 * Read-on-access already cleans up anyone who comes back, but a person who
 * never returns leaves a property behind for good. Script Properties have a
 * size limit, so this runs on a low-frequency trigger. See Setup.js.
 */
function State_sweep() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var now = new Date().getTime();
  var removed = 0;

  Object.keys(all).forEach(function (key) {
    if (key.indexOf('state:') !== 0) return;
    var ok = false;
    try {
      var parsed = JSON.parse(all[key]);
      ok = parsed.expiresAt && now <= parsed.expiresAt;
    } catch (err) {
      ok = false;
    }
    if (!ok) { props.deleteProperty(key); removed++; }
  });
  return removed;
}
