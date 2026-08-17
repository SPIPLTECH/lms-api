const { RECOMMENDATION_TYPE } = require("../../../constants");

const VIDEO_CONTENT_TYPES = new Set(["VIDEO"]);

/**
 * Recommends video content belonging to the student's current lesson.
 * Limitation: Progress is tracked per-lesson, not per-content-item, so this
 * can't tell which specific video within the lesson was already watched —
 * it surfaces the lesson's video content whenever the lesson itself isn't
 * complete yet. Precise per-content tracking would need a schema change
 * outside this agent's boundary.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const progress = context.learningState?.progress;
  if (!progress?.currentLessonId || progress.lessonCompletionPercent >= 100) return [];

  const videos = (context.currentLessonContents || []).filter((c) => VIDEO_CONTENT_TYPES.has(c.type));
  if (videos.length === 0) return [];

  const target = videos[0];
  const estimatedTimeMinutes = target.duration ? Math.max(1, Math.round(target.duration / 60)) : 10;

  return [
    {
      type: RECOMMENDATION_TYPE.WATCH_RECOMMENDED_VIDEO,
      dedupeKey: target.id,
      reason: `"${target.title || "This video"}" is part of your current lesson and not yet complete.`,
      urgency: 40,
      impact: 55,
      confidence: 70,
      estimatedTimeMinutes,
      courseId: progress.currentCourseId || undefined,
      moduleId: progress.currentModuleId || undefined,
      lessonId: progress.currentLessonId,
      metadata: { contentId: target.id },
    },
  ];
};

module.exports = { generate };
