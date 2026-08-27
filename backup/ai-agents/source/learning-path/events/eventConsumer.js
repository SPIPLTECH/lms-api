const studentState = require("../../student-state");

const learningPathService = require("../services/learningPath.service");
const { STUDENT_RECOMPUTE_DEBOUNCE_MS } = require("../constants");

/**
 * The spec's business-logic diagram names exactly one real-time trigger:
 * "Whenever the Student State changes." Per-student debounce, same 5s
 * window as every other student-scoped agent in this series.
 */
const pendingTimers = new Map();

const scheduleRecompute = (studentId, reason) => {
  if (!studentId) return;

  const existing = pendingTimers.get(studentId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(studentId);
    learningPathService.generateForStudent(studentId, reason).catch((error) => {
      console.error(`[learning-path] failed to generate for student ${studentId} (trigger: ${reason}):`, error);
    });
  }, STUDENT_RECOMPUTE_DEBOUNCE_MS);

  timer.unref?.();
  pendingTimers.set(studentId, timer);
};

const handleStudentStateUpdate = (payload) => scheduleRecompute(payload?.studentId, "student-state:updated");

const start = () => {
  const unsubscribeStudentState = studentState.subscribe(studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, handleStudentStateUpdate);
  console.log("[learning-path] subscribed to student-state:updated");

  return () => {
    unsubscribeStudentState();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };
};

module.exports = { start, handleStudentStateUpdate };
