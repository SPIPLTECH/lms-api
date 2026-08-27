const studentState = require("../../student-state");
const assessment = require("../../assessment");

const careerService = require("../services/career.service");
const { STUDENT_RECOMPUTE_DEBOUNCE_MS } = require("../constants");

/**
 * Per-student debounce — same 5s window as Recommendation/Motivation/
 * Analytics' student-scope recompute. "Course completed"/"certificate
 * earned"/"project completed" have no real-time hook anywhere in this
 * codebase (nothing publishes those signals today — the same gap
 * Recommendation Agent's own module docs already note); those are covered
 * by the daily safety-net sweep instead (schedulers/dailySafetySweep.scheduler.js).
 */
const pendingTimers = new Map();

const scheduleRecompute = (studentId, reason) => {
  if (!studentId) return;

  const existing = pendingTimers.get(studentId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(studentId);
    careerService.generateForStudent(studentId, reason).catch((error) => {
      console.error(`[career] failed to generate for student ${studentId} (trigger: ${reason}):`, error);
    });
  }, STUDENT_RECOMPUTE_DEBOUNCE_MS);

  timer.unref?.();
  pendingTimers.set(studentId, timer);
};

const handleStudentStateUpdate = (payload) => scheduleRecompute(payload?.studentId, "student-state:updated");
const handleAssessmentUpdate = (payload) => scheduleRecompute(payload?.studentId, "assessment:updated");

/**
 * Learning Path Agent — not built yet in this codebase. Wired defensively
 * so the moment it exists, this subscribes with zero changes here.
 */
const tryStartLearningPathConsumer = () => {
  let learningPath;
  try {
    learningPath = require("../../learning-path");
  } catch (error) {
    console.warn("[career] learning-path module not found — skipping that subscription for now");
    return () => {};
  }

  if (!learningPath || typeof learningPath.subscribe !== "function") {
    console.warn("[career] learning-path module exists but has no subscribe() — skipping");
    return () => {};
  }

  return learningPath.subscribe(learningPath.LEARNING_PATH_EVENT_NAMES?.PATH_UPDATED || "learning-path:updated", (payload) => {
    scheduleRecompute(payload?.studentId, "learning-path:updated");
  });
};

const start = () => {
  const unsubscribeStudentState = studentState.subscribe(studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, handleStudentStateUpdate);
  console.log("[career] subscribed to student-state:updated");

  const unsubscribeAssessment = assessment.subscribe(assessment.ASSESSMENT_EVENT_NAMES.ASSESSMENT_UPDATED, handleAssessmentUpdate);
  console.log("[career] subscribed to assessment:updated");

  const unsubscribeLearningPath = tryStartLearningPathConsumer();

  return () => {
    unsubscribeStudentState();
    unsubscribeAssessment();
    unsubscribeLearningPath();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };
};

module.exports = { start, handleStudentStateUpdate, handleAssessmentUpdate };
