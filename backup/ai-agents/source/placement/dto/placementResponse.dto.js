/** GET /placement/profile/:studentId */
const toProfileResponse = (profile) => ({
  studentId: profile.studentId,
  placementReadinessScore: profile.placementReadinessScore,
  interviewReadinessScore: profile.interviewReadinessScore,
  resumeQualityScore: profile.resumeQualityScore,
  portfolioQualityScore: profile.portfolioQualityScore,
  topJobMatchPercent: profile.topJobMatchPercent,
  topCompanyMatchScore: profile.topCompanyMatchScore,
  topCompanyId: profile.topCompanyId,
  topOpportunityType: profile.topOpportunityType,
  topOpportunityId: profile.topOpportunityId,
  missingSkillsSummary: profile.missingSkillsSummary,
  preparationSuggestions: profile.preparationSuggestions,
  version: profile.version,
  lastCalculatedAt: profile.lastCalculatedAt,
});

const toJobEntry = (job) => ({
  id: job.id,
  title: job.title,
  company: job.company ? { id: job.company.id, name: job.company.name, industry: job.company.industry } : null,
  requiredSkills: job.requiredSkills,
  employmentType: job.employmentType,
  location: job.location,
  isRemote: job.isRemote,
  salaryMin: job.salaryMin,
  salaryMax: job.salaryMax,
  currency: job.currency,
  applicationDeadline: job.applicationDeadline,
  status: job.status,
  postedAt: job.postedAt,
});

/** GET /placement/jobs */
const toJobListResponse = (jobs) => ({ count: jobs.length, jobs: jobs.map(toJobEntry) });

const toInternshipEntry = (internship) => ({
  id: internship.id,
  title: internship.title,
  company: internship.company ? { id: internship.company.id, name: internship.company.name, industry: internship.company.industry } : null,
  requiredSkills: internship.requiredSkills,
  durationWeeks: internship.durationWeeks,
  stipend: internship.stipend,
  currency: internship.currency,
  location: internship.location,
  isRemote: internship.isRemote,
  isPPO: internship.isPPO,
  applicationDeadline: internship.applicationDeadline,
  status: internship.status,
  postedAt: internship.postedAt,
});

/** GET /placement/internships */
const toInternshipListResponse = (internships) => ({ count: internships.length, internships: internships.map(toInternshipEntry) });

const toDriveEntry = (drive) => ({
  id: drive.id,
  title: drive.title,
  company: drive.company ? { id: drive.company.id, name: drive.company.name } : null,
  description: drive.description,
  driveDate: drive.driveDate,
  eligibilityCriteria: drive.eligibilityCriteria,
  registrationDeadline: drive.registrationDeadline,
  status: drive.status,
});

/** GET /placement/drives */
const toDriveListResponse = (drives) => ({ count: drives.length, drives: drives.map(toDriveEntry) });

const toMatchEntry = (match) => ({
  id: match.id,
  opportunityType: match.opportunityType,
  opportunityId: match.opportunityId,
  matchPercent: match.matchPercent,
  missingSkills: match.missingSkills,
  priority: match.priority,
  status: match.status,
  reason: match.reason,
  generatedAt: match.generatedAt,
});

/** GET /placement/matches */
const toMatchListResponse = (studentId, matches) => ({ studentId, count: matches.length, matches: matches.map(toMatchEntry) });

const toApplicationEntry = (application) => ({
  id: application.id,
  opportunityType: application.opportunityType,
  opportunityId: application.opportunityId,
  driveId: application.driveId,
  status: application.status,
  notes: application.notes,
  appliedAt: application.appliedAt,
});

/** GET /placement/applications, POST /placement/application */
const toApplicationListResponse = (studentId, applications) => ({ studentId, count: applications.length, applications: applications.map(toApplicationEntry) });

const toInterviewEntry = (interview) => ({
  id: interview.id,
  applicationId: interview.applicationId,
  round: interview.round,
  interviewType: interview.interviewType,
  scheduledAt: interview.scheduledAt,
  status: interview.status,
  outcome: interview.outcome,
  feedback: interview.feedback,
});

/** GET /placement/interviews */
const toInterviewListResponse = (studentId, interviews) => ({ studentId, count: interviews.length, interviews: interviews.map(toInterviewEntry) });

const toOfferEntry = (offer) => ({
  id: offer.id,
  applicationId: offer.applicationId,
  opportunityType: offer.opportunityType,
  opportunityId: offer.opportunityId,
  role: offer.role,
  salary: offer.salary,
  currency: offer.currency,
  joiningDate: offer.joiningDate,
  status: offer.status,
  offeredAt: offer.offeredAt,
});

/** GET /placement/offers */
const toOfferListResponse = (studentId, offers) => ({ studentId, count: offers.length, offers: offers.map(toOfferEntry) });

/** POST /placement/recalculate */
const toRecalculateResponse = (result) => ({
  studentId: result.studentId,
  placementReadinessScore: result.placementReadinessScore,
  matchesGenerated: result.matchesGenerated,
  retired: result.retired,
});

module.exports = {
  toProfileResponse,
  toJobEntry,
  toJobListResponse,
  toInternshipEntry,
  toInternshipListResponse,
  toDriveEntry,
  toDriveListResponse,
  toMatchEntry,
  toMatchListResponse,
  toApplicationEntry,
  toApplicationListResponse,
  toInterviewEntry,
  toInterviewListResponse,
  toOfferEntry,
  toOfferListResponse,
  toRecalculateResponse,
};
