const prisma = require("../../../../config/database");
const career = require("../../../career");
const studentState = require("../../../student-state");
const assessment = require("../../../assessment");
const recommendation = require("../../../recommendation");

const jobOpportunityRepository = require("../../repositories/jobOpportunity.repository");
const internshipOpportunityRepository = require("../../repositories/internshipOpportunity.repository");
const interviewRepository = require("../../repositories/interview.repository");

const { PROFILE_COMPLETENESS_FIELDS } = require("../../constants");

/** Cross-agent reads that shouldn't hard-fail this agent just because a peer has no data yet for this student. */
const tryRead = async (fn) => {
  try {
    return await fn();
  } catch (error) {
    return null;
  }
};

const fetchCertificates = (studentId) => prisma.certificate.findMany({ where: { studentId } });

const fetchStudentProfile = (studentId) =>
  prisma.studentProfile.findUnique({ where: { id: studentId }, select: Object.fromEntries(PROFILE_COMPLETENESS_FIELDS.map((f) => [f, true])) });

/**
 * Assembles one StudentContext by pulling from Career Guidance (skill
 * vector + readiness), Student State (performance/engagement), Assessment
 * (mastery), Recommendation (active nudges), real Certificate rows, real
 * StudentProfile completeness fields, this agent's own open job/internship
 * catalog, and this agent's own interview history. Never writes to any of
 * those — a pure aggregation read, same discipline as every other agent's
 * context builder.
 *
 * @param {string} studentId
 * @returns {Promise<import("../../types/placement.types").StudentContext>}
 */
const buildContext = async (studentId) => {
  const now = new Date();

  const [careerState, learningState, assessmentState, activeRecommendations, certificates, studentProfile, jobCatalog, internshipCatalog, interviewHistory] =
    await Promise.all([
      tryRead(() => career.getFullState(studentId)),
      tryRead(() => studentState.getFullState(studentId)),
      assessment.getFullState(studentId),
      recommendation.getByStudent(studentId).catch(() => ({ recommendations: [] })),
      fetchCertificates(studentId),
      fetchStudentProfile(studentId),
      jobOpportunityRepository.findAllOpen(),
      internshipOpportunityRepository.findAllOpen(),
      interviewRepository.findByStudent(studentId),
    ]);

  return {
    studentId,
    now,
    careerState,
    learningState,
    assessmentState,
    activeRecommendations: activeRecommendations?.recommendations || [],
    certificates,
    studentProfile,
    jobCatalog,
    internshipCatalog,
    interviewHistory,
  };
};

module.exports = { buildContext };
