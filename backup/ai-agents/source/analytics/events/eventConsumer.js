const studentState = require("../../student-state");
const assessment = require("../../assessment");
const recommendation = require("../../recommendation");
const motivation = require("../../motivation");
const teacherInsights = require("../../teacher-insights");
const observation = require("../../observation");

const analyticsService = require("../services/analytics.service");
const { SCOPE_TYPE, STUDENT_RECOMPUTE_DEBOUNCE_MS, COURSE_RECOMPUTE_DEBOUNCE_MS } = require("../constants");

const STUDENT_TRIGGER_EVENT_TYPES = new Set(["COURSE_ENROLLED", "COURSE_COMPLETED"]);

/**
 * Two debounce tiers, not one: STUDENT-scope recompute is cheap (a single
 * student's peer-agent reads) and stays close to real time. COURSE/
 * INSTRUCTOR-scope recompute is a heavier full-population aggregation, so
 * it only fires off TeacherInsightUpdated (a coarser, already-debounced
 * signal) with a longer window — see constants/thresholds.constants.js.
 */
const pendingTimers = new Map();

const scheduleRecompute = (scopeType, scopeId, reason, debounceMs) => {
  if (!scopeId) return;
  const key = `${scopeType}:${scopeId}`;

  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    analyticsService.generateForScope(scopeType, scopeId, reason).catch((error) => {
      console.error(`[analytics] failed to generate for ${key} (trigger: ${reason}):`, error);
    });
  }, debounceMs);

  timer.unref?.();
  pendingTimers.set(key, timer);
};

const scheduleStudentRecompute = (studentId, reason) => scheduleRecompute(SCOPE_TYPE.STUDENT, studentId, reason, STUDENT_RECOMPUTE_DEBOUNCE_MS);

const handleStudentStateUpdate = (payload) => scheduleStudentRecompute(payload?.studentId, "student-state:updated");
const handleAssessmentUpdate = (payload) => scheduleStudentRecompute(payload?.studentId, "assessment:updated");
const handleRecommendationUpdate = (payload) => scheduleStudentRecompute(payload?.studentId, "recommendation:updated");
const handleMotivationUpdate = (payload) => scheduleStudentRecompute(payload?.studentId, "motivation:updated");

/** Course-wide insight just changed -> both the course's and its owning instructor's rollups are stale. */
const handleTeacherInsightUpdate = (payload) => {
  scheduleRecompute(SCOPE_TYPE.COURSE, payload?.courseId, "teacher-insight:updated", COURSE_RECOMPUTE_DEBOUNCE_MS);
  scheduleRecompute(SCOPE_TYPE.INSTRUCTOR, payload?.teacherId, "teacher-insight:updated", COURSE_RECOMPUTE_DEBOUNCE_MS);
};

/** Covers "Observation Event Received" directly for the two events that immediately affect a student's own completion-rate metric — everything else rides the peer-agent update signals above. */
const handleObservationEvent = (event) => {
  if (!STUDENT_TRIGGER_EVENT_TYPES.has(event?.eventType)) return;
  scheduleStudentRecompute(event.studentId, `observation:${event.eventType}`);
};

/**
 * Learning Path Agent — not built yet in this codebase. Wired defensively
 * so the moment it exists, this subscribes with zero changes here.
 */
const tryStartLearningPathConsumer = () => {
  let learningPath;
  try {
    learningPath = require("../../learning-path");
  } catch (error) {
    console.warn("[analytics] learning-path module not found — skipping that subscription for now");
    return () => {};
  }

  if (!learningPath || typeof learningPath.subscribe !== "function") {
    console.warn("[analytics] learning-path module exists but has no subscribe() — skipping");
    return () => {};
  }

  return learningPath.subscribe(learningPath.LEARNING_PATH_EVENT_NAMES?.PATH_UPDATED || "learning-path:updated", (payload) => {
    scheduleStudentRecompute(payload?.studentId, "learning-path:updated");
  });
};

const start = () => {
  const unsubscribeStudentState = studentState.subscribe(studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, handleStudentStateUpdate);
  console.log("[analytics] subscribed to student-state:updated");

  const unsubscribeAssessment = assessment.subscribe(assessment.ASSESSMENT_EVENT_NAMES.ASSESSMENT_UPDATED, handleAssessmentUpdate);
  console.log("[analytics] subscribed to assessment:updated");

  const unsubscribeRecommendation = recommendation.subscribe(
    recommendation.RECOMMENDATION_EVENT_NAMES.RECOMMENDATION_UPDATED,
    handleRecommendationUpdate
  );
  console.log("[analytics] subscribed to recommendation:updated");

  const unsubscribeMotivation = motivation.subscribe(motivation.MOTIVATION_EVENT_NAMES.MOTIVATION_UPDATED, handleMotivationUpdate);
  console.log("[analytics] subscribed to motivation:updated");

  const unsubscribeTeacherInsight = teacherInsights.subscribe(
    teacherInsights.TEACHER_INSIGHT_EVENT_NAMES.TEACHER_INSIGHT_UPDATED,
    handleTeacherInsightUpdate
  );
  console.log("[analytics] subscribed to teacher-insight:updated");

  const unsubscribeObservation = observation.subscribe(observation.OBSERVATION_EVENT_NAMES.EVENT_CREATED, handleObservationEvent);
  console.log("[analytics] subscribed to observation:event.created (COURSE_ENROLLED, COURSE_COMPLETED)");

  const unsubscribeLearningPath = tryStartLearningPathConsumer();

  return () => {
    unsubscribeStudentState();
    unsubscribeAssessment();
    unsubscribeRecommendation();
    unsubscribeMotivation();
    unsubscribeTeacherInsight();
    unsubscribeObservation();
    unsubscribeLearningPath();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };
};

module.exports = {
  start,
  handleStudentStateUpdate,
  handleAssessmentUpdate,
  handleRecommendationUpdate,
  handleMotivationUpdate,
  handleTeacherInsightUpdate,
  handleObservationEvent,
};
