const prisma = require("../../../config/database");

const observation = require("../../observation");
const studentState = require("../../student-state");
const assessment = require("../../assessment");
const recommendation = require("../../recommendation");
const motivation = require("../../motivation");

const teacherInsightService = require("../services/teacherInsight.service");
const { TRIGGER_EVENT_TYPES, RECOMPUTE_DEBOUNCE_MS } = require("../constants");

const TRIGGER_EVENT_TYPE_SET = new Set(TRIGGER_EVENT_TYPES);

// Per-course debounce: 30+ students each triggering student-state:updated
// within a few seconds should collapse into one class-wide recompute, not
// one per student — a longer window than the per-student agents use, since
// a course recompute is a heavier operation (batch reads across the whole
// enrolled class).
const pendingTimers = new Map();

const scheduleRecompute = (courseId, reason) => {
  if (!courseId) return;

  const existing = pendingTimers.get(courseId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(courseId);
    teacherInsightService.generateForCourse(courseId, reason).catch((error) => {
      console.error(`[teacher-insights] failed to generate for course ${courseId} (trigger: ${reason}):`, error);
    });
  }, RECOMPUTE_DEBOUNCE_MS);

  timer.unref?.();
  pendingTimers.set(courseId, timer);
};

/** Every peer signal here carries only { studentId } — resolves to that student's enrolled courses before scheduling. */
const scheduleRecomputeForStudent = async (studentId, reason) => {
  if (!studentId) return;
  const enrollments = await prisma.enrollment.findMany({ where: { studentId }, select: { courseId: true } });
  for (const { courseId } of enrollments) scheduleRecompute(courseId, reason);
};

const handleStudentStateUpdate = (payload) => {
  scheduleRecomputeForStudent(payload?.studentId, "student-state:updated").catch((error) => {
    console.error("[teacher-insights] failed to resolve courses for student-state:updated:", error);
  });
};

const handleAssessmentUpdate = (payload) => {
  scheduleRecomputeForStudent(payload?.studentId, "assessment:updated").catch((error) => {
    console.error("[teacher-insights] failed to resolve courses for assessment:updated:", error);
  });
};

const handleRecommendationUpdate = (payload) => {
  scheduleRecomputeForStudent(payload?.studentId, "recommendation:updated").catch((error) => {
    console.error("[teacher-insights] failed to resolve courses for recommendation:updated:", error);
  });
};

const handleMotivationUpdate = (payload) => {
  scheduleRecomputeForStudent(payload?.studentId, "motivation:updated").catch((error) => {
    console.error("[teacher-insights] failed to resolve courses for motivation:updated:", error);
  });
};

/** Covers the "Quiz Completed"/"Assignment Submitted" business triggers directly — Observation events already carry courseId, no lookup needed. */
const handleObservationEvent = (event) => {
  if (!TRIGGER_EVENT_TYPE_SET.has(event?.eventType)) return;
  scheduleRecompute(event.courseId, `observation:${event.eventType}`);
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
    console.warn("[teacher-insights] learning-path module not found — skipping that subscription for now");
    return () => {};
  }

  if (!learningPath || typeof learningPath.subscribe !== "function") {
    console.warn("[teacher-insights] learning-path module exists but has no subscribe() — skipping");
    return () => {};
  }

  return learningPath.subscribe(learningPath.LEARNING_PATH_EVENT_NAMES?.PATH_UPDATED || "learning-path:updated", (payload) => {
    scheduleRecomputeForStudent(payload?.studentId, "learning-path:updated").catch((error) => {
      console.error("[teacher-insights] failed to resolve courses for learning-path:updated:", error);
    });
  });
};

const start = () => {
  const unsubscribeStudentState = studentState.subscribe(studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, handleStudentStateUpdate);
  console.log("[teacher-insights] subscribed to student-state:updated");

  const unsubscribeAssessment = assessment.subscribe(assessment.ASSESSMENT_EVENT_NAMES.ASSESSMENT_UPDATED, handleAssessmentUpdate);
  console.log("[teacher-insights] subscribed to assessment:updated");

  const unsubscribeRecommendation = recommendation.subscribe(
    recommendation.RECOMMENDATION_EVENT_NAMES.RECOMMENDATION_UPDATED,
    handleRecommendationUpdate
  );
  console.log("[teacher-insights] subscribed to recommendation:updated");

  const unsubscribeMotivation = motivation.subscribe(motivation.MOTIVATION_EVENT_NAMES.MOTIVATION_UPDATED, handleMotivationUpdate);
  console.log("[teacher-insights] subscribed to motivation:updated");

  const unsubscribeObservation = observation.subscribe(observation.OBSERVATION_EVENT_NAMES.EVENT_CREATED, handleObservationEvent);
  console.log("[teacher-insights] subscribed to observation:event.created (QUIZ_COMPLETED, ASSIGNMENT_SUBMITTED)");

  const unsubscribeLearningPath = tryStartLearningPathConsumer();

  return () => {
    unsubscribeStudentState();
    unsubscribeAssessment();
    unsubscribeRecommendation();
    unsubscribeMotivation();
    unsubscribeObservation();
    unsubscribeLearningPath();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };
};

module.exports = { start, handleStudentStateUpdate, handleAssessmentUpdate, handleRecommendationUpdate, handleMotivationUpdate, handleObservationEvent };
