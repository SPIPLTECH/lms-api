/**
 * Short-lived, per-process cache of a student's computed learning sequence
 * (progress.service computeStudentSequence), keyed by student and course.
 *
 * Opening one step asks for the same sequence several times within a second:
 * GET /progress/learning-sequence builds it, then the item's own access
 * checks (GET /quizzes/:id, POST /playback/start, GET /contents/:id) each
 * rebuild it to confirm the step is open. Each build is the whole course
 * roll-up — seconds on a large course over the remote database — and they
 * queue behind each other on the roll-up's per-student lock.
 *
 * Correctness:
 * - Every persisted roll-up (completion, visit, quiz or assignment
 *   submission, …) calls invalidate() first, so the student's own actions are
 *   never served from a stale entry.
 * - A build records the generation it started under; set() refuses it if an
 *   invalidation happened since, so a slow build can't put back a sequence a
 *   write has already superseded.
 * - Changes made by someone else (an instructor reordering or publishing,
 *   grading an assignment) don't invalidate; TTL_MS bounds how long a gate
 *   can lag them.
 * - Per process: with more than one API instance, each keeps its own cache
 *   and a write only clears the instance that handled it (TTL still bounds
 *   it).
 */

const TTL_MS = 20 * 1000;

const entries = new Map(); // key -> { value: Promise, timer }
const generations = new Map(); // key -> number of invalidations so far

const keyOf = (studentId, courseId) => `${studentId}:${courseId}`;

function generation(studentId, courseId) {
  return generations.get(keyOf(studentId, courseId)) || 0;
}

function drop(key) {
  const entry = entries.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  entries.delete(key);
}

/** The cached sequence promise, or null. */
function get(studentId, courseId) {
  return entries.get(keyOf(studentId, courseId))?.value || null;
}

/**
 * Caches `promise` unless the key was invalidated after `startedAt`
 * (a generation() read taken before the build began). A rejected build is
 * removed rather than served.
 */
function set(studentId, courseId, promise, startedAt) {
  const key = keyOf(studentId, courseId);
  if ((generations.get(key) || 0) !== startedAt) return;
  drop(key);
  // Evicted on a timer, not on next read: an entry holds every lesson body
  // and must not outlive its TTL just because nobody asked again.
  const timer = setTimeout(() => {
    if (entries.get(key)?.value === promise) entries.delete(key);
  }, TTL_MS);
  timer.unref?.();
  entries.set(key, { value: promise, timer });
  promise.catch(() => {
    if (entries.get(key)?.value === promise) drop(key);
  });
}

function invalidate(studentId, courseId) {
  const key = keyOf(studentId, courseId);
  generations.set(key, (generations.get(key) || 0) + 1);
  drop(key);
}

module.exports = { TTL_MS, generation, get, set, invalidate };
