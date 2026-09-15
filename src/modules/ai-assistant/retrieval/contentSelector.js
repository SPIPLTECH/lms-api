const prisma = require("../../../config/database");
const { SOURCE_TYPE, PRIORITY, SCOPE } = require("../constants/aiAssistant.constants");
const { buildCourseOverviewContext, clamp, stripHtml } = require("../context/courseOverview.context");
const { buildCourseContentContext } = require("../context/courseContent.context");
const { applyContextBudget } = require("./contextBudget");

/**
 * Platform catalog context built when no specific courseId is provided.
 *
 * Provides high-level public catalog information (published course titles,
 * categories, levels, and summaries) so general queries like "What courses are
 * available on Orange Tree?" can be answered accurately in GUEST and BROWSING
 * modes without inventing fake courses or triggering grounding refusals.
 */
const buildCatalogOverviewContext = async () => {
  const publishedCourses = await prisma.course.findMany({
    where: { status: "PUBLISHED" },
    select: {
      id: true,
      title: true,
      category: true,
      level: true,
      description: true,
      estimatedLearningHours: true,
      creator: { select: { name: true } },
    },
    take: 15,
    orderBy: { createdAt: "desc" },
  });

  const catalogSummary = publishedCourses.length
    ? publishedCourses
        .map((c, i) => {
          const desc = clamp(stripHtml(c.description), 180);
          return `${i + 1}. "${c.title}" — Category: ${c.category || "General"} | Level: ${c.level || "All Levels"}${c.creator?.name ? ` | Instructor: ${c.creator.name}` : ""}${desc ? `\n   Summary: ${desc}` : ""}`;
        })
        .join("\n\n")
    : "No published courses found at this moment.";

  return [
    {
      sourceType: SOURCE_TYPE.COURSE,
      sourceId: "platform:overview",
      title: "Orange Tree LMS Platform & Learning Model",
      text: `Orange Tree LMS Platform & Learning Model:
- Overview: Orange Tree LMS is a modern learning platform offering structured online courses across various subjects and technical domains.
- How Learning Works:
  1. Course Discovery: Browse available courses by category, domain, and skill level (Beginner, Intermediate, Advanced).
  2. Enrollment & Syllabus: Enroll in courses to access structured learning paths organised into Modules, Lessons, and Topics.
  3. Interactive Materials & Practice: Study topics with rich learning materials and test understanding through self-tests, quizzes, and assignments.
  4. Progress & Certificates: Track progress through course modules and receive completion certificates upon successfully completing courses.`,
      priority: PRIORITY.COURSE,
    },
    {
      sourceType: SOURCE_TYPE.COURSE,
      sourceId: "platform:catalog",
      title: "Orange Tree LMS Available Course Catalog",
      text: `Available Published Courses on Orange Tree LMS:\n\n${catalogSummary}`,
      priority: PRIORITY.COURSE,
    },
  ];
};

const select = async ({ scope, courseId, position = {}, budget }) => {
  const collected = [];

  if (!courseId) {
    const catalogChunks = await buildCatalogOverviewContext();
    collected.push(...catalogChunks);
  } else {
    // Course-level metadata is the floor for every scope, including ENROLLED —
    // an enrolled student still asks "what is this course about".
    const overview = await buildCourseOverviewContext(courseId);
    collected.push(...overview.chunks);

    if (scope === SCOPE.ENROLLED) {
      const deep = await buildCourseContentContext(courseId, position);
      collected.push(...deep.chunks);
    }
  }

  const budgeted = applyContextBudget(collected, budget);

  return {
    ...budgeted,
    sourceIds: budgeted.chunks.map((c) => `${c.sourceType}:${c.sourceId}`),
  };
};

module.exports = { select };
