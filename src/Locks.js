/**
 * Locking around read-modify-write.
 *
 * Any sequence that reads the sheet, decides something, then writes, needs a
 * lock. Two concurrent webhook executions will otherwise both read "no reply
 * yet" and both append a row, or both compute the same next person_id.
 *
 * Apps Script locks are NOT reentrant. A function that takes the script lock
 * cannot be called from inside another function that already holds it; the
 * inner tryLock simply fails and you get an intermittent, load-dependent bug.
 * That is easy to do by accident, because the helper that takes the lock is
 * usually the convenient one to call.
 *
 * So the guard below tracks, per execution, whether this code already holds the
 * lock, and throws a named error instead of silently failing. If you see
 * "reentrant lock" in the logs, the fix is to split the inner function into a
 * lock-free core (suffix _nolock) and call that instead.
 */

var LOCKS_HELD_ = {};

/**
 * Run fn while holding a named lock.
 *
 * @param {string} name       Logical name, used for the reentrancy guard only.
 * @param {function} fn       Work to do.
 * @param {number=} waitMs    How long to wait for the lock. Default 30s.
 */
function Locks_with(name, fn, waitMs) {
  if (LOCKS_HELD_[name]) {
    throw new Error('reentrant lock: "' + name + '" is already held by this execution. ' +
                    'Call the _nolock variant from inside the critical section.');
  }

  // getDocumentLock scopes to the bound document, getScriptLock to the whole
  // project. This project uses the script lock throughout, because the sheet
  // is opened by id rather than bound, and a document lock would not cover the
  // Script Properties writes that sit in the same critical sections.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || 30000)) {
    throw new Error('could not acquire lock "' + name + '" within the wait window');
  }

  LOCKS_HELD_[name] = true;
  try {
    return fn();
  } finally {
    LOCKS_HELD_[name] = false;
    lock.releaseLock();
  }
}

/** True if this execution currently holds the named lock. */
function Locks_held(name) {
  return !!LOCKS_HELD_[name];
}

/**
 * Flush pending writes before telling anyone the write succeeded.
 *
 * Apps Script batches sheet writes and may still be holding them when your
 * function returns. Without this, a "saved" reply can be reported to the user
 * and then lost if the execution is killed, which is the worst possible
 * failure in an attendance system: the person believes they have answered.
 */
function Locks_flush() {
  SpreadsheetApp.flush();
}
