const prisma = require("../../../../config/database");
const { DEFAULT_LESSON_MINUTES } = require("../../constants");

const estimateLessonMinutes = (lesson) => {
  const contents = (lesson.topics || []).flatMap((topic) => topic.contents || []);
  const totalSeconds = contents.reduce((sum, content) => sum + (content.duration || 0), 0);
  return totalSeconds > 0 ? Math.round(totalSeconds / 60) : DEFAULT_LESSON_MINUTES;
};

/**
 * Real per-module estimated minutes — the "original duration" baseline that
 * Smart Revision / Deep Learning compress or expand from. Own copy of the
 * same Module -> Lesson -> Content read every other agent that needs course
 * duration performs (Learning Path's sequencer.js, Assessment's
 * entrySyllabusBuilder.js) — per-agent convention, not a shared import.
 *
 * @param {string} courseId
 * @returns {Promise<Map<string, number>>} moduleId -> total estimated minutes
 */
const readModuleMinutes = async (courseId) => {
  const modules = await prisma.module.findMany({
    where: { courseId, isPublished: true },
    include: { lessons: { where: { isPublished: true }, include: { topics: { include: { contents: { select: { duration: true } } } } } } },
  });

  return new Map(modules.map((module) => [module.id, module.lessons.reduce((sum, lesson) => sum + estimateLessonMinutes(lesson), 0)]));
};

module.exports = { readModuleMinutes, estimateLessonMinutes };
