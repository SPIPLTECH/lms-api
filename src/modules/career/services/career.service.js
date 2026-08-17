const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

const industryRoleRepository = require("../repositories/industryRole.repository");
const careerGoalRepository = require("../repositories/careerGoal.repository");
const careerProfileRepository = require("../repositories/careerProfile.repository");
const skillAssessmentRepository = require("../repositories/skillAssessment.repository");
const skillGapRepository = require("../repositories/skillGap.repository");
const careerRecommendationRepository = require("../repositories/careerRecommendation.repository");
const historyRepository = require("../repositories/careerRecommendationHistory.repository");
const careerRoadmapRepository = require("../repositories/careerRoadmap.repository");
const readinessHistoryRepository = require("../repositories/careerReadinessHistory.repository");

const { buildContext } = require("./context/studentContextBuilder");
const { matchRoles, matchScoreForRole } = require("../ai/skillMatchEngine");
const { analyzeGaps } = require("../ai/skillGapAnalyzer");
const { calculateReadiness } = require("../ai/readinessScorer");
const { generateRoadmaps } = require("../ai/roadmapGenerator");
const { generateAllCandidates } = require("../ai/generators");
const { rankAndScore } = require("../ai/rankingEngine");
const { average } = require("../utils/scoreMath.util");

const { careerBus } = require("../events/eventBus");
const { CAREER_EVENT_NAMES } = require("../events/eventNames");

const {
  toProfileResponse,
  toReadinessResponse,
  toRolesResponse,
  toRoadmapResponse,
  toSkillGapsResponse,
  toRecommendationListResponse,
  toInterviewPlanResponse,
  toGoalResponse,
  toRecalculateResponse,
} = require("../dto/careerResponse.dto");

const {
  TOP_MATCHED_ROLES_COUNT,
  TOP_MISSING_SKILLS_COUNT,
  RETIRED_REASON,
  CAREER_RECOMMENDATION_STATUS,
  ROADMAP_HORIZON,
  INTERVIEW_PREP_TYPES,
  INDUSTRY_READINESS_LEVEL,
} = require("../constants");

const buildSkillVector = (assessmentState) =>
  (assessmentState?.mastery?.concepts || []).map((c) => ({ skillName: c.concept, proficiency: c.masteryScore, status: c.status }));

const resolveStudentStateComposite = (learningState) => {
  const scores = learningState?.scores;
  if (!scores) return 0;
  return average([scores.performanceScore, scores.engagementScore, scores.consistencyScore].filter((v) => typeof v === "number"));
};

const resolveActivityScore = (analyticsSnapshot, learningState) => {
  const kpis = analyticsSnapshot?.kpis || [];
  const completionKpi = kpis.find((k) => k.metricKey === "COMPLETION_RATE");
  if (completionKpi) return completionKpi.value;
  return learningState?.progress?.courseCompletionPercent || 0;
};

const retiredReasonToStatus = {
  [RETIRED_REASON.SUPERSEDED]: CAREER_RECOMMENDATION_STATUS.EXPIRED,
  [RETIRED_REASON.COMPLETED]: CAREER_RECOMMENDATION_STATUS.COMPLETED,
  [RETIRED_REASON.DISMISSED]: CAREER_RECOMMENDATION_STATUS.DISMISSED,
};

/** Snapshots the row to history, then transitions its live status — always inside one transaction. */
const retireRecommendation = (recommendation, retiredReason) =>
  prisma.$transaction(async (tx) => {
    await historyRepository.createSnapshot(recommendation, retiredReason, tx);
    await careerRecommendationRepository.updateStatus(recommendation.id, retiredReasonToStatus[retiredReason], tx);
  });

/**
 * The core pipeline: Analyze Skills -> Match Career Roles -> Detect Skill
 * Gaps -> Calculate Readiness -> Generate Roadmap -> Generate
 * Recommendations -> Persist -> Publish. Called on every trigger (debounced
 * event, scheduler, goal update, or explicit POST /career/recalculate).
 *
 * @param {string} studentId
 * @param {string} [trigger] - for logging only.
 */
