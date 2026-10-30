/**
 * The items a student was last seen allowed to open in a course, so the
 * learning-sequence gate (progress.service assertContentsAccessible) does not
 * rebuild the whole course roll-up — 1–4 s against the live database — for an
 * item that was already open a moment ago. Starting a video, opening content
 * and marking it complete all go through that gate.
 *
 * Filled from every sequence this process computes (the learn page loads one
 * as it opens, so the first video start right after it is already covered).
 * Only "open" is remembered: an item that was locked always gets the full
 * check, so the moment it unlocks it is seen. The cost is that an item locked
 * again by an instructor's change (unpublished, a new item inserted before
 * it) can still be opened for up to `ttlMs`. Per process; another instance
 * just does the full check.
 */

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;

function createOpenStepsCache({ ttlMs = DEFAULT_TTL_MS, max = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
  // `${studentId}:${courseId}` -> { at, ids: Set<contentId> }, oldest first.
  const entries = new Map();
  const keyOf = (studentId, courseId) => `${studentId}:${courseId}`;

  return {
    /** Records every content id of the sequence's unlocked steps. */
    remember(studentId, courseId, sequence) {
      if (!studentId || !courseId || !Array.isArray(sequence?.steps)) return;
      const ids = new Set();
      for (const step of sequence.steps) {
        if (step.locked) continue;
        for (const id of step.contentIds || []) ids.add(id);
      }
      const key = keyOf(studentId, courseId);
      entries.delete(key);
      while (entries.size >= max) entries.delete(entries.keys().next().value);
      entries.set(key, { at: now(), ids });
    },

    /** True only when every one of `contentIds` was open in a fresh entry. */
    allOpen(studentId, courseId, contentIds) {
      if (!studentId || !courseId || !contentIds?.length) return false;
      const key = keyOf(studentId, courseId);
      const entry = entries.get(key);
      if (!entry) return false;
      if (now() - entry.at > ttlMs) {
        entries.delete(key);
        return false;
      }
      return contentIds.every((id) => entry.ids.has(id));
    },

    /** Drops what is remembered for one student's course, or for everyone. */
    forget(studentId, courseId) {
      if (studentId && courseId) entries.delete(keyOf(studentId, courseId));
      else entries.clear();
    },

    get size() {
      return entries.size;
    }
  };
}

module.exports = { createOpenStepsCache };
