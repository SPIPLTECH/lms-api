/** GET /learning-path/:studentId */
const toPathResponse = (path) => ({
  studentId: path.studentId,
  currentCourseId: path.currentCourseId,
  nextLessonId: path.nextLessonId,
  nextModuleId: path.nextModuleId,
  recommendedLearningOrder: path.recommendedLearningOrder,
  priorityTopics: path.priorityTopics,
  difficultyAdjustment: path.difficultyAdjustment,
  suggestedStudyMinutesPerDay: path.suggestedStudyMinutesPerDay,
  estimatedCompletionDate: path.estimatedCompletionDate,
  version: path.version,
  lastCalculatedAt: path.lastCalculatedAt,
});

/** GET /learning-path/next */
const toNextResponse = (path) => ({
  studentId: path.studentId,
  courseId: path.currentCourseId,
  nextLessonId: path.nextLessonId,
  nextModuleId: path.nextModuleId,
  suggestedStudyMinutesPerDay: path.suggestedStudyMinutesPerDay,
});

/** GET /learning-path/daily-plan, /weekly-plan */
const toStudyPlanResponse = (plan) => ({
  studentId: plan.studentId,
  planType: plan.planType,
  periodStart: plan.periodStart,
  periodEnd: plan.periodEnd,
  scheduledItems: plan.scheduledItems,
  suggestedStudyMinutes: plan.suggestedStudyMinutes,
  generatedAt: plan.generatedAt,
});

const toRecommendationEntry = (rec) => ({
  id: rec.id,
  type: rec.type,
  priority: rec.priority,
  status: rec.status,
  reason: rec.reason,
  courseId: rec.courseId,
  moduleId: rec.moduleId,
  lessonId: rec.lessonId,
  metadata: rec.metadata,
  generatedAt: rec.generatedAt,
});

/** GET /learning-path/recommendations */
const toRecommendationListResponse = (studentId, recommendations) => ({
  studentId,
  count: recommendations.length,
  recommendations: recommendations.map(toRecommendationEntry),
});

const toMilestoneEntry = (milestone) => ({
  id: milestone.id,
  courseId: milestone.courseId,
  milestoneType: milestone.milestoneType,
  moduleId: milestone.moduleId,
  title: milestone.title,
  status: milestone.status,
  targetDate: milestone.targetDate,
  achievedAt: milestone.achievedAt,
});

/** GET /learning-path/milestones */
const toMilestoneListResponse = (studentId, milestones) => ({
  studentId,
  count: milestones.length,
  milestones: milestones.map(toMilestoneEntry),
});

/** POST /learning-path/recalculate */
const toRecalculateResponse = (result) => ({
  studentId: result.studentId,
  hasActiveCourse: result.hasActiveCourse,
  recommendationsGenerated: result.recommendationsGenerated,
  retired: result.retired,
  milestonesGenerated: result.milestonesGenerated,
  revisionTopicsOpen: result.revisionTopicsOpen,
});

module.exports = {
  toPathResponse,
  toNextResponse,
  toStudyPlanResponse,
  toRecommendationEntry,
  toRecommendationListResponse,
  toMilestoneEntry,
  toMilestoneListResponse,
  toRecalculateResponse,
};
