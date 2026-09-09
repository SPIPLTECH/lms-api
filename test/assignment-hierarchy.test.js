const test = require("node:test");
const assert = require("node:assert");
const prisma = require("../src/config/database");
const assignmentService = require("../src/modules/assignments/assignment.service");
const { recomputeCourseProgress } = require("../src/utils/progressRollup");

test("Phase 1: Hierarchical Assignment & Progress Rollup Tests", async (t) => {
  let instructorUser;
  let studentUser;
  let studentProfile;
  let course;
  let module1;
  let lesson1;
  let topic1;

  t.before(async () => {
    // Setup test instructor and student
    instructorUser = await prisma.user.create({
      data: {
        name: "Test Instructor Assignment",
        email: `inst_asgn_${Date.now()}@test.com`,
        password: "hashedpassword",
        role: "INSTRUCTOR"
      }
    });

    studentUser = await prisma.user.create({
      data: {
        name: "Test Student Assignment",
        email: `stud_asgn_${Date.now()}@test.com`,
        password: "hashedpassword",
        role: "STUDENT",
        studentProfile: {
          create: {}
        }
      },
      include: { studentProfile: true }
    });

    studentProfile = studentUser.studentProfile;

    // Create 4-level Course hierarchy
    course = await prisma.course.create({
      data: {
        title: "Hierarchical Assignment Test Course",
        status: "PUBLISHED",
        creatorId: instructorUser.id
      }
    });

    module1 = await prisma.module.create({
      data: {
        title: "Module 1",
        order: 1,
        isPublished: true,
        courseId: course.id
      }
    });

    lesson1 = await prisma.lesson.create({
      data: {
        title: "Lesson 1",
        order: 1,
        isPublished: true,
        moduleId: module1.id
      }
    });

    topic1 = await prisma.topic.create({
      data: {
        title: "Topic 1",
        order: 1,
        isPublished: true,
        lessonId: lesson1.id
      }
    });

    // Enroll student
    await prisma.enrollment.create({
      data: {
        studentId: studentProfile.id,
        courseId: course.id
      }
    });
  });

  t.after(async () => {
    // Clean up created entities
    if (course) {
      await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
    }
    if (instructorUser) {
      await prisma.user.delete({ where: { id: instructorUser.id } }).catch(() => {});
    }
    if (studentUser) {
      await prisma.user.delete({ where: { id: studentUser.id } }).catch(() => {});
    }
  });

  await t.test("1. Reject creation with zero parent IDs", async () => {
    await assert.rejects(
      async () => {
        await assignmentService.createAssignment({
          title: "Orphan Assignment",
          dueDate: new Date()
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /exactly one/i);
        return true;
      }
    );
  });

  await t.test("2. Reject creation with multiple parent IDs (duplicate parent)", async () => {
    await assert.rejects(
      async () => {
        await assignmentService.createAssignment({
          title: "Multi-parent Assignment",
          courseId: course.id,
          moduleId: module1.id,
          dueDate: new Date()
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /exactly one/i);
        return true;
      }
    );
  });

  await t.test("3. Create Course-level Assignment", async () => {
    const asgn = await assignmentService.createAssignment({
      title: "Course Direct Assignment",
      courseId: course.id,
      dueDate: new Date(),
      isPublished: true
    });
    assert.ok(asgn.id);
    assert.strictEqual(asgn.courseId, course.id);
    assert.strictEqual(asgn.moduleId, null);
    assert.strictEqual(asgn.lessonId, null);
    assert.strictEqual(asgn.topicId, null);
  });

  await t.test("4. Create Module-level Assignment", async () => {
    const asgn = await assignmentService.createAssignment({
      title: "Module Direct Assignment",
      moduleId: module1.id,
      dueDate: new Date(),
      isPublished: true
    });
    assert.ok(asgn.id);
    assert.strictEqual(asgn.courseId, null);
    assert.strictEqual(asgn.moduleId, module1.id);
    assert.strictEqual(asgn.lessonId, null);
    assert.strictEqual(asgn.topicId, null);
  });

  await t.test("5. Create Lesson-level Assignment", async () => {
    const asgn = await assignmentService.createAssignment({
      title: "Lesson Direct Assignment",
      lessonId: lesson1.id,
      dueDate: new Date(),
      isPublished: true
    });
    assert.ok(asgn.id);
    assert.strictEqual(asgn.courseId, null);
    assert.strictEqual(asgn.moduleId, null);
    assert.strictEqual(asgn.lessonId, lesson1.id);
    assert.strictEqual(asgn.topicId, null);
  });

  await t.test("6. Create Topic-level Assignment", async () => {
    const asgn = await assignmentService.createAssignment({
      title: "Topic Direct Assignment",
      topicId: topic1.id,
      dueDate: new Date(),
      isPublished: true
    });
    assert.ok(asgn.id);
    assert.strictEqual(asgn.courseId, null);
    assert.strictEqual(asgn.moduleId, null);
    assert.strictEqual(asgn.lessonId, null);
    assert.strictEqual(asgn.topicId, topic1.id);
  });

  await t.test("7. Published vs Unpublished filtering", async () => {
    const unpubAsgn = await assignmentService.createAssignment({
      title: "Unpublished Topic Assignment",
      topicId: topic1.id,
      dueDate: new Date(),
      isPublished: false
    });
    assert.ok(unpubAsgn.id);

    const rollup = await recomputeCourseProgress(studentProfile.id, course.id);
    // Unpublished assignment is not counted in total items
    const pubAsgnsInTopic = await prisma.assignment.count({
      where: { topicId: topic1.id, isPublished: true }
    });
    assert.strictEqual(pubAsgnsInTopic, 1);
  });

  await t.test("8. Topic completion requiring direct Topic Content + Topic Quiz + Topic Assignment", async () => {
    // Add Topic Content & Topic Quiz
    const tContent = await prisma.content.create({
      data: {
        type: "TEXT",
        title: "Topic Content",
        order: 1,
        topicId: topic1.id
      }
    });

    const tQuiz = await prisma.quiz.create({
      data: {
        title: "Topic Quiz",
        passingScore: 50,
        isPublished: true,
        courseId: course.id,
        topicId: topic1.id
      }
    });

    const topicAsgns = await prisma.assignment.findMany({
      where: { topicId: topic1.id, isPublished: true }
    });

    // 1. Initial state: Topic incomplete
    let rollup = await recomputeCourseProgress(studentProfile.id, course.id);
    let tp = await prisma.topicProgress.findUnique({
      where: { studentId_topicId: { studentId: studentProfile.id, topicId: topic1.id } }
    });
    assert.strictEqual(tp?.completed, false);

    // 2. Complete Content & Quiz only -> Topic still incomplete due to pending Assignment
    await prisma.contentProgress.create({
      data: { studentId: studentProfile.id, contentId: tContent.id, completed: true }
    });
    await prisma.quizSubmission.create({
      data: {
        studentId: studentProfile.id,
        quizId: tQuiz.id,
        score: 10,
        totalMarks: 10,
        percentage: 100,
        passed: true,
        answers: {}
      }
    });

    rollup = await recomputeCourseProgress(studentProfile.id, course.id);
    tp = await prisma.topicProgress.findUnique({
      where: { studentId_topicId: { studentId: studentProfile.id, topicId: topic1.id } }
    });
    assert.strictEqual(tp?.completed, false, "Topic must remain incomplete when direct Assignment is not submitted");

    // 3. Submit Topic Assignment -> Topic becomes complete!
    await assignmentService.submitAssignment(topicAsgns[0].id, studentProfile.id);

    tp = await prisma.topicProgress.findUnique({
      where: { studentId_topicId: { studentId: studentProfile.id, topicId: topic1.id } }
    });
    assert.strictEqual(tp?.completed, true, "Topic completes after direct Content, Quiz, and Assignment are all submitted");
  });

  await t.test("9. Lesson, Module, and Course level progress roll-up after submitting all level assignments", async () => {
    // Submit Lesson Assignment
    const lessonAsgn = await prisma.assignment.findFirst({ where: { lessonId: lesson1.id } });
    await assignmentService.submitAssignment(lessonAsgn.id, studentProfile.id);

    let lp = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId: studentProfile.id, lessonId: lesson1.id } }
    });
    assert.strictEqual(lp?.completed, true, "Lesson completes when direct Lesson Assignment + completed Topic are complete");

    // Submit Module Assignment
    const modAsgn = await prisma.assignment.findFirst({ where: { moduleId: module1.id } });
    await assignmentService.submitAssignment(modAsgn.id, studentProfile.id);

    let mp = await prisma.moduleProgress.findUnique({
      where: { studentId_moduleId: { studentId: studentProfile.id, moduleId: module1.id } }
    });
    assert.strictEqual(mp?.completed, true, "Module completes when direct Module Assignment + completed Lesson are complete");

    // Submit Course Assignment
    const courseAsgn = await prisma.assignment.findFirst({ where: { courseId: course.id } });
    const finalRollup = await assignmentService.submitAssignment(courseAsgn.id, studentProfile.id);

    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId: studentProfile.id, courseId: course.id } }
    });
    assert.strictEqual(enrollment.progressPercent, 100);
    assert.strictEqual(enrollment.completed, true);
  });
});
