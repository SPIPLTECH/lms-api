const toRecommendationEntry = (rec) => ({
  id: rec.id,
  type: rec.type,
  priority: rec.priority,
  status: rec.status,
  score: rec.score,
  confidenceScore: rec.confidenceScore,
  reason: rec.reason,
  estimatedTimeMinutes: rec.estimatedTimeMinutes,
  courseId: rec.courseId,
  moduleId: rec.moduleId,
  lessonId: rec.lessonId,
  metadata: rec.metadata,
  version: rec.version,
  generatedAt: rec.generatedAt,
  expiresAt: rec.expiresAt,
});

/** GET /recommendations/:studentId, /today, /high-priority, /revision, /learning */
const toRecommendationListResponse = (studentId, recommendations) => ({
  studentId,
  count: recommendations.length,
  recommendations: recommendations.map(toRecommendationEntry),
});

/** GET /recommendations/today */
const toTodayResponse = (studentId, { dailyTask, highPriorityToday }) => ({
  studentId,
  dailyTask: dailyTask ? toRecommendationEntry(dailyTask) : null,
  highPriorityToday: highPriorityToday.map(toRecommendationEntry),
});

/** POST /recommendations/recalculate */
const toRecalculateResponse = (result) => ({
  studentId: result.studentId,
  generated: result.generated,
  retired: result.retired,
});

/** POST /recommendations/feedback */
const toFeedbackResponse = (feedback) => ({
  id: feedback.id,
  recommendationId: feedback.recommendationId,
  studentId: feedback.studentId,
  action: feedback.action,
  comment: feedback.comment,
  createdAt: feedback.createdAt,
});

module.exports = {
  toRecommendationEntry,
  toRecommendationListResponse,
  toTodayResponse,
  toRecalculateResponse,
  toFeedbackResponse,
};
