const studentCourseStateRepository = require("../repositories/studentCourseState.repository");
const { buildCourseStatePersonalization } = require("./domain/courseStatePersonalizer");
const { studentStateBus } = require("../events/eventBus");
const { STUDENT_STATE_EVENT_NAMES } = require("../events/eventNames");
const { toCourseStateResponse } = require("../dto/studentCourseStateResponse.dto");

/**
 * The "Initialize Student State" step of the AI Student Entry Phase: turns
 * the Assessment Agent's evaluated concept scores into a per-course
 * baseline (knowledge level, per-concept learning mode/time, time saved).
 * Called directly by the Assessment Agent (services/entryAssessment.service.js)
 * right after evaluation — a synchronous cross-agent call, not just an
 * event, so the dashboard has fresh data the instant the request returns.
 *
 * Publishes the *same* STATE_UPDATED event the global reducer pipeline
 * uses, so the Learning Path Agent's existing debounced subscriber (see
 * learning-path/events/eventConsumer.js) recomputes automatically — no
 * new wiring needed on that side.
 *
 * @param {string} studentId
 * @param {string} courseId
 * @param {{overallScore: number, knowledgeLevel: string, confidenceScore: number, conceptScores: object[], strongConcepts: string[], weakConcepts: string[]}} evaluation
 */
const initializeCourseState = async (studentId, courseId, evaluation) => {
  const personalization = await buildCourseStatePersonalization(courseId, evaluation.conceptScores || []);

  const saved = await studentCourseStateRepository.upsert(studentId, courseId, {
    knowledgeLevel: evaluation.knowledgeLevel,
    entryAssessmentScore: evaluation.overallScore,
    confidenceScore: evaluation.confidenceScore,
    conceptMastery: personalization.conceptMastery,
    strongConcepts: evaluation.strongConcepts || [],
    weakConcepts: evaluation.weakConcepts || [],
    originalTotalMinutes: personalization.originalTotalMinutes,
    personalizedTotalMinutes: personalization.personalizedTotalMinutes,
    timeSavedMinutes: personalization.timeSavedMinutes,
  });

  studentStateBus.publish(STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, { studentId, courseId, source: "entry-assessment" });

  return toCourseStateResponse(saved);
};

/**
 * Trusted cross-agent read (the Learning Path Agent's per-course
 * personalization). Returns null rather than throwing when no baseline
 * exists yet — absence is normal until a student completes the entry
 * assessment for that course.
 */
const getCourseState = async (studentId, courseId) => {
  const row = await studentCourseStateRepository.findByStudentAndCourse(studentId, courseId);
  return row ? toCourseStateResponse(row) : null;
};

module.exports = { initializeCourseState, getCourseState };