const generateForStudent = async (studentId, trigger = "manual") => {
  const context = await buildContext(studentId);

  const skillVector = buildSkillVector(context.assessmentState);
  await skillAssessmentRepository.upsertMany(studentId, skillVector, context.now);

  const topMatchedRoles = matchRoles(skillVector, context.allRoles, TOP_MATCHED_ROLES_COUNT);

  let primaryRole = context.activeGoal?.targetRole || null;
  if (!primaryRole) {
    const topRoleId = topMatchedRoles[0]?.roleId;
    primaryRole = topRoleId ? context.allRoles.find((role) => role.id === topRoleId) : null;
  }

  const skillMatchPercent = primaryRole ? matchScoreForRole(skillVector, primaryRole) : topMatchedRoles[0]?.matchPercent || 0;
  const skillGaps = primaryRole ? analyzeGaps(skillVector, primaryRole) : [];

  let closedGaps = 0;
  if (primaryRole) {
    const existingOpenKeys = await skillGapRepository.findAllOpenKeys(studentId, primaryRole.id);
    const currentGapNames = new Set(skillGaps.map((gap) => gap.skillName));

    for (const gap of skillGaps) {
      await skillGapRepository.upsertCandidate(studentId, primaryRole.id, gap);
    }

    const toClose = existingOpenKeys.filter((row) => !currentGapNames.has(row.skillName));
    for (const row of toClose) {
      await skillGapRepository.closeById(row.id, context.now);
      closedGaps += 1;
    }
  }

  const readinessResult = calculateReadiness({
    skillMatchPercent,
    assessmentMasteryAvg: average(skillVector.map((s) => s.proficiency)),
    studentStateComposite: resolveStudentStateComposite(context.learningState),
    credentialCount: context.certificates.length,
    activityScore: resolveActivityScore(context.analyticsSnapshot, context.learningState),
    skillSignalCount: skillVector.length,
  });

  const generatorContext = {
    ...context,
    skillGaps,
    credentials: context.certificates,
    previousReadinessScore: context.previousProfile?.readinessScore ?? 50,
    previousIndustryReadiness: context.previousProfile?.industryReadiness ?? INDUSTRY_READINESS_LEVEL.NOT_READY,
  };

  const candidates = generateAllCandidates(generatorContext).map((candidate) => ({ ...candidate, targetRoleId: primaryRole?.id || null }));
  const ranked = rankAndScore(candidates);

  const existingActive = await careerRecommendationRepository.findAllActiveDedupeKeys(studentId);
  const rankedDedupeKeys = new Set(ranked.map((c) => c.dedupeKey));

  const persisted = [];
  for (const candidate of ranked) {
    const row = await careerRecommendationRepository.upsertCandidate(studentId, candidate);
    persisted.push(row);
  }

  // Anything still ACTIVE but not regenerated this cycle no longer applies
  // (e.g. the underlying skill gap closed, or the target role changed).
  const toRetire = existingActive.filter((row) => !rankedDedupeKeys.has(row.dedupeKey));
  for (const row of toRetire) {
    const full = await careerRecommendationRepository.findById(row.id);
    if (full) await retireRecommendation(full, RETIRED_REASON.SUPERSEDED);
  }

  await careerProfileRepository.upsert(
    studentId,
    {
      readinessScore: readinessResult.readinessScore,
      confidenceLevel: readinessResult.confidenceLevel,
      industryReadiness: readinessResult.industryReadiness,
      skillMatchPercent,
      primaryTargetRoleId: primaryRole?.id || null,
      topMatchedRoles,
      missingSkillsSummary: skillGaps.slice(0, TOP_MISSING_SKILLS_COUNT).map((gap) => gap.skillName),
    },
    context.now
  );

  await readinessHistoryRepository.recordDaily(studentId, readinessResult.readinessScore, skillMatchPercent, context.now);

  const milestonesByHorizon = generateRoadmaps(ranked);
  for (const horizon of Object.values(ROADMAP_HORIZON)) {
    await careerRoadmapRepository.upsertHorizon(studentId, horizon, {
      targetRoleId: primaryRole?.id || null,
      milestones: milestonesByHorizon[horizon] || [],
    });
  }

  careerBus.publish(CAREER_EVENT_NAMES.CAREER_PROFILE_UPDATED, {
    studentId,
    trigger,
    readinessScore: readinessResult.readinessScore,
    timestamp: context.now,
  });

  return {
    studentId,
    readinessScore: readinessResult.readinessScore,
    recommendationsGenerated: persisted.length,
    retired: toRetire.length,
    skillGapsOpen: skillGaps.length,
    closedGaps,
  };
};

