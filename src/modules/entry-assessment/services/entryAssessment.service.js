const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const studentCourseStateService = require("./studentCourseState.service");

const entryAssessmentRepository = require("../repositories/entryAssessment.repository");
const { buildSyllabus } = require("./domain/entrySyllabusBuilder");
const { summarizeProfile } = require("./domain/profileSummarizer");
const { evaluateAnswers } = require("./domain/entryAssessmentEvaluator");
const llm = require("../llm");

const { toEntryAssessmentForStudent, toEntryAssessmentResultResponse } = require("../dto/entryAssessmentResponse.dto");

const assignQuestionIds = (questions) => questions.map((q, i) => ({ id: `q${i + 1}`, ...q }));

const requireEnrollment = async (studentId, courseId) => {
  const enrollment = await prisma.enrollment.findUnique({ where: { studentId_courseId: { studentId, courseId } } });
  if (!enrollment) throw new ApiError(403, "You must be enrolled in this course to take its entry assessment");
};

/**
 * Generate -> Evaluate -> Initialize Course State pipeline. Idempotent: a
 * READY/SUBMITTED/EVALUATED assessment is returned as-is rather than
 * regenerated (LLM calls cost real money and every student only gets one
 * entry assessment per course). Only a missing row or a prior FAILED
 * attempt triggers real generation.
 *
 * @param {string} studentId
 * @param {string} courseId
 */
const generateForStudent = async (studentId, courseId) => {
  await requireEnrollment(studentId, courseId);

  const existing = await entryAssessmentRepository.findByStudentAndCourse(studentId, courseId);
  if (existing && existing.status !== "FAILED") {
    return toEntryAssessmentForStudent(existing);
  }

  const syllabus = await buildSyllabus(courseId);
  if (!syllabus) {
    throw new ApiError(422, "This course does not have enough published content yet to build an entry assessment");
  }

  const profile = await prisma.studentProfile.findUnique({ where: { id: studentId } });
  const profileSummary = summarizeProfile(profile || {});

  await entryAssessmentRepository.upsert(studentId, courseId, { status: "GENERATING" });

  const { questions, model, failureReason } = await llm.generateQuestions({
    course: syllabus.course,
    concepts: syllabus.concepts,
    profileSummary,
  });

  if (questions.length === 0) {
    const failed = await entryAssessmentRepository.upsert(studentId, courseId, { status: "FAILED", failureReason, model: null });
    return toEntryAssessmentForStudent(failed);
  }

  const ready = await entryAssessmentRepository.upsert(studentId, courseId, {
    status: "READY",
    model,
    questions: assignQuestionIds(questions),
    syllabusSnapshot: syllabus.concepts.map((c) => ({ moduleId: c.moduleId, title: c.title })),
    failureReason: null,
    generatedAt: new Date(),
  });

  return toEntryAssessmentForStudent(ready);
};

const requireAssessment = async (studentId, courseId) => {
  const row = await entryAssessmentRepository.findByStudentAndCourse(studentId, courseId);
  if (!row) throw new ApiError(404, "No entry assessment found for this course — call POST /assessment/entry/:courseId/generate first");
  return row;
};

const getEntryAssessment = async (studentId, courseId) => toEntryAssessmentForStudent(await requireAssessment(studentId, courseId));

/**
 * Scores the student's answers, persists the evaluation, and initializes
 * this student's per-course baseline (knowledge level, personalized lesson
 * minutes). The initializeCourseState call is awaited so the dashboard has
 * fresh data the moment this request returns, but its failure doesn't
 * invalidate an already-successful evaluation — it's logged and surfaced
 * via `stateInitialized`.
 *
 * @param {string} studentId
 * @param {string} courseId
 * @param {Object<string, number>} answers - { [questionId]: selectedOptionIndex }
 */
const submitEntryAssessment = async (studentId, courseId, answers) => {
  const row = await requireAssessment(studentId, courseId);

  if (row.status === "EVALUATED") throw new ApiError(409, "This entry assessment has already been submitted");
  if (row.status !== "READY") throw new ApiError(400, `Entry assessment is not ready to be submitted (status: ${row.status})`);

  const evaluation = evaluateAnswers(row.questions, answers || {});
  const now = new Date();

  const evaluated = await entryAssessmentRepository.upsert(studentId, courseId, {
    status: "EVALUATED",
    answers: answers || {},
    ...evaluation,
    submittedAt: now,
    evaluatedAt: now,
  });

  let stateInitialized = false;
  try {
    await studentCourseStateService.initializeCourseState(studentId, courseId, evaluation);
    stateInitialized = true;
  } catch (error) {
    console.error(`[entry-assessment] failed to initialize course state for student ${studentId}, course ${courseId}:`, error);
  }

  return { ...toEntryAssessmentResultResponse(evaluated), stateInitialized };
};

const getResult = async (studentId, courseId) => {
  const row = await requireAssessment(studentId, courseId);
  if (row.status !== "EVALUATED") throw new ApiError(409, "This entry assessment has not been submitted yet");
  return toEntryAssessmentResultResponse(row);
};

module.exports = { generateForStudent, getEntryAssessment, submitEntryAssessment, getResult };
