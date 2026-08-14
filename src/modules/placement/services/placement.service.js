const ApiError = require("../../../utils/ApiError");

const placementProfileRepository = require("../repositories/placementProfile.repository");
const jobMatchRepository = require("../repositories/jobMatch.repository");
const applicationRepository = require("../repositories/application.repository");
const interviewRepository = require("../repositories/interview.repository");
const offerRepository = require("../repositories/offer.repository");
const resumeReviewRepository = require("../repositories/resumeReview.repository");
const jobOpportunityRepository = require("../repositories/jobOpportunity.repository");
const internshipOpportunityRepository = require("../repositories/internshipOpportunity.repository");
const placementDriveRepository = require("../repositories/placementDrive.repository");
const companyRepository = require("../repositories/company.repository");

const { buildContext } = require("./context/studentContextBuilder");
const { matchOpportunities } = require("../ai/jobMatchEngine");
const { detectMissingSkills } = require("../ai/skillGapDetector");
const { calculateInterviewReadiness } = require("../ai/interviewReadinessEngine");
const { calculateResumePortfolioScores } = require("../ai/resumePortfolioScorer");
const { calculatePlacementReadiness } = require("../ai/placementReadinessScorer");
const { rankOpportunities } = require("../ai/opportunityRanker");
const { generatePreparationSuggestions } = require("../ai/preparationSuggestionEngine");

const { average } = require("../utils/scoreMath.util");
const { buildDedupeKey } = require("../utils/dedupeKey.util");

const { placementBus } = require("../events/eventBus");
const { PLACEMENT_EVENT_NAMES } = require("../events/eventNames");

const { OPPORTUNITY_TYPE, JOB_MATCH_STATUS, TOP_MISSING_SKILLS_COUNT, PROFILE_COMPLETENESS_FIELDS } = require("../constants");

const {
  toProfileResponse,
  toJobListResponse,
  toInternshipListResponse,
  toDriveListResponse,
  toMatchListResponse,
  toApplicationListResponse,
  toApplicationEntry,
  toInterviewListResponse,
  toOfferListResponse,
  toRecalculateResponse,
} = require("../dto/placementResponse.dto");

const resolveProfileCompleteness = (studentProfile) => {
  if (!studentProfile) return 0;
  const filledCount = PROFILE_COMPLETENESS_FIELDS.filter((field) => {
    const value = studentProfile[field];
    return value !== null && value !== undefined && value !== "";
  }).length;
  return filledCount / PROFILE_COMPLETENESS_FIELDS.length;
};

const buildMatchReason = (candidate) => {
  const kind = candidate.opportunityType === OPPORTUNITY_TYPE.JOB ? "job" : "internship";
  return candidate.missingSkills.length === 0
    ? `You meet every required skill for this ${kind} at "${candidate.opportunity.title}".`
    : `${candidate.matchPercent}% skill match for "${candidate.opportunity.title}" — missing: ${candidate.missingSkills.slice(0, 3).join(", ")}.`;
};

const buildMatchCandidates = (opportunityType, skillVector, catalog) =>
  matchOpportunities(skillVector, catalog)
    .map((m) => ({
      opportunityType,
      opportunityId: m.opportunity.id,
      matchPercent: m.matchPercent,
      opportunity: m.opportunity,
      missingSkills: detectMissingSkills(skillVector, m.opportunity).slice(0, TOP_MISSING_SKILLS_COUNT),
    }))
    .filter((candidate) => candidate.matchPercent > 0); // zero-signal matches are noise, not a real suggestion

/**
 * The core pipeline: Analyze Student Profile -> Calculate Employability ->
 * Match Opportunities -> Rank Opportunities -> Generate Recommendations ->
 * Persist -> Publish PlacementUpdated. Called on every trigger (debounced
 * event, the daily sweep, or an explicit POST /placement/recalculate).
 *
 * @param {string} studentId
 * @param {string} [trigger] - for logging only.
 */
