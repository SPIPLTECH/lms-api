const { DEFAULT_LESSON_MINUTES } = require("../../constants");

const estimateLessonMinutes = (lesson) => {
  const totalSeconds = (lesson.contents || []).reduce((sum, content) => sum + (content.duration || 0), 0);
  return totalSeconds > 0 ? Math.round(totalSeconds / 60) : DEFAULT_LESSON_MINUTES;
};

/**
 * Walks Module.order -> Lesson.order and marks each against real
 * Progress.completed rows. Module.order/Lesson.order already function as
 * this LMS's de facto prerequisite chain — there's no separate
 * prerequisite-graph model to consult.
 *
 * @param {Array} courseStructure - modules with nested lessons/contents, already ordered by the query.
 * @param {Map<string,{completed:boolean}>} progressByLessonId
 * @returns {import("../../types/learningPath.types").SequenceItem[]}
 */
const buildSequence = (courseStructure, progressByLessonId) => {
  const sequence = [];
  let order = 0;

  for (const module of courseStructure) {
    for (const lesson of module.lessons) {
      order += 1;
      sequence.push({
        lessonId: lesson.id,
        moduleId: module.id,
        title: lesson.title,
        order,
        completed: progressByLessonId.get(lesson.id)?.completed || false,
        estimatedMinutes: estimateLessonMinutes(lesson),
      });
    }
  }

  return sequence;
};

const findNextItem = (sequence) => sequence.find((item) => !item.completed) || null;

const remainingItems = (sequence) => sequence.filter((item) => !item.completed);

module.exports = { buildSequence, findNextItem, remainingItems, estimateLessonMinutes };
