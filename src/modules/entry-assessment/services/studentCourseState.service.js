const studentCourseStateRepository = require("../repositories/studentCourseState.repository");
const { buildCourseStatePersonalization } = require("./domain/courseStatePersonalizer");
const { toCourseStateResponse } = require("../dto/studentCourseStateResponse.dto");

/**
 * The "Initialize Student State" step of the AI Student Entry Phase: turns
 * the entry assessment's evaluated concept scores into a per-course
 * baseline (knowledge level, per-concept learning mode/time, time saved).
 * Called directly by entryAssessment.service.js right after evaluation.
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

  return toCourseStateResponse(saved);
};

/**
 * Trusted read for the "AI Personalization" dashboard widget. Returns null
 * rather than throwing when no baseline exists yet — absence is normal
 * until a student completes the entry assessment for that course.
 */
const getCourseState = async (studentId, courseId) => {
  const row = await studentCourseStateRepository.findByStudentAndCourse(studentId, courseId);
  return row ? toCourseStateResponse(row) : null;
};

module.exports = { initializeCourseState, getCourseState };
