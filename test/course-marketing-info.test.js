const test = require("node:test");
const assert = require("node:assert");

const courseService = require("../src/modules/courses/course.service");
const prisma = require("../src/config/database");

// The marketing site reads one course's card fields, live counts and latest
// reviews. Every query is stubbed here, so no row is read from or written to
// the shared database.
const stub = (t, model, method, fn) => {
  const original = prisma[model][method];
  prisma[model][method] = fn;
  t.after(() => {
    prisma[model][method] = original;
  });
};

test("getCourseMarketingInfo returns the 16 marketing fields from the course tables", async (t) => {
  const args = {};
  const createdAt = new Date("2026-10-01T00:00:00Z");

  stub(t, "course", "findFirst", async (a) => {
    args.course = a;
    return {
      id: "c1",
      title: "Python Basics",
      description: "Learn Python",
      thumbnailUrl: "https://cdn/x.png",
      level: "Beginner",
      category: "Programming",
      language: "English",
      estimatedLearningHours: 12.5,
      certificatesEnabled: true,
      creator: { name: "Asha" },
      _count: { modules: 4, enrollments: 120, quizzes: 6 },
    };
  });
  stub(t, "lesson", "count", async (a) => {
    args.lessons = a;
    return 18;
  });
  stub(t, "assignment", "count", async (a) => {
    args.assignments = a;
    return 5;
  });
  stub(t, "review", "aggregate", async () => ({ _avg: { rating: 4.36 }, _count: { _all: 3 } }));
  stub(t, "review", "findMany", async (a) => {
    args.reviews = a;
    return [
      { id: "r1", rating: 5, review: "Great", createdAt, student: { user: { name: "Ravi", avatar: null } } },
    ];
  });

  const info = await courseService.getCourseMarketingInfo("c1");

  // Only a published, non-private course is shown; counts are published-only.
  assert.deepStrictEqual(args.course.where, {
    id: "c1",
    status: "PUBLISHED",
    visibility: { not: "PRIVATE" },
  });
  assert.deepStrictEqual(args.course.select._count.select.modules, { where: { isPublished: true } });
  assert.deepStrictEqual(args.course.select._count.select.quizzes, {
    where: { isPublished: true, quizTag: { not: "QUALIFYING" } },
  });
  assert.deepStrictEqual(args.lessons.where, {
    isPublished: true,
    module: { courseId: "c1", isPublished: true },
  });
  // Assignments are reached from all six levels.
  assert.strictEqual(args.assignments.where.isPublished, true);
  assert.strictEqual(args.assignments.where.OR.length, 6);
  assert.strictEqual(args.reviews.take, 10);
  assert.deepStrictEqual(args.reviews.orderBy, { createdAt: "desc" });

  assert.deepStrictEqual(info, {
    courseId: "c1",
    courseName: "Python Basics",
    instructorName: "Asha",
    courseOverview: "Learn Python",
    thumbnailUrl: "https://cdn/x.png",
    level: "Beginner",
    category: "Programming",
    language: "English",
    durationHours: 12.5,
    certificateAvailable: true,
    totalModules: 4,
    totalLessons: 18,
    studentsEnrolled: 120,
    avgRating: 4.4,
    totalReviews: 3,
    interactiveQuizzes: 6,
    assignedWorksheets: 5,
    studentReviews: [
      { reviewId: "r1", rating: 5, comment: "Great", studentName: "Ravi", studentAvatar: null, createdAt },
    ],
  });
});

test("getCourseMarketingInfo returns null when the course is not public", async (t) => {
  stub(t, "course", "findFirst", async () => null);
  stub(t, "lesson", "count", async () => 0);
  stub(t, "assignment", "count", async () => 0);
  stub(t, "review", "aggregate", async () => ({ _avg: { rating: null }, _count: { _all: 0 } }));
  stub(t, "review", "findMany", async () => []);

  assert.strictEqual(await courseService.getCourseMarketingInfo("draft"), null);
});
