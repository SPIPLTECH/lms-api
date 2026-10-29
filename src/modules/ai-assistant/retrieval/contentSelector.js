const prisma = require("../../../config/database");
const { SOURCE_TYPE, PRIORITY, SCOPE } = require("../constants/aiAssistant.constants");
const { buildCourseOverviewContext, clamp, stripHtml } = require("../context/courseOverview.context");
const { buildCourseContentContext } = require("../context/courseContent.context");
const { applyContextBudget } = require("./contextBudget");

/**
 * Builds the enrolled courses and study dashboard context for an authenticated student
 * who opened the assistant from My Courses or the general mobile bottom navigation bar.
 */
const buildStudentDashboardContext = async (userId) => {
  if (!userId) return [];
  const enrollments = await prisma.enrollment.findMany({
    where: { student: { userId } },
    select: {
      progress: true,
      lastAccessedAt: true,
      course: {
        select: {
          id: true,
          title: true,
          category: true,
          level: true,
          description: true,
          estimatedLearningHours: true,
        },
      },
    },
    orderBy: { lastAccessedAt: "desc" },
    take: 10,
  });

  if (!enrollments.length) {
    return [
      {
        sourceType: SOURCE_TYPE.COURSE,
        sourceId: "student:enrollments",
        title: "Student Enrolled Courses",
        text: "The student is signed in but has not yet enrolled in any courses on Orange Tree LMS. Advise them to access their assigned courses from the My Courses page.",
        priority: PRIORITY.COURSE,
      },
    ];
  }

  const list = enrollments
    .map((e, idx) => {
      const c = e.course;
      const desc = clamp(stripHtml(c.description), 160);
      return `${idx + 1}. "${c.title}" (Progress: ${Math.round(e.progress || 0)}%, Category: ${c.category || "General"}, Level: ${c.level || "All Levels"})${desc ? `\n   Overview: ${desc}` : ""}`;
    })
    .join("\n\n");

  return [
    {
      sourceType: SOURCE_TYPE.COURSE,
      sourceId: "student:enrollments",
      title: "Student Enrolled Courses & Study Dashboard",
      text: `The student is currently enrolled in these courses on Orange Tree LMS:\n\n${list}\n\n(Instruction for Assistant: You are talking to this enrolled student from their main learning dashboard. Help them resume their studies, explain concepts from their enrolled subjects, and provide study recommendations.)`,
      priority: PRIORITY.COURSE,
    },
  ];
};

/**
 * Fallback platform catalog context if a user has no enrolled courses or is unauthenticated.
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

const select = async ({ scope, courseId, position = {}, budget, userId }) => {
  const collected = [];

  if (!courseId) {
    if (userId) {
      const studentChunks = await buildStudentDashboardContext(userId);
      collected.push(...studentChunks);
    } else {
      const catalogChunks = await buildCatalogOverviewContext();
      collected.push(...catalogChunks);
    }
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
