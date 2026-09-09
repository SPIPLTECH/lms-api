const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const { recomputeCourseProgress } = require("../src/utils/progressRollup");
const progressService = require("../src/modules/progress/progress.service");

/**
 * Covers the Progress API contract the Student frontend consumes:
 *  - empty entities never become 100% complete
 *  - the hierarchical tree exposes direct Content/Quiz/Assignment at all four
 *    levels, from the same applicable-item set the percentages come from
 *  - access control: a student cannot read another student's progress, an
 *    instructor cannot read progress for a course they do not own
 */
test("Progress API contract: hierarchy, empty entities, and access control", async (t) => {
  let instructor;
  let otherInstructor;
  let student;
  let otherStudent;
  let emptyCourse;
  let course;
  let mod;
  let lesson;
  let topic;
  let emptyModule;

  const stamp = Date.now();

  t.before(async () => {
    instructor = await prisma.user.create({
      data: {
        name: "Contract Instructor",
        email: `contract_inst_${stamp}@test.com`,
        password: "hashedpassword",
        role: "INSTRUCTOR"
      }
    });

    otherInstructor = await prisma.user.create({
      data: {
        name: "Contract Other Instructor",
        email: `contract_other_inst_${stamp}@test.com`,
        password: "hashedpassword",
        role: "INSTRUCTOR"
      }
    });

    student = await prisma.user.create({
      data: {
        name: "Contract Student",
        email: `contract_stud_${stamp}@test.com`,
        password: "hashedpassword",
        role: "STUDENT",
        studentProfile: { create: {} }
      },
      include: { studentProfile: true }
    });

    otherStudent = await prisma.user.create({
      data: {
        name: "Contract Other Student",
        email: `contract_other_stud_${stamp}@test.com`,
        password: "hashedpassword",
        role: "STUDENT",
        studentProfile: { create: {} }
      },
      include: { studentProfile: true }
    });

    // A course with no learning items at all, and an enrolled student.
    emptyCourse = await prisma.course.create({
      data: {
        title: "Contract Empty Course",
        status: "PUBLISHED",
        creatorId: instructor.id
      }
    });
    await prisma.enrollment.create({
      data: { studentId: student.studentProfile.id, courseId: emptyCourse.id }
    });

    // A course carrying a direct item at every level of the hierarchy.
    course = await prisma.course.create({
      data: {
        title: "Contract Full Course",
        status: "PUBLISHED",
        creatorId: instructor.id
      }
    });

    mod = await prisma.module.create({
      data: { title: "Contract Module", order: 1, isPublished: true, courseId: course.id }
    });

    // An entirely empty published module must not block course completion.
    emptyModule = await prisma.module.create({
      data: { title: "Contract Empty Module", order: 2, isPublished: true, courseId: course.id }
    });

    lesson = await prisma.lesson.create({
      data: { title: "Contract Lesson", order: 1, isPublished: true, moduleId: mod.id }
    });

    topic = await prisma.topic.create({
      data: { title: "Contract Topic", order: 1, isPublished: true, lessonId: lesson.id }
    });

    // Direct Content at all four levels.
    await prisma.content.createMany({
      data: [
        { id: `ct_crs_${stamp}`, order: 1, type: "TEXT", title: "Course Content", courseId: course.id },
        { id: `ct_mod_${stamp}`, order: 1, type: "TEXT", title: "Module Content", moduleId: mod.id },
        { id: `ct_les_${stamp}`, order: 1, type: "TEXT", title: "Lesson Content", lessonId: lesson.id },
        { id: `ct_top_${stamp}`, order: 1, type: "TEXT", title: "Topic Content", topicId: topic.id }
      ]
    });

    // Direct Quiz at all four levels (Quiz.courseId is required by the schema).
    await prisma.quiz.createMany({
      data: [
        { id: `qz_crs_${stamp}`, title: "Course Quiz", passingScore: 50, isPublished: true, courseId: course.id },
        { id: `qz_mod_${stamp}`, title: "Module Quiz", passingScore: 50, isPublished: true, courseId: course.id, moduleId: mod.id },
        { id: `qz_les_${stamp}`, title: "Lesson Quiz", passingScore: 50, isPublished: true, courseId: course.id, lessonId: lesson.id },
        { id: `qz_top_${stamp}`, title: "Topic Quiz", passingScore: 50, isPublished: true, courseId: course.id, topicId: topic.id }
      ]
    });

    // Direct Assignment at all four levels, plus one unpublished that must be excluded.
    await prisma.assignment.createMany({
      data: [
        { id: `as_crs_${stamp}`, title: "Course Assignment", dueDate: new Date(), isPublished: true, courseId: course.id },
        { id: `as_mod_${stamp}`, title: "Module Assignment", dueDate: new Date(), isPublished: true, moduleId: mod.id },
        { id: `as_les_${stamp}`, title: "Lesson Assignment", dueDate: new Date(), isPublished: true, lessonId: lesson.id },
        { id: `as_top_${stamp}`, title: "Topic Assignment", dueDate: new Date(), isPublished: true, topicId: topic.id },
        { id: `as_top_unpub_${stamp}`, title: "Unpublished Topic Assignment", dueDate: new Date(), isPublished: false, topicId: topic.id }
      ]
    });

    await prisma.enrollment.create({
      data: { studentId: student.studentProfile.id, courseId: course.id }
    });
  });

  t.after(async () => {
    for (const c of [course, emptyCourse]) {
      if (c) await prisma.course.delete({ where: { id: c.id } }).catch(() => {});
    }
    for (const u of [instructor, otherInstructor, student, otherStudent]) {
      if (u) await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    }
  });

  await t.test("1. Empty course does not become complete and reports 0%", async () => {
    const rollup = await recomputeCourseProgress(student.studentProfile.id, emptyCourse.id);
    assert.strictEqual(rollup.totalItems, 0);
    assert.strictEqual(rollup.completedItems, 0);
    assert.strictEqual(rollup.progressPercent, 0);
    assert.strictEqual(rollup.completed, false, "An empty course must never report complete");
  });

  await t.test("2. Hierarchy exposes direct Content + Quiz + Assignment at all four levels", async () => {
    const data = await progressService.getStudentCourseProgress(
      student.studentProfile.id,
      course.id
    );
    const h = data.hierarchy;

    // 3 direct items + 1 applicable module = 4 immediate units.
    assert.strictEqual(data.totalItems, 4, "Course totalItems counts direct items + immediate child modules");

    assert.strictEqual(h.contents.length, 1, "Course direct content");
    assert.strictEqual(h.quizzes.length, 1, "Course direct quiz");
    assert.strictEqual(h.assignments.length, 1, "Course direct assignment");

    const m = h.modules.find((x) => x.id === mod.id);
    assert.strictEqual(m.contents.length, 1, "Module direct content");
    assert.strictEqual(m.quizzes.length, 1, "Module direct quiz");
    assert.strictEqual(m.assignments.length, 1, "Module direct assignment");

    const l = m.lessons.find((x) => x.id === lesson.id);
    assert.strictEqual(l.contents.length, 1, "Lesson direct content");
    assert.strictEqual(l.quizzes.length, 1, "Lesson direct quiz");
    assert.strictEqual(l.assignments.length, 1, "Lesson direct assignment");

    const tp = l.topics.find((x) => x.id === topic.id);
    assert.strictEqual(tp.contents.length, 1, "Topic content");
    assert.strictEqual(tp.quizzes.length, 1, "Topic quiz");
    assert.strictEqual(
      tp.assignments.length,
      1,
      "Topic assignment; the unpublished one must not appear"
    );

    // Item states are present and start uncompleted and unvisited.
    assert.strictEqual(tp.contents[0].completed, false);
    assert.strictEqual(tp.contents[0].visited, false);
    assert.strictEqual(tp.quizzes[0].completed, false);
    assert.strictEqual(tp.quizzes[0].visited, false);
    assert.strictEqual(tp.quizzes[0].attempted, false);
    assert.strictEqual(tp.assignments[0].completed, false);
    assert.strictEqual(tp.assignments[0].visited, false);
    assert.strictEqual(tp.assignments[0].submissionStatus, "NotSubmitted");
  });

  await t.test("3. Empty published module is not applicable and never reports complete", async () => {
    const data = await progressService.getStudentCourseProgress(
      student.studentProfile.id,
      course.id
    );
    const empty = data.hierarchy.modules.find((x) => x.id === emptyModule.id);

    assert.strictEqual(empty.totalItems, 0);
    assert.strictEqual(empty.progressPercent, 0);
    assert.strictEqual(empty.applicable, false, "Empty module is not an applicable child");
    assert.strictEqual(empty.completed, false, "Empty module must never report complete");
  });

  await t.test("4. Aggregate counts roll upward and flat projections match the tree", async () => {
    await progressService.completeContent(student.studentProfile.id, `ct_top_${stamp}`, true);

    const data = await progressService.getStudentCourseProgress(
      student.studentProfile.id,
      course.id
    );
    const h = data.hierarchy;
    const m = h.modules.find((x) => x.id === mod.id);
    const l = m.lessons.find((x) => x.id === lesson.id);
    const tp = l.topics.find((x) => x.id === topic.id);

    assert.strictEqual(tp.completedItems, 1, "Topic counts its own completed content");
    assert.strictEqual(tp.completed, false, "Topic still has an open quiz and assignment");
    assert.strictEqual(l.completedItems, 0, "Lesson completedItems counts completed direct items + completed topics (topic incomplete)");
    assert.strictEqual(m.completedItems, 0, "Module completedItems counts completed direct items + completed lessons (lesson incomplete)");
    assert.strictEqual(data.completedItems, 0, "Course completedItems counts completed direct items + completed modules (module incomplete)");

    assert.deepStrictEqual(
      data.completedContentIds,
      [`ct_top_${stamp}`],
      "Flat projection is course-scoped and matches the tree"
    );
  });

  await t.test("5. Progress is scoped to the requested course only", async () => {
    // The student is enrolled in both courses; the empty course must not leak
    // the other course's completed content into its projections.
    const data = await progressService.getStudentCourseProgress(
      student.studentProfile.id,
      emptyCourse.id
    );
    assert.deepStrictEqual(data.completedContentIds, []);
    assert.deepStrictEqual(data.moduleProgresses, []);
    assert.strictEqual(data.hierarchy.modules.length, 0);
  });

  await t.test("6. A student cannot read another student's progress", async () => {
    // The requesting student is not enrolled in nothing here -- the guard is
    // that access is evaluated for the *target* student's enrollment, and a
    // student may only ever be resolved to their own profile.
    await assert.rejects(
      () =>
        progressService.assertCourseProgressAccess(
          { id: otherStudent.id, role: "STUDENT" },
          otherStudent.studentProfile.id,
          course.id
        ),
      (err) => err.statusCode === 403,
      "Unenrolled student must be refused"
    );

    // The enrolled student is allowed through for their own enrollment.
    await progressService.assertCourseProgressAccess(
      { id: student.id, role: "STUDENT" },
      student.studentProfile.id,
      course.id
    );
  });

  await t.test("7. An instructor cannot read progress for a course they do not own", async () => {
    await assert.rejects(
      () =>
        progressService.assertCourseProgressAccess(
          { id: otherInstructor.id, role: "INSTRUCTOR" },
          student.studentProfile.id,
          course.id
        ),
      (err) => err.statusCode === 403,
      "Non-owning instructor must be refused"
    );

    // The owning instructor and any admin are allowed.
    await progressService.assertCourseProgressAccess(
      { id: instructor.id, role: "INSTRUCTOR" },
      student.studentProfile.id,
      course.id
    );
    await progressService.assertCourseProgressAccess(
      { id: "any-admin", role: "ADMIN" },
      student.studentProfile.id,
      course.id
    );
  });

  await t.test("8. An unenrolled student cannot seed progress by completing content", async () => {
    await assert.rejects(
      () =>
        progressService.completeContent(
          otherStudent.studentProfile.id,
          `ct_top_${stamp}`,
          true,
          { id: otherStudent.id, role: "STUDENT" }
        ),
      (err) => err.statusCode === 403
    );

    const leaked = await prisma.contentProgress.findUnique({
      where: {
        studentId_contentId: {
          studentId: otherStudent.studentProfile.id,
          contentId: `ct_top_${stamp}`
        }
      }
    });
    assert.strictEqual(leaked, null, "No progress row may be written for a refused request");
  });
});
