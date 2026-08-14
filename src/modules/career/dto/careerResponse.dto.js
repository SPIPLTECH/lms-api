/** GET /career/profile/:studentId */
const toProfileResponse = (profile) => ({
  studentId: profile.studentId,
  readinessScore: profile.readinessScore,
  confidenceLevel: profile.confidenceLevel,
  industryReadiness: profile.industryReadiness,
  skillMatchPercent: profile.skillMatchPercent,
  primaryTargetRole: profile.primaryTargetRole
    ? { id: profile.primaryTargetRole.id, name: profile.primaryTargetRole.name, category: profile.primaryTargetRole.category }
    : null,
  topMatchedRoles: profile.topMatchedRoles,
  missingSkillsSummary: profile.missingSkillsSummary,
  version: profile.version,
  lastCalculatedAt: profile.lastCalculatedAt,
});

/** GET /career/readiness — the curated subset a quick-glance dashboard needs. */
const toReadinessResponse = (profile) => ({
  studentId: profile.studentId,
  readinessScore: profile.readinessScore,
  confidenceLevel: profile.confidenceLevel,
  industryReadiness: profile.industryReadiness,
  skillMatchPercent: profile.skillMatchPercent,
  lastCalculatedAt: profile.lastCalculatedAt,
});

/** GET /career/roles */
const toRolesResponse = (profile) => ({
  studentId: profile.studentId,
  primaryTargetRole: profile.primaryTargetRole
    ? { id: profile.primaryTargetRole.id, name: profile.primaryTargetRole.name, category: profile.primaryTargetRole.category }
    : null,
  recommendedRoles: profile.topMatchedRoles,
});

const toMilestoneEntry = (milestone) => ({
  order: milestone.order,
  title: milestone.title,
  type: milestone.type,
  estimatedDays: milestone.estimatedDays,
  startDay: milestone.startDay,
  endDay: milestone.endDay,
  description: milestone.description,
});

const toRoadmapEntry = (roadmap) => ({
  horizon: roadmap.horizon,
  targetRoleId: roadmap.targetRoleId,
  milestones: (roadmap.milestones || []).map(toMilestoneEntry),
  version: roadmap.version,
  generatedAt: roadmap.generatedAt,
});

/** GET /career/roadmap */
const toRoadmapResponse = (studentId, roadmaps) => ({
  studentId,
  roadmaps: roadmaps.map(toRoadmapEntry),
});

const toSkillGapEntry = (gap) => ({
  skillName: gap.skillName,
  requiredLevel: gap.requiredLevel,
  currentLevel: gap.currentLevel,
  gapSize: gap.gapSize,
  severity: gap.severity,
  status: gap.status,
  detectedAt: gap.detectedAt,
});

/** GET /career/skill-gaps */
const toSkillGapsResponse = (studentId, targetRole, gaps) => ({
  studentId,
  targetRole: targetRole ? { id: targetRole.id, name: targetRole.name } : null,
  count: gaps.length,
  gaps: gaps.map(toSkillGapEntry),
});

const toRecommendationEntry = (rec) => ({
  id: rec.id,
  type: rec.type,
  priority: rec.priority,
  status: rec.status,
  score: rec.score,
  confidenceScore: rec.confidenceScore,
  reason: rec.reason,
  estimatedTimeMinutes: rec.estimatedTimeMinutes,
  targetRoleId: rec.targetRoleId,
  metadata: rec.metadata,
  generatedAt: rec.generatedAt,
});

/** GET /career/recommendations */
const toRecommendationListResponse = (studentId, recommendations) => ({
  studentId,
  count: recommendations.length,
  recommendations: recommendations.map(toRecommendationEntry),
});

/** GET /career/interview-plan */
const toInterviewPlanResponse = (studentId, recommendations) => ({
  studentId,
  count: recommendations.length,
  plan: recommendations.map(toRecommendationEntry),
});

/** POST /career/goal */
const toGoalResponse = (goal) => ({
  id: goal.id,
  studentId: goal.studentId,
  status: goal.status,
  targetRole: goal.targetRole ? { id: goal.targetRole.id, name: goal.targetRole.name, category: goal.targetRole.category } : null,
  targetDate: goal.targetDate,
  notes: goal.notes,
  createdAt: goal.createdAt,
});

/** POST /career/recalculate */
const toRecalculateResponse = (result) => ({
  studentId: result.studentId,
  readinessScore: result.readinessScore,
  recommendationsGenerated: result.recommendationsGenerated,
  retired: result.retired,
  skillGapsOpen: result.skillGapsOpen,
  closedGaps: result.closedGaps,
});

module.exports = {
  toProfileResponse,
  toReadinessResponse,
  toRolesResponse,
  toRoadmapResponse,
  toSkillGapsResponse,
  toRecommendationEntry,
  toRecommendationListResponse,
  toInterviewPlanResponse,
  toGoalResponse,
  toRecalculateResponse,
};
