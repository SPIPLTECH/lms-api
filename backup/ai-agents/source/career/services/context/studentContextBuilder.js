const prisma = require("../../../../config/database");
const studentState = require("../../../student-state");
const assessment = require("../../../assessment");
const analytics = require("../../../analytics");

const industryRoleRepository = require("../../repositories/industryRole.repository");
const careerGoalRepository = require("../../repositories/careerGoal.repository");
const careerProfileRepository = require("../../repositories/careerProfile.repository");

/** Student State's getFullState throws 404 when no state exists yet — a normal, not exceptional, case for a cross-agent reader. */
const tryGetLearningState = async (studentId) => {
  try {
    return await studentState.getFullState(studentId);
  } catch (error) {
    return null;
  }
};

/** Analytics' getByStudent doesn't throw on empty data, but this stays defensive against migration/DB-availability gaps like every other cross-agent read in this codebase. */
const tryGetAnalyticsSnapshot = async (studentId) => {
  try {
    return await analytics.getByStudent(studentId);
  } catch (error) {
    return null;
  }
};

const fetchCertificates = (studentId) => prisma.certificate.findMany({ where: { studentId } });

/**
 * Assembles one StudentContext by pulling from Assessment (the technical-
 * skill signal, via ConceptMastery), Student State (performance/engagement
 * composite), Analytics (activity trend), real Certificate rows, this
 * agent's own active CareerGoal, this agent's own seeded IndustryRole
 * taxonomy, and the previously-computed CareerProfile (for confidence
 * gating in the generators). Never writes to any of those — a pure
 * aggregation read, same discipline as every other agent's context builder.
 *
 * @param {string} studentId
 * @returns {Promise<import("../../types/career.types").StudentContext>}
 */
const buildContext = async (studentId) => {
  const now = new Date();

  const [assessmentState, learningState, analyticsSnapshot, certificates, activeGoal, allRoles, previousProfile] = await Promise.all([
    assessment.getFullState(studentId),
    tryGetLearningState(studentId),
    tryGetAnalyticsSnapshot(studentId),
    fetchCertificates(studentId),
    careerGoalRepository.findActiveByStudent(studentId),
    industryRoleRepository.findAllActive(),
    careerProfileRepository.findByStudent(studentId),
  ]);

  return {
    studentId,
    now,
    assessmentState,
    learningState,
    analyticsSnapshot,
    certificates,
    activeGoal,
    allRoles,
    previousProfile,
  };
};

module.exports = { buildContext };
