const { RECOMMENDATION_TYPE } = require("../../../constants");

const NOTE_CONTENT_TYPES = new Set(["DOCUMENT", "TEXT", "PDF", "PRESENTATION", "HTML"]);

/**
 * Same limitation as video.generator.js: no per-content progress, so this
 * surfaces reading-type content for the current, not-yet-complete lesson
 * rather than tracking exactly which document was read.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const progress = context.learningState?.progress;
  if (!progress?.currentLessonId || progress.lessonCompletionPercent >= 100) return [];

  const notes = (context.currentLessonContents || []).filter((c) => NOTE_CONTENT_TYPES.has(c.type));
  if (notes.length === 0) return [];

  const target = notes[0];

  return [
    {
      type: RECOMMENDATION_TYPE.READ_RECOMMENDED_NOTES,
      dedupeKey: target.id,
      reason: `"${target.title || "These notes"}" cover material from your current lesson.`,
      urgency: 30,
      impact: 45,
      confidence: 65,
      estimatedTimeMinutes: 8,
      courseId: progress.currentCourseId || undefined,
      moduleId: progress.currentModuleId || undefined,
      lessonId: progress.currentLessonId,
      metadata: { contentId: target.id },
    },
  ];
};

module.exports = { generate };
