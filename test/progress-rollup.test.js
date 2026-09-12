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
    await prisma.quizProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.assignmentProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
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
    await prisma.quizProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
    await prisma.assignmentProgress.deleteMany({ where: { studentId: studentProfileId } }).catch(() => {});
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

  await t.test("1. Initial state: 0% progress across immediate children", async () => {
    const rollup = await recomputeCourseProgress(studentProfileId, courseId);
    assert.strictEqual(rollup.totalItems, 4, "Course immediate-child denominator must be 4 (3 direct items + 1 module)");
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
    assert.strictEqual(rollup.completedItems, 0, "Course completed items remains 0 because Module 1 is incomplete");

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
    assert.strictEqual(rollup.completedItems, 0, "Course completed items remains 0 because Module 1 direct items are incomplete");

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
    assert.strictEqual(rollup.completedItems, 1, "Module 1 is now completed, contributing 1 unit to Course");
    assert.strictEqual(rollup.progressPercent, 25, "1/4 units completed = 25%");

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
    assert.strictEqual(rollup.totalItems, 4);
    assert.strictEqual(rollup.completedItems, 4);
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
    assert.strictEqual(rollup.totalItems, 4, "Course immediate-child denominator remains 4");
    assert.strictEqual(rollup.completedItems, 3, "Module 1 reverted to incomplete, leaving 3 direct items completed");
    assert.strictEqual(rollup.progressPercent, 75, "3/4 units completed = 75%");
    assert.strictEqual(rollup.completed, false, "Course completion must revert to false");

    const tp1 = await prisma.topicProgress.findUnique({
      where: { studentId_topicId: { studentId: studentProfileId, topicId: "top_multi_1" } }
    });
    assert.strictEqual(tp1.completed, false, "Topic 1 must revert to incomplete");
  });

  await t.test("7. INSTRUCTOR ANALYTICS API: Returns read-only course overview and student progress table", async () => {
    const analytics = await progressService.getInstructorCourseProgress(courseId);
    assert.strictEqual(analytics.overview.totalStudents, 1);
    assert.strictEqual(analytics.overview.completedStudents, 0);
    assert.strictEqual(analytics.overview.inProgressStudents, 1);
    assert.strictEqual(analytics.overview.avgProgressPercent, 75);
    assert.strictEqual(analytics.students.length, 1);
    assert.strictEqual(analytics.students[0].progressPercent, 75);
    assert.strictEqual(analytics.students[0].status, "In Progress");
  });

  await t.test("8. VISITED TRACKING: Visited state can exist independently of Completed state across items and containers", async () => {
    // Mark new quiz visited without completing it
    await progressService.markVisited(studentProfileId, { quizId: "qz_top_new" }, true);

    let data = await progressService.getStudentCourseProgress(studentProfileId, courseId);
    const qp = data.hierarchy.modules[0].lessons[0].topics[0].quizzes.find((q) => q.id === "qz_top_new");

    assert.strictEqual(qp.visited, true, "Quiz must be visited");
    assert.strictEqual(qp.completed, false, "Visited quiz without passing submission must remain incomplete");
    assert.strictEqual(data.completedItems, 3);
    assert.strictEqual(data.progressPercent, 75);

    // Explicitly mark all remaining 9 items visited
    for (const cId of ["cnt_crs", "cnt_mod", "cnt_les", "cnt_top"]) {
      await progressService.markVisited(studentProfileId, { contentId: cId }, true);
    }
    for (const qId of ["qz_crs", "qz_mod", "qz_les", "qz_top"]) {
      await progressService.markVisited(studentProfileId, { quizId: qId }, true);
    }
    await progressService.markVisited(studentProfileId, { assignmentId: "asg_crs" }, true);

    data = await progressService.getStudentCourseProgress(studentProfileId, courseId);
    assert.strictEqual(data.visitedItems, 4, "All 4 immediate child units now visited");
    assert.strictEqual(data.visitedPercent, 100);
  });

  await t.test("9. IDEMPOTENCY: Repeated complete and visit operations are idempotent", async () => {
    const res1 = await progressService.markVisited(studentProfileId, { contentId: "cnt_crs" }, true);
    const res2 = await progressService.markVisited(studentProfileId, { contentId: "cnt_crs" }, true);

    assert.strictEqual(res1.visited, true);
    assert.strictEqual(res2.visited, true);

    const comp1 = await progressService.completeContent(studentProfileId, "cnt_crs", true);
    const comp2 = await progressService.completeContent(studentProfileId, "cnt_crs", true);

    assert.strictEqual(comp1.completed, true);
    assert.strictEqual(comp2.completed, true);
  });

  await t.test("10. REALISTIC HIERARCHY CALCULATIONS: Verifies bottom-up rollup and independent hand-calculated expected values", async () => {
    const calcCourseId = "course_realistic_hand_calc";
    const calcStudentId = "sp_hand_calc_student";
    const calcUserId = "user_hand_calc_student";

    await prisma.quizSubmission.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.assignmentSubmission.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.contentProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.quizProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.assignmentProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.topicProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.lessonProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.moduleProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.enrollment.deleteMany({ where: { courseId: calcCourseId } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: calcCourseId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: calcUserId } }).catch(() => {});

    await prisma.user.create({
      data: {
        id: calcUserId,
        email: "hand_calc@test.com",
        name: "Hand Calc Student",
        role: "STUDENT",
        password: "hash",
        studentProfile: { create: { id: calcStudentId } }
      }
    });

    await prisma.course.create({
      data: {
        id: calcCourseId,
        title: "Realistic Hierarchy Course",
        status: "PUBLISHED",
        creatorId: instructorId,
        enrollments: { create: [{ studentId: calcStudentId }] }
      }
    });

    // Course direct items (3 items: 1 content, 1 quiz, 1 assignment)
    await prisma.content.create({ data: { id: "hc_cnt_crs", title: "Course Content", type: "TEXT", order: 1, courseId: calcCourseId } });
    await prisma.quiz.create({ data: { id: "hc_qz_crs", title: "Course Quiz", passingScore: 50, isPublished: true, order: 1, courseId: calcCourseId } });
    await prisma.assignment.create({ data: { id: "hc_asg_crs", title: "Course Assignment", dueDate: new Date(), isPublished: true, courseId: calcCourseId } });

    // Module 1 (2 direct items: 1 content, 1 quiz)
    await prisma.module.create({ data: { id: "hc_mod_1", title: "Module 1", order: 1, isPublished: true, courseId: calcCourseId } });
    await prisma.content.create({ data: { id: "hc_cnt_mod", title: "Module Content", type: "TEXT", order: 1, moduleId: "hc_mod_1" } });
    await prisma.quiz.create({ data: { id: "hc_qz_mod", title: "Module Quiz", passingScore: 50, isPublished: true, order: 1, courseId: calcCourseId, moduleId: "hc_mod_1" } });

    // Lesson 1 (2 direct items: 1 content, 1 quiz)
    await prisma.lesson.create({ data: { id: "hc_les_1", title: "Lesson 1", order: 1, isPublished: true, moduleId: "hc_mod_1" } });
    await prisma.content.create({ data: { id: "hc_cnt_les", title: "Lesson Content", type: "TEXT", order: 1, lessonId: "hc_les_1" } });
    await prisma.quiz.create({ data: { id: "hc_qz_les", title: "Lesson Quiz", passingScore: 50, isPublished: true, order: 1, courseId: calcCourseId, moduleId: "hc_mod_1", lessonId: "hc_les_1" } });

    // Topic 1 (3 items: 1 content, 1 quiz, 1 assignment)
    await prisma.topic.create({ data: { id: "hc_top_1", title: "Topic 1", order: 1, isPublished: true, lessonId: "hc_les_1" } });
    await prisma.content.create({ data: { id: "hc_cnt_top", title: "Topic Content", type: "VIDEO", order: 1, topicId: "hc_top_1" } });
    await prisma.quiz.create({ data: { id: "hc_qz_top", title: "Topic Quiz", passingScore: 50, isPublished: true, order: 1, courseId: calcCourseId, moduleId: "hc_mod_1", lessonId: "hc_les_1", topicId: "hc_top_1" } });
    await prisma.assignment.create({ data: { id: "hc_asg_top", title: "Topic Assignment", dueDate: new Date(), isPublished: true, courseId: calcCourseId, moduleId: "hc_mod_1", lessonId: "hc_les_1", topicId: "hc_top_1" } });

    // Empty Module 2 (must not affect counts)
    await prisma.module.create({ data: { id: "hc_mod_empty", title: "Module Empty", order: 2, isPublished: true, courseId: calcCourseId } });

    // Actions & Student Activity:
    // Course Direct: content visited & completed, quiz visited & not completed, assignment unvisited
    await progressService.markVisited(calcStudentId, { contentId: "hc_cnt_crs" }, true);
    await progressService.completeContent(calcStudentId, "hc_cnt_crs", true);
    await progressService.markVisited(calcStudentId, { quizId: "hc_qz_crs" }, true);

    // Module 1 Direct: content visited & completed, quiz unvisited
    await progressService.markVisited(calcStudentId, { contentId: "hc_cnt_mod" }, true);
    await progressService.completeContent(calcStudentId, "hc_cnt_mod", true);

    // Lesson 1 Direct: content visited & completed, quiz visited & completed
    await progressService.markVisited(calcStudentId, { contentId: "hc_cnt_les" }, true);
    await progressService.completeContent(calcStudentId, "hc_cnt_les", true);
    await progressService.markVisited(calcStudentId, { quizId: "hc_qz_les" }, true);
    await prisma.quizSubmission.create({
      data: { studentId: calcStudentId, quizId: "hc_qz_les", answers: {}, score: 10, totalMarks: 10, percentage: 100, passed: true }
    });

    // Topic 1: all 3 items visited & completed
    await progressService.markVisited(calcStudentId, { contentId: "hc_cnt_top" }, true);
    await progressService.completeContent(calcStudentId, "hc_cnt_top", true);
    await progressService.markVisited(calcStudentId, { quizId: "hc_qz_top" }, true);
    await prisma.quizSubmission.create({
      data: { studentId: calcStudentId, quizId: "hc_qz_top", answers: {}, score: 10, totalMarks: 10, percentage: 100, passed: true }
    });
    await progressService.markVisited(calcStudentId, { assignmentId: "hc_asg_top" }, true);
    await assignmentService.submitAssignment("hc_asg_top", calcStudentId, {});

    // Compute progress with tree
    const data = await progressService.getStudentCourseProgress(calcStudentId, calcCourseId);
    const h = data.hierarchy;

    // INDEPENDENT IMMEDIATE-CHILD HIERARCHY CALCULATIONS VERIFICATION:
    // Course immediate-child denominator: 3 direct items + 1 module = 4 units.
    assert.strictEqual(h.totalItems, 4, "Course total published units must be 4");

    // Course completed units: 1 (hc_cnt_crs) + 0 (Module 1 incomplete) = 1 unit.
    assert.strictEqual(h.completedItems, 1, "Course completed items must be 1");
    assert.strictEqual(h.progressPercent, 25, "Course progress percent must be 25%");
    assert.strictEqual(h.completed, false, "Course must be incomplete");

    // Topic 1: 3 items, 3 completed, 3 visited.
    const top1 = h.modules[0].lessons[0].topics[0];
    assert.strictEqual(top1.totalItems, 3);
    assert.strictEqual(top1.completedItems, 3);
    assert.strictEqual(top1.visitedItems, 3);
    assert.strictEqual(top1.progressPercent, 100);
    assert.strictEqual(top1.visitedPercent, 100);
    assert.strictEqual(top1.completed, true, "Topic 1 must be complete");
    assert.strictEqual(top1.visited, true, "Topic 1 must be visited");

    // Lesson 1: 2 direct + 1 topic = 3 total. 3 completed, 3 visited.
    const les1 = h.modules[0].lessons[0];
    assert.strictEqual(les1.totalItems, 3);
    assert.strictEqual(les1.completedItems, 3);
    assert.strictEqual(les1.visitedItems, 3);
    assert.strictEqual(les1.progressPercent, 100);
    assert.strictEqual(les1.visitedPercent, 100);
    assert.strictEqual(les1.completed, true, "Lesson 1 must be complete");
    assert.strictEqual(les1.visited, true, "Lesson 1 must be visited");

    // Module 1: 2 direct + 1 lesson = 3 total. 1 direct comp + 1 les comp = 2 comp.
    const mod1 = h.modules[0];
    assert.strictEqual(mod1.totalItems, 3);
    assert.strictEqual(mod1.completedItems, 2);
    assert.strictEqual(mod1.progressPercent, 67, "Math.round(2/3 * 100) = 67%");
    assert.strictEqual(mod1.completed, false, "Module 1 must be incomplete");

    // Clean up test data
    await prisma.quizSubmission.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.assignmentSubmission.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.contentProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.quizProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.assignmentProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.topicProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.lessonProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.moduleProgress.deleteMany({ where: { studentId: calcStudentId } }).catch(() => {});
    await prisma.enrollment.deleteMany({ where: { courseId: calcCourseId } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: calcCourseId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: calcUserId } }).catch(() => {});
  });

  await t.test("11. LESSON IMMEDIATE-CHILD PROGRESSION: Incomplete topics at 50% contribute 0 units; progression moves 40% -> 60% -> 80% -> 100%", async () => {
    const regCourseId = "course_lesson_hierarchy_regression";
    const regStudentId = "sp_lesson_reg_student";
    const regUserId = "user_lesson_reg_student";

    await prisma.quizSubmission.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.assignmentSubmission.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.contentProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.quizProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.assignmentProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.topicProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.lessonProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.moduleProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.enrollment.deleteMany({ where: { courseId: regCourseId } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: regCourseId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: regUserId } }).catch(() => {});

    await prisma.user.create({
      data: {
        id: regUserId,
        email: "lesson_reg@test.com",
        name: "Lesson Regression Student",
        role: "STUDENT",
        password: "hash",
        studentProfile: { create: { id: regStudentId } }
      }
    });

    await prisma.course.create({
      data: {
        id: regCourseId,
        title: "Lesson Progression Regression Course",
        status: "PUBLISHED",
        creatorId: instructorId,
        enrollments: { create: [{ studentId: regStudentId }] }
      }
    });

    await prisma.module.create({ data: { id: "reg_mod_1", title: "Module 1", order: 1, isPublished: true, courseId: regCourseId } });
    await prisma.lesson.create({ data: { id: "reg_les_1", title: "Lesson 1", order: 1, isPublished: true, moduleId: "reg_mod_1" } });

    // 2 direct contents + 1 direct quiz
    await prisma.content.create({ data: { id: "reg_cnt_les_1", title: "Match Prep 1", type: "TEXT", order: 1, lessonId: "reg_les_1" } });
    await prisma.content.create({ data: { id: "reg_cnt_les_2", title: "Match Prep 2", type: "TEXT", order: 2, lessonId: "reg_les_1" } });
    await prisma.quiz.create({ data: { id: "reg_qz_les", title: "Match Tactics Quiz", passingScore: 50, isPublished: true, order: 3, courseId: regCourseId, moduleId: "reg_mod_1", lessonId: "reg_les_1" } });

    // Topic 1 (2 items: 1 content + 1 quiz)
    await prisma.topic.create({ data: { id: "reg_top_1", title: "Topic 1", order: 1, isPublished: true, lessonId: "reg_les_1" } });
    await prisma.content.create({ data: { id: "reg_cnt_top_1", title: "Topic 1 Content", type: "VIDEO", order: 1, topicId: "reg_top_1" } });
    await prisma.quiz.create({ data: { id: "reg_qz_top_1", title: "Topic 1 Quiz", passingScore: 50, isPublished: true, order: 2, courseId: regCourseId, moduleId: "reg_mod_1", lessonId: "reg_les_1", topicId: "reg_top_1" } });

    // Topic 2 (1 item: 1 content)
    await prisma.topic.create({ data: { id: "reg_top_2", title: "Topic 2", order: 2, isPublished: true, lessonId: "reg_les_1" } });
    await prisma.content.create({ data: { id: "reg_cnt_top_2", title: "Topic 2 Content", type: "VIDEO", order: 1, topicId: "reg_top_2" } });

    // Step A: Complete 2 direct contents + Topic 1 Content only (Topic 1 = 50%, Topic 2 = 0%)
    await progressService.completeContent(regStudentId, "reg_cnt_les_1", true);
    await progressService.completeContent(regStudentId, "reg_cnt_les_2", true);
    await progressService.completeContent(regStudentId, "reg_cnt_top_1", true);

    let rollup = await recomputeCourseProgress(regStudentId, regCourseId, null, { includeTree: true });
    let lesNode = rollup.hierarchy.modules[0].lessons[0];
    let top1Node = lesNode.topics[0];
    let top2Node = lesNode.topics[1];

    assert.strictEqual(top1Node.progressPercent, 50, "Topic 1 must be at 50%");
    assert.strictEqual(top1Node.completed, false, "Topic 1 must be incomplete");
    assert.strictEqual(top2Node.progressPercent, 0, "Topic 2 must be at 0%");
    assert.strictEqual(top2Node.completed, false, "Topic 2 must be incomplete");

    // Denominator = 2 direct contents + 1 direct quiz + 2 applicable topics = 5 units
    // Completed units = 2 direct contents = 2 units
    assert.strictEqual(lesNode.totalItems, 5, "Lesson denominator must be 5");
    assert.strictEqual(lesNode.completedItems, 2, "Lesson completed items must be 2");
    assert.strictEqual(lesNode.progressPercent, 40, "Lesson progress percent must be exactly 40%");
    assert.strictEqual(lesNode.completed, false, "Lesson completed must be false");

    // Step B: Topic 1 becomes 100% (pass Topic 1 Quiz) -> Lesson = 60% (3/5)
    await prisma.quizSubmission.create({
      data: { studentId: regStudentId, quizId: "reg_qz_top_1", answers: {}, score: 10, totalMarks: 10, percentage: 100, passed: true }
    });

    rollup = await recomputeCourseProgress(regStudentId, regCourseId, null, { includeTree: true });
    lesNode = rollup.hierarchy.modules[0].lessons[0];
    top1Node = lesNode.topics[0];

    assert.strictEqual(top1Node.progressPercent, 100, "Topic 1 must be at 100%");
    assert.strictEqual(top1Node.completed, true, "Topic 1 must be complete");
    assert.strictEqual(lesNode.completedItems, 3, "Lesson completed items must be 3");
    assert.strictEqual(lesNode.progressPercent, 60, "Lesson progress percent must be 60%");
    assert.strictEqual(lesNode.completed, false, "Lesson completed must be false");

    // Step C: Topic 2 becomes 100% (complete Topic 2 Content) -> Lesson = 80% (4/5)
    await progressService.completeContent(regStudentId, "reg_cnt_top_2", true);

    rollup = await recomputeCourseProgress(regStudentId, regCourseId, null, { includeTree: true });
    lesNode = rollup.hierarchy.modules[0].lessons[0];
    top2Node = lesNode.topics[1];

    assert.strictEqual(top2Node.progressPercent, 100, "Topic 2 must be at 100%");
    assert.strictEqual(top2Node.completed, true, "Topic 2 must be complete");
    assert.strictEqual(lesNode.completedItems, 4, "Lesson completed items must be 4");
    assert.strictEqual(lesNode.progressPercent, 80, "Lesson progress percent must be 80%");
    assert.strictEqual(lesNode.completed, false, "Lesson completed must be false");

    // Step D: Lesson Quiz completed (pass Match Tactics Quiz) -> Lesson = 100% (5/5)
    await prisma.quizSubmission.create({
      data: { studentId: regStudentId, quizId: "reg_qz_les", answers: {}, score: 10, totalMarks: 10, percentage: 100, passed: true }
    });

    rollup = await recomputeCourseProgress(regStudentId, regCourseId, null, { includeTree: true });
    lesNode = rollup.hierarchy.modules[0].lessons[0];

    assert.strictEqual(lesNode.completedItems, 5, "Lesson completed items must be 5");
    assert.strictEqual(lesNode.progressPercent, 100, "Lesson progress percent must be 100%");
    assert.strictEqual(lesNode.completed, true, "Lesson completed must be true");

    // Clean up test data
    await prisma.quizSubmission.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.assignmentSubmission.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.contentProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.quizProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.assignmentProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.topicProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.lessonProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.moduleProgress.deleteMany({ where: { studentId: regStudentId } }).catch(() => {});
    await prisma.enrollment.deleteMany({ where: { courseId: regCourseId } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: regCourseId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: regUserId } }).catch(() => {});
  });
});
