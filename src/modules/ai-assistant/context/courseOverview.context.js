const prisma = require("../../../config/database");
const { SOURCE_TYPE, PRIORITY, LIMITS } = require("../constants/aiAssistant.constants");

// Marketing/HTML in a description helps nobody and wastes budget.
const stripHtml = (s) =>
  typeof s === "string" ? s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";

const clamp = (s, max) => (s && s.length > max ? `${s.slice(0, max)}…` : s || "");

/**
 * The ONLY context a GUEST or BROWSING user ever receives.
 *
 * Everything here is information a visitor already sees rendered on the
 * public course page: metadata, counts, and MODULE TITLES. It deliberately
 * stops there — no lesson titles, no topic titles, and under no circumstance
 * a Content row, a transcript, or a quiz question. That boundary is enforced
 * by what this query selects, not by asking the model to behave.
 *
 * Module titles are included because a syllabus outline is exactly the
 * "what will I learn" information a prospective student needs, and it is
 * already public on the course page.
 */
const buildCourseOverviewContext = async (courseId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      level: true,
      language: true,
      tags: true,
      estimatedLearningHours: true,
      status: true,
      certificatesEnabled: true,
      creator: { select: { name: true } },
      store: { select: { price: true, discountPrice: true, isFree: true, currency: true } },
      _count: { select: { modules: true, enrollments: true, quizzes: true, assignments: true, reviews: true } },
      modules: {
        where: { isPublished: true },
        orderBy: { order: "asc" },
        // TITLES ONLY. No `lessons`, no `contents`. Adding either here is the
        // single easiest way to turn this into a content leak.
        select: { id: true, title: true, description: true, order: true },
      },
    },
  });

  if (!course) return { chunks: [], course: null };

  const lines = [
    `Course title: ${course.title}`,
    course.category ? `Category / specialization: ${course.category}` : null,
    course.level ? `Level: ${course.level}` : null,
    course.language ? `Language: ${course.language}` : null,
    course.tags?.length ? `Topics covered (tags): ${course.tags.join(", ")}` : null,
    course.estimatedLearningHours ? `Estimated duration: ${course.estimatedLearningHours} hours` : null,
    course.creator?.name ? `Instructor: ${course.creator.name}` : null,
    `Certificate on completion: ${course.certificatesEnabled ? "yes" : "no"}`,
    `Structure: ${course._count.modules} module(s), ${course._count.quizzes} quiz(zes), ${course._count.assignments} assignment(s)`,
    course.description ? `Description: ${clamp(stripHtml(course.description), 2000)}` : null,
  ].filter(Boolean);

  const chunks = [
    {
      sourceType: SOURCE_TYPE.COURSE,
      sourceId: course.id,
      title: course.title,
      text: lines.join("\n"),
      priority: PRIORITY.COURSE,
    },
  ];

  if (course.modules.length) {
    const outline = course.modules
      .slice(0, LIMITS.MAX_RELATED_ITEMS)
      .map((m, i) => {
        const desc = clamp(stripHtml(m.description), 240);
        return `${i + 1}. ${m.title}${desc ? ` — ${desc}` : ""}`;
      })
      .join("\n");

    chunks.push({
      sourceType: SOURCE_TYPE.COURSE,
      sourceId: `${course.id}:outline`,
      title: "Course outline (module titles)",
      text: `The course is organised into these modules:\n${outline}`,
      priority: PRIORITY.COURSE,
    });
  }

  return { chunks, course };
};

module.exports = { buildCourseOverviewContext, stripHtml, clamp };
