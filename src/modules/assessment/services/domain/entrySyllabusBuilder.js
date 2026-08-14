const prisma = require("../../../../config/database");
const { DEFAULT_LESSON_MINUTES } = require("../../constants");

const estimateLessonMinutes = (lesson) => {
  const totalSeconds = (lesson.contents || []).reduce((sum, content) => sum + (content.duration || 0), 0);
  return totalSeconds > 0 ? Math.round(totalSeconds / 60) : DEFAULT_LESSON_MINUTES;
};

/**
 * Real Module titles/descriptions are this LMS's closest equivalent to a
 * course "syllabus" (see the module doc comment on EntryAssessment in
 * schema.prisma) — one concept per published module. Also returns each
 * module's total estimated minutes, which Student State later uses as the
 * "original duration" baseline for Smart Revision / Deep Learning time
 * compression.
 *
 * @param {string} courseId
 * @returns {Promise<{course: {id: string, title: string, description: string|null}, concepts: {moduleId: string, title: string, description: string|null, originalMinutes: number}[]}|null>}
 *   null when the course has no published modules to build an assessment from.
 */
const buildSyllabus = async (courseId) => {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, description: true } });
  if (!course) return null;

  const modules = await prisma.module.findMany({
    where: { courseId, isPublished: true },
    orderBy: { order: "asc" },
    include: { lessons: { where: { isPublished: true }, include: { contents: { select: { duration: true } } } } },
  });

  const concepts = modules
    .filter((module) => module.lessons.length > 0)
    .map((module) => ({
      moduleId: module.id,
      title: module.title,
      description: module.description || null,
      originalMinutes: module.lessons.reduce((sum, lesson) => sum + estimateLessonMinutes(lesson), 0),
    }));

  if (concepts.length === 0) return null;

  return { course, concepts };
};

module.exports = { buildSyllabus, estimateLessonMinutes };