const recalculate = (studentId) => generateForStudent(studentId, "manual-recalculate").then(toRecalculateResponse);

const requireProfile = async (studentId) => {
  const profile = await careerProfileRepository.findByStudent(studentId);
  if (!profile) throw new ApiError(404, "No career profile calculated yet for this student — call POST /career/recalculate first");
  return profile;
};

const getProfile = async (studentId) => toProfileResponse(await requireProfile(studentId));

/**
 * Trusted, cross-agent read (the Placement Agent uses this for job
 * matching). Returns null rather than throwing when no profile exists yet
 * — absence is a normal case for a cross-agent caller, not an error. Bundles
 * the profile with the real skill vector (SkillAssessment rows) since job
 * matching needs per-skill proficiency, not just the summary scores.
 */
const getFullState = async (studentId) => {
  const [profile, skills] = await Promise.all([careerProfileRepository.findByStudent(studentId), skillAssessmentRepository.findAllByStudent(studentId)]);
  if (!profile) return null;

  return {
    ...toProfileResponse(profile),
    skillVector: skills.map((skill) => ({ skillName: skill.skillName, proficiency: skill.proficiency, status: skill.status })),
  };
};

const getReadiness = async (studentId) => toReadinessResponse(await requireProfile(studentId));

const getRoles = async (studentId) => toRolesResponse(await requireProfile(studentId));

const getRoadmap = async (studentId, horizon) => {
  const roadmaps = await careerRoadmapRepository.findByStudent(studentId);
  return toRoadmapResponse(studentId, horizon ? roadmaps.filter((r) => r.horizon === horizon) : roadmaps);
};

const getSkillGaps = async (studentId) => {
  const profile = await requireProfile(studentId);
  if (!profile.primaryTargetRoleId) return toSkillGapsResponse(studentId, null, []);
  const gaps = await skillGapRepository.findOpenByStudentAndRole(studentId, profile.primaryTargetRoleId);
  return toSkillGapsResponse(studentId, profile.primaryTargetRole, gaps);
};

const getRecommendations = async (studentId, type) => {
  const recommendations = await careerRecommendationRepository.findActiveByStudent(studentId, { type });
  return toRecommendationListResponse(studentId, recommendations);
};

const getInterviewPlan = async (studentId) => {
  const recommendations = await careerRecommendationRepository.findActiveByStudent(studentId);
  return toInterviewPlanResponse(
    studentId,
    recommendations.filter((r) => INTERVIEW_PREP_TYPES.includes(r.type))
  );
};

/**
 * Only one ACTIVE goal per student — abandons whatever's currently active,
 * creates the new one, then immediately recomputes (a goal change is rare
 * enough, and consequential enough, to warrant a synchronous recompute
 * rather than waiting for the next debounced trigger).
 */
const setGoal = async (studentId, { targetRoleId, targetRoleName, targetDate, notes }) => {
  const role = targetRoleId ? await industryRoleRepository.findById(targetRoleId) : await industryRoleRepository.findByName(targetRoleName);
  if (!role) throw new ApiError(404, "Target industry role not found");

  await careerGoalRepository.abandonActive(studentId);
  const goal = await careerGoalRepository.create(studentId, { targetRoleId: role.id, targetDate, notes });

  await generateForStudent(studentId, "goal-updated");

  return toGoalResponse(goal);
};

module.exports = {
  generateForStudent,
  recalculate,
  getProfile,
  getFullState,
  getReadiness,
  getRoles,
  getRoadmap,
  getSkillGaps,
  getRecommendations,
  getInterviewPlan,
  setGoal,
};
