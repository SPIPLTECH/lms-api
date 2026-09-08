const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const { recomputeCourseProgress } = require("../src/utils/progressRollup");
const progressService = require("../src/modules/progress/progress.service");
const quizService = require("../src/modules/quizzes/quiz.service");
const assignmentService = require("../src/modules/assignments/assignment.service");

test("Comprehensive Multi-Entity Progress Rollup & Analytics Engine Tests", async (t) => {
  const userId = "user_progress_test_student";
  const studentProfileId = "sp_progress_test_student";
  const instructorId = "user_progress_test_instructor";
  const courseId = "course_multi_entity_progress_test";

  t.before(async () => {
    // Clean up any leftover test data
    await prisma.quizSubmission.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.assignmentSubmission.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.contentProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.topicProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.lessonProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.moduleProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.enrollment.deleteMany({ where: { courseId } }).catch(() => {});
    await prisma.quiz.deleteMany({ where: { courseId } }).catch(() => {});
    await prisma.assignment.deleteMany({ where: { courseId } }).catch(() => {});
    await prisma.content.deleteMany({ where: { id: { in: ["cnt_crs", "cnt_mod", "cnt_les", "cnt_top"] } } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: courseId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userId, instructorId] } } }).catch(() => {});

    // Create student user & profile
    await prisma.user.create({
      data: {
        id: userId,
        email: "multi_progress_student@test.com",
        name: "Multi Progress Student",
        role: "STUDENT",
        password: "hash",
        studentProfile: {
          create: { id: studentProfileId }
        }
      }
    });

    // Create instructor
    await prisma.user.create({
      data: {
        id: instructorId,
        email: "multi_progress_instructor@test.com",
        name: "Multi Progress Instructor",
        role: "INSTRUCTOR",
        password: "hash"
      }
    });

    // Create Course first
    await prisma.course.create({
      data: {
        id: courseId,
        title: "Multi Entity Hierarchy Course",
        status: "PUBLISHED",
        creatorId: instructorId,
        enrollments: {
          create: [{ studentId: studentProfileId }]
        }
      }
    });

    // Direct Course items (exactly one parent: courseId)
    await prisma.content.create({ data: { id: "cnt_crs", title: "Course Content", type: "TEXT", order: 1, courseId } });
    await prisma.quiz.create({ data: { id: "qz_crs", title: "Course Quiz", passingScore: 50, isPublished: true, order: 1, courseId } });
    await prisma.assignment.create({ data: { id: "asg_crs", title: "Course Assignment", dueDate: new Date(), isPublished: true, courseId } });

    // Module 1 (exactly one parent: moduleId)
    await prisma.module.create({
      data: {
        id: "mod_multi_1",
        title: "Module 1",
        order: 1,
        isPublished: true,
        courseId
      }
    });
    await prisma.content.create({ data: { id: "cnt_mod", title: "Module Content", type: "TEXT", order: 1, moduleId: "mod_multi_1" } });
    await prisma.quiz.create({ data: { id: "qz_mod", title: "Module Quiz", passingScore: 50, isPublished: true, order: 1, courseId, moduleId: "mod_multi_1" } });

    // Lesson 1 (exactly one parent: lessonId)
    await prisma.lesson.create({
      data: {
        id: "les_multi_1",
        title: "Lesson 1",
        order: 1,
        isPublished: true,
        moduleId: "mod_multi_1"
      }
    });
    await prisma.content.create({ data: { id: "cnt_les", title: "Lesson Content", type: "TEXT", order: 1, lessonId: "les_multi_1" } });
    await prisma.quiz.create({ data: { id: "qz_les", title: "Lesson Quiz", passingScore: 50, isPublished: true, order: 1, courseId, moduleId: "mod_multi_1", lessonId: "les_multi_1" } });

    // Topic 1 (exactly one parent: topicId)
    await prisma.topic.create({
      data: {
        id: "top_multi_1",
        title: "Topic 1",
        order: 1,
        isPublished: true,
        lessonId: "les_multi_1"
      }
    });
    await prisma.content.create({ data: { id: "cnt_top", title: "Topic Content", type: "VIDEO", order: 1, topicId: "top_multi_1" } });
    await prisma.quiz.create({ data: { id: "qz_top", title: "Topic Quiz", passingScore: 50, isPublished: true, order: 1, courseId, moduleId: "mod_multi_1", lessonId: "les_multi_1", topicId: "top_multi_1" } });

    // Topic 2 (Empty)
    await prisma.topic.create({
      data: {
        id: "top_multi_empty",
        title: "Topic Empty",
        order: 2,
        isPublished: true,
        lessonId: "les_multi_1"
      }
    });
  });

  t.after(async () => {
    await prisma.quizSubmission.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.assignmentSubmission.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.contentProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.topicProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.lessonProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.moduleProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.enrollment.deleteMany({ where: { courseId } }).catch(() => {});
    await prisma.quiz.deleteMany({ where: { courseId } }).catch(() => {});
    await prisma.assignment.deleteMany({ where: { courseId } }).catch(() => {});
    await prisma.content.deleteMany({ where: { id: { in: ["cnt_crs", "cnt_mod", "cnt_les", "cnt_top"] } } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: courseId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userId, instructorId] } } }).catch(() => {});
  });

  await t.test("1. Initial state: 0% progress across all 9 items (4 contents, 4 quizzes, 1 assignment)", async () => {
    const rollup = await recomputeCourseProgress(studentProfileId, courseId);
    assert.strictEqual(rollup.totalItems, 9, "Total published items must be 9");
    assert.strictEqual(rollup.completedItems, 0);
    assert.strictEqual(rollup.progressPercent, 0);
    assert.strictEqual(rollup.completed, false);
  });

  await t.test("2. TOPIC: Completing Content only leaves Topic 1 incomplete; Submitting Quiz (Passed) completes Topic 1", async () => {
    // A. Complete topic content
    await progressService.completeContent(studentProfileId, "cnt_top", true);

    let tp1 = await prisma.topicProgress.findUnique({
      where: { studentId_topicId: { studentId: studentProfileId, topicId: "top_multi_1" } }
    });
    assert.strictEqual(tp1.completed, false, "Topic 1 incomplete because Quiz is pending");

    // B. Fail quiz submission (0% < passingScore 50%) -> should NOT complete quiz
    await prisma.quizSubmission.upsert({
      where: { studentId_quizId: { studentId: studentProfileId, quizId: "qz_top" } },
      create: { studentId: studentProfileId, quizId: "qz_top", answers: {}, score: 0, totalMarks: 10, percentage: 0, passed: false },
      update: { score: 0, totalMarks: 10, percentage: 0, passed: false }
    });
    await recomputeCourseProgress(studentProfileId, courseId);

    tp1 = await prisma.topicProgress.findUnique({
      where: { studentId_topicId: { studentId: studentProfileId, topicId: "top_multi_1" } }
    });
    assert.strictEqual(tp1.completed, false, "Failed quiz must not complete topic");

    // C. Pass quiz submission (100% >= passingScore 50%) -> should complete Topic 1
    await prisma.quizSubmission.upsert({
      where: { studentId_quizId: { studentId: studentProfileId, quizId: "qz_top" } },
      create: { studentId: studentProfileId, quizId: "qz_top", answers: {}, score: 10, totalMarks: 10, percentage: 100, passed: true },
      update: { score: 10, totalMarks: 10, percentage: 100, passed: true }
    });

    const rollup = await recomputeCourseProgress(studentProfileId, courseId);
    assert.strictEqual(rollup.completedItems, 2);

    tp1 = await prisma.topicProgress.findUnique({
      where: { studentId_topicId: { studentId: studentProfileId, topicId: "top_multi_1" } }
    });
    assert.strictEqual(tp1.completed, true, "Topic 1 must now be complete");
  });

  await t.test("3. LESSON: Completing direct Lesson Content + Quiz completes Lesson 1 (empty Topic 2 does not block)", async () => {
    await progressService.completeContent(studentProfileId, "cnt_les", true);
    await prisma.quizSubmission.upsert({
      where: { studentId_quizId: { studentId: studentProfileId, quizId: "qz_les" } },
      create: { studentId: studentProfileId, quizId: "qz_les", answers: {}, score: 10, totalMarks: 10, percentage: 100, passed: true },
      update: { score: 10, totalMarks: 10, percentage: 100, passed: true }
    });

    const rollup = await recomputeCourseProgress(studentProfileId, courseId);
    assert.strictEqual(rollup.completedItems, 4);

    const lp1 = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId: studentProfileId, lessonId: "les_multi_1" } }
    });
    assert.strictEqual(lp1.completed, true, "Lesson 1 must be complete");
  });

  await t.test("4. MODULE: Completing direct Module Content + Quiz completes Module 1", async () => {
    await progressService.completeContent(studentProfileId, "cnt_mod", true);
    await prisma.quizSubmission.upsert({
      where: { studentId_quizId: { studentId: studentProfileId, quizId: "qz_mod" } },
      create: { studentId: studentProfileId, quizId: "qz_mod", answers: {}, score: 10, totalMarks: 10, percentage: 100, passed: true },
      update: { score: 10, totalMarks: 10, percentage: 100, passed: true }
    });

    const rollup = await recomputeCourseProgress(studentProfileId, courseId);
    assert.strictEqual(rollup.completedItems, 6);

    const mp1 = await prisma.moduleProgress.findUnique({
      where: { studentId_moduleId: { studentId: studentProfileId, moduleId: "mod_multi_1" } }
    });
    assert.strictEqual(mp1.completed, true, "Module 1 must be complete");
  });

  await t.test("5. COURSE: Completing Course Content + Quiz + Assignment yields 100% and Course complete", async () => {
    await progressService.completeContent(studentProfileId, "cnt_crs", true);
    await prisma.quizSubmission.upsert({
      where: { studentId_quizId: { studentId: studentProfileId, quizId: "qz_crs" } },
      create: { studentId: studentProfileId, quizId: "qz_crs", answers: {}, score: 10, totalMarks: 10, percentage: 100, passed: true },
      update: { score: 10, totalMarks: 10, percentage: 100, passed: true }
    });
    await assignmentService.submitAssignment("asg_crs", studentProfileId, {});

    const rollup = await recomputeCourseProgress(studentProfileId, courseId);
    assert.strictEqual(rollup.totalItems, 9);
    assert.strictEqual(rollup.completedItems, 9);
    assert.strictEqual(rollup.progressPercent, 100);
    assert.strictEqual(rollup.completed, true);
  });

  await t.test("6. PUBLICATION INVALIDATION: Publishing a new Quiz in Topic 1 immediately invalidates Topic, Lesson, Module, Course completion", async () => {
    await prisma.quiz.create({
      data: {
        id: "qz_top_new",
        title: "New Quiz in Topic 1",
        passingScore: 50,
        isPublished: true,
        topicId: "top_multi_1",
        courseId
      }
    });

    const rollup = await recomputeCourseProgress(studentProfileId, courseId);
    assert.strictEqual(rollup.totalItems, 10, "Total items increases to 10");
    assert.strictEqual(rollup.completedItems, 9);
    assert.strictEqual(rollup.progressPercent, 90);
    assert.strictEqual(rollup.completed, false, "Course completion must revert to false");

    const tp1 = await prisma.topicProgress.findUnique({
      where: { studentId_topicId: { studentId: studentProfileId, topicId: "top_multi_1" } }
    });
    assert.strictEqual(tp1.completed, false, "Topic 1 completion must revert to false");
  });

  await t.test("7. INSTRUCTOR ANALYTICS API: Returns read-only course overview and student progress table", async () => {
    const analytics = await progressService.getInstructorCourseProgress(courseId);
    assert.strictEqual(analytics.overview.totalStudents, 1);
    assert.strictEqual(analytics.overview.completedStudents, 0);
    assert.strictEqual(analytics.overview.inProgressStudents, 1);
    assert.strictEqual(analytics.overview.avgProgressPercent, 90);
    assert.strictEqual(analytics.students.length, 1);
    assert.strictEqual(analytics.students[0].progressPercent, 90);
    assert.strictEqual(analytics.students[0].status, "In Progress");
  });
});