const generateForStudent = async (studentId, trigger = "manual") => {
  const context = await buildContext(studentId);
  const skillVector = context.careerState?.skillVector || [];

  const candidates = [
    ...buildMatchCandidates(OPPORTUNITY_TYPE.JOB, skillVector, context.jobCatalog),
    ...buildMatchCandidates(OPPORTUNITY_TYPE.INTERNSHIP, skillVector, context.internshipCatalog),
  ];
  const ranked = rankOpportunities(candidates, context.now);

  const existingActiveKeys = await jobMatchRepository.findAllActiveDedupeKeys(studentId);
  const rankedDedupeKeys = new Set();

  const persisted = [];
  for (const candidate of ranked) {
    const dedupeKey = buildDedupeKey(candidate.opportunityType, candidate.opportunityId);
    rankedDedupeKeys.add(dedupeKey);
    const row = await jobMatchRepository.upsertCandidate(studentId, {
      opportunityType: candidate.opportunityType,
      opportunityId: candidate.opportunityId,
      dedupeKey,
      matchPercent: candidate.matchPercent,
      missingSkills: candidate.missingSkills,
      priority: candidate.priority,
      reason: buildMatchReason(candidate),
    });
    persisted.push(row);
  }

  // Anything still ACTIVE but not regenerated this cycle no longer applies (e.g. the opportunity closed, or the student's skills no longer match at all).
  const toRetire = existingActiveKeys.filter((row) => !rankedDedupeKeys.has(row.dedupeKey));
  for (const row of toRetire) {
    await jobMatchRepository.updateStatus(row.id, JOB_MATCH_STATUS.EXPIRED);
  }

  const careerReadinessScore = context.careerState?.readinessScore || 0;
  const assessmentMasteryAvg = average((context.assessmentState?.mastery?.concepts || []).map((concept) => concept.masteryScore));

  const { interviewReadinessScore } = calculateInterviewReadiness({
    careerReadinessScore,
    assessmentMasteryAvg,
    interviewHistory: context.interviewHistory,
  });

  const { resumeQualityScore, portfolioQualityScore } = calculateResumePortfolioScores({
    credentialCount: context.certificates.length,
    skillCount: skillVector.length,
    profileCompletenessRatio: resolveProfileCompleteness(context.studentProfile),
  });

  const topMatch = ranked[0] || null;
  const topJobMatchPercent = topMatch?.matchPercent || 0;
  const topCompanyId = topMatch?.opportunity?.companyId || null;
  const topCompany = topCompanyId ? await companyRepository.findById(topCompanyId) : null;
  const missingSkillsSummary = topMatch?.missingSkills || [];

  const placementReadinessScore = calculatePlacementReadiness({
    topJobMatchPercent,
    interviewReadinessScore,
    resumeQualityScore,
    portfolioQualityScore,
    careerReadinessScore,
  });

  const preparationSuggestions = generatePreparationSuggestions({
    interviewReadinessScore,
    resumeQualityScore,
    portfolioQualityScore,
    missingSkillsCount: missingSkillsSummary.length,
    topCompanyName: topCompany?.name || null,
  });

  await placementProfileRepository.upsert(
    studentId,
    {
      placementReadinessScore,
      interviewReadinessScore,
      resumeQualityScore,
      portfolioQualityScore,
      topJobMatchPercent,
      topCompanyMatchScore: topJobMatchPercent, // the best current match IS the company-match signal — see schema.prisma's PlacementProfile doc
      topCompanyId,
      topOpportunityType: topMatch?.opportunityType || null,
      topOpportunityId: topMatch?.opportunityId || null,
      missingSkillsSummary,
      preparationSuggestions,
    },
    context.now
  );

  await resumeReviewRepository.recordDaily(studentId, { resumeQualityScore, portfolioQualityScore, suggestions: preparationSuggestions }, context.now);

  placementBus.publish(PLACEMENT_EVENT_NAMES.PLACEMENT_UPDATED, {
    studentId,
    trigger,
    placementReadinessScore,
    timestamp: context.now,
  });

  return { studentId, placementReadinessScore, matchesGenerated: persisted.length, retired: toRetire.length };
};

const recalculate = (studentId) => generateForStudent(studentId, "manual-recalculate").then(toRecalculateResponse);

const requireProfile = async (studentId) => {
  const profile = await placementProfileRepository.findByStudent(studentId);
  if (!profile) throw new ApiError(404, "No placement profile calculated yet for this student — call POST /placement/recalculate first");
  return profile;
};

const getProfile = async (studentId) => toProfileResponse(await requireProfile(studentId));

const getJobs = async (filters) => toJobListResponse(await jobOpportunityRepository.search(filters));

const getInternships = async (filters) => toInternshipListResponse(await internshipOpportunityRepository.search(filters));

const getDrives = async () => toDriveListResponse(await placementDriveRepository.findAllUpcoming());

const getMatches = async (studentId, opportunityType) =>
  toMatchListResponse(studentId, await jobMatchRepository.findActiveByStudent(studentId, { opportunityType }));

const getApplications = async (studentId, status) => toApplicationListResponse(studentId, await applicationRepository.findByStudent(studentId, { status }));

const getInterviews = async (studentId) => toInterviewListResponse(studentId, await interviewRepository.findByStudent(studentId));

const getOffers = async (studentId) => toOfferListResponse(studentId, await offerRepository.findByStudent(studentId));

/**
 * Purely a tracking record — per the constraint that this agent must NEVER
 * apply for jobs on a student's behalf, this only records that the
 * student says they applied; it never submits anything to a real
 * ATS/company. If an active JobMatch exists for the same opportunity, it's
 * flipped to APPLIED so it stops surfacing as a fresh suggestion.
 */
const createApplication = async (studentId, { opportunityType, opportunityId, driveId, notes }) => {
  const opportunity =
    opportunityType === OPPORTUNITY_TYPE.JOB
      ? await jobOpportunityRepository.findById(opportunityId)
      : await internshipOpportunityRepository.findById(opportunityId);
  if (!opportunity) throw new ApiError(404, `${opportunityType === OPPORTUNITY_TYPE.JOB ? "Job" : "Internship"} opportunity not found`);

  const existing = await applicationRepository.findByStudentAndOpportunity(studentId, opportunityType, opportunityId);
  if (existing) throw new ApiError(409, "You have already tracked an application for this opportunity");

  const application = await applicationRepository.create(studentId, { opportunityType, opportunityId, driveId, notes });

  const dedupeKey = buildDedupeKey(opportunityType, opportunityId);
  const activeMatches = await jobMatchRepository.findAllActiveDedupeKeys(studentId);
  const matchingRow = activeMatches.find((row) => row.dedupeKey === dedupeKey);
  if (matchingRow) await jobMatchRepository.updateStatus(matchingRow.id, JOB_MATCH_STATUS.APPLIED);

  placementBus.publish(PLACEMENT_EVENT_NAMES.PLACEMENT_UPDATED, { studentId, trigger: "application-tracked", timestamp: new Date() });

  return toApplicationEntry(application);
};

module.exports = {
  generateForStudent,
  recalculate,
  getProfile,
  getJobs,
  getInternships,
  getDrives,
  getMatches,
  getApplications,
  getInterviews,
  getOffers,
  createApplication,
};
