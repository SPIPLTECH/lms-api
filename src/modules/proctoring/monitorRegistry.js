const prisma = require("../../config/database");
const { DEFAULT_POLICY } = require("./rules");

/**
 * One in-memory monitor per active attempt, loaded once. This is what lets a monitoring
 * token be checked with no database read. It lives in one API process, so several API
 * instances would need sticky routing. State changes that matter (submit, termination) are
 * still guarded in the database, so a mistake here cannot close an attempt twice.
 *
 * It depends on nothing but the database, so attempt.service can tell it about changes.
 */

const OPEN = new Set(["PREPARING", "IN_PROGRESS"]);

const SELECT = {
  id: true,
  status: true,
  tokenVersion: true,
  userId: true,
  quizId: true,
  courseId: true,
  startedAt: true,
  deadlineAt: true,
  identityMatching: true,
  identityRecheckPending: true,
  identityCheck: true,
  identityFailures: true,
  microphoneStatus: true,
  cameraSeenAt: true,
  warningCount: true,
  isFlagged: true,
  flags: true,
  framesReceived: true,
  framesAnalysed: true,
  framesSkipped: true,
  lastHeartbeatAt: true,
  lastSnapshotAt: true,
  longestGapSeconds: true,
  policy: true,
};

const monitors = new Map();
const loading = new Map();
const endedListeners = [];

const newMonitor = (row) => ({
  ...row,
  policy: { ...DEFAULT_POLICY, ...(row.policy || {}) },
  flags: Array.isArray(row.flags) ? row.flags : [],
  // Recent frames, newest first. Clean ones stay on disk only about a minute.
  frames: [],
  // Events inside the correlation window.
  events: [],
  seenFrames: new Set(),
  seenSeq: new Set(),
  emittedRuns: new Map(),
  notices: [],
  lastSameActionAt: {},
  lastWarningAt: null,
  lastAlert: null,
  lastKeptPeriodicAt: null,
  violationUntil: null,
  minClockOffsetMs: null,
  lateRun: 0,
  unanalysedRun: 0,
  gapOpen: false,
  // After a restart the gap clock starts over, rather than blaming the student for the restart.
  gapGraceUntil: row.status === "IN_PROGRESS" ? new Date() : null,
  baseline: undefined,
  holdEvidence: row.isFlagged,
  countersDirty: false,
  flagsDirty: false,
  ending: false,
  pendingTermination: null,
  ended: !OPEN.has(row.status),
});

const peek = (attemptId) => monitors.get(attemptId) ?? null;

/** The monitor for an attempt, reading the database only the first time. Null when there is no such attempt. */
async function load(attemptId) {
  const existing = monitors.get(attemptId);
  if (existing) return existing;
  if (loading.has(attemptId)) return loading.get(attemptId);
  const pending = prisma.proctoredAttempt
    .findUnique({ where: { id: attemptId }, select: SELECT })
    .then((row) => {
      if (!row) return null;
      const monitor = newMonitor(row);
      monitors.set(attemptId, monitor);
      return monitor;
    })
    .finally(() => loading.delete(attemptId));
  loading.set(attemptId, pending);
  return pending;
}

/** Loads every running attempt in one read, after a restart. */
async function loadAllInProgress() {
  const rows = await prisma.proctoredAttempt.findMany({ where: { status: "IN_PROGRESS" }, select: SELECT });
  for (const row of rows) if (!monitors.has(row.id)) monitors.set(row.id, newMonitor(row));
  return rows.length;
}

/** Applies a change made by attempt.service to a monitor already in memory. */
function patch(attemptId, fields) {
  const monitor = monitors.get(attemptId);
  if (monitor) Object.assign(monitor, fields);
}

const onEnded = (listener) => endedListeners.push(listener);

/** The attempt closed. Listeners flush what is left and clear its frames. */
async function notifyEnded(attemptId, status) {
  const monitor = monitors.get(attemptId);
  if (!monitor) return;
  monitor.status = status;
  monitor.ended = true;
  for (const listener of endedListeners) await listener(monitor);
}

const all = () => [...monitors.values()];

const remove = (attemptId) => monitors.delete(attemptId);

const clear = () => monitors.clear();

module.exports = { all, clear, load, loadAllInProgress, notifyEnded, onEnded, patch, peek, remove };
