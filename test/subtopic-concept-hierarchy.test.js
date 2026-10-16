const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const { recomputeCourseProgress } = require("../src/utils/progressRollup");
const progressService = require("../src/modules/progress/progress.service");
const subTopicService = require("../src/modules/subTopic/subTopic.service");
const conceptService = require("../src/modules/concept/concept.service");
const topicService = require("../src/modules/topics/topic.service");

/**
 * SubTopic + Concept hierarchy.
 *
 * Covers the three shapes that have to coexist:
 *   A. OLD    Topic -> CQA                        (no SubTopic/Concept at all)
 *   B. NEW    Topic -> SubTopic -> Concept -> CQA
 *   C. MIXED  one Topic carrying BOTH its own CQA and a SubTopic subtree
 *
 * The mixed case is where double-counting would show up, so item totals are
 * hand-calculated in the assertions rather than derived from the code.
 */
test("SubTopic + Concept hierarchy", async (t) => {
  const userId = "user_stc_student";
  const studentId = "sp_stc_student";
  const instructorId = "user_stc_instructor";
  const outsiderUserId = "user_stc_outsider";
  const outsiderStudentId = "sp_stc_outsider";
  const courseId = "course_subtopic_concept";

  const students = [studentId, outsiderStudentId];

  const cleanup = async () => {
    const quizzes = await prisma.quiz
      .findMany({ where: { courseId }, select: { id: true } })
      .catch(() => []);
    const quizIds = quizzes.map((q) => q.id);
    await prisma.quizQuestion.deleteMany({ where: { quizId: { in: quizIds } } }).catch(() => {});
    await prisma.quizSubmission.deleteMany({ where: { studentId: { in: students } } }).catch(() => {});
    await prisma.assignmentSubmission.deleteMany({ where: { studentId: { in: students } } }).catch(() => {});
    for (const table of [
      "contentProgress",
      "quizProgress",
      "assignmentProgress",
      "conceptProgress",
      "subTopicProgress",
      "topicProgress",
      "lessonProgress",
      "moduleProgress",
    ]) {
      await prisma[table].deleteMany({ where: { studentId: { in: students } } }).catch(() => {});
    }
    await prisma.enrollment
      .deleteMany({ where: { OR: [{ courseId }, { studentId: { in: students } }] } })
      .catch(() => {});
    await prisma.course.deleteMany({ where: { id: courseId } }).catch(() => {});
    await prisma.studentProfile.deleteMany({ where: { id: { in: students } } }).catch(() => {});
    await prisma.user
      .deleteMany({ where: { id: { in: [userId, instructorId, outsiderUserId] } } })
      .catch(() => {});
  };

  // Ids for everything the fixture builds, so assertions can name them.
  const ids = {
    module: "stc_module",
    lesson: "stc_lesson",
    topicNew: "stc_topic_new", // B/C: has own CQA AND a SubTopic
    topicOld: "stc_topic_old", // A: legacy shape, CQA only
    subTopic: "stc_subtopic",
    concept: "stc_concept",
  };

  t.before(async () => {
    await cleanup();

    await prisma.user.createMany({
      data: [
        { id: instructorId, email: "stc_instructor@test.com", name: "STC Instructor", role: "INSTRUCTOR", password: "hash" },
        { id: userId, email: "stc_student@test.com", name: "STC Student", role: "STUDENT", password: "hash" },
        { id: outsiderUserId, email: "stc_outsider@test.com", name: "STC Outsider", role: "STUDENT", password: "hash" },
      ],
    });
    await prisma.studentProfile.createMany({
      data: [
        { id: studentId, userId },
        { id: outsiderStudentId, userId: outsiderUserId },
      ],
    });

    await prisma.course.create({
      data: { id: courseId, title: "SubTopic Concept Course", status: "PUBLISHED", creatorId: instructorId },
    });
    await prisma.enrollment.create({ data: { courseId, studentId } });

    await prisma.module.create({
      data: { id: ids.module, title: "M1", order: 1, isPublished: true, courseId },
    });
    await prisma.lesson.create({
      data: { id: ids.lesson, title: "L1", order: 1, isPublished: true, moduleId: ids.module },
    });
    await prisma.topic.createMany({
      data: [
        { id: ids.topicNew, title: "T-new", order: 1, isPublished: true, lessonId: ids.lesson },
        { id: ids.topicOld, title: "T-old", order: 2, isPublished: true, lessonId: ids.lesson },
      ],
    });
    await prisma.subTopic.create({
      data: { id: ids.subTopic, title: "ST1", order: 1, isPublished: true, topicId: ids.topicNew },
    });
    await prisma.concept.create({
      data: { id: ids.concept, title: "C1", order: 1, isPublished: true, subTopicId: ids.subTopic },
    });

    // One Content at every one of the six levels.
    await prisma.content.createMany({
      data: [
        { id: "stc_cnt_course", order: 1, courseId, type: "TEXT", title: "course content" },
        { id: "stc_cnt_module", order: 1, moduleId: ids.module, type: "TEXT", title: "module content" },
        { id: "stc_cnt_lesson", order: 1, lessonId: ids.lesson, type: "TEXT", title: "lesson content" },
        { id: "stc_cnt_topic", order: 1, topicId: ids.topicNew, type: "TEXT", title: "topic content" },
        { id: "stc_cnt_topic_old", order: 1, topicId: ids.topicOld, type: "TEXT", title: "old topic content" },
        { id: "stc_cnt_subtopic", order: 1, subTopicId: ids.subTopic, type: "TEXT", title: "subtopic content" },
        { id: "stc_cnt_concept", order: 1, conceptId: ids.concept, type: "TEXT", title: "concept content" },
      ],
    });

    // Quiz + Assignment on the two NEW levels, proving CQA works there.
    await prisma.quiz.createMany({
      data: [
        { id: "stc_quiz_subtopic", title: "ST quiz", order: 2, passingScore: 50, isPublished: true, courseId, subTopicId: ids.subTopic },
        { id: "stc_quiz_concept", title: "C quiz", order: 2, passingScore: 50, isPublished: true, courseId, conceptId: ids.concept },
      ],
    });
    await prisma.assignment.createMany({
      data: [
        { id: "stc_asg_subtopic", title: "ST asg", order: 3, dueDate: new Date("2030-01-01"), isPublished: true, courseId, subTopicId: ids.subTopic },
        { id: "stc_asg_concept", title: "C asg", order: 3, dueDate: new Date("2030-01-01"), isPublished: true, courseId, conceptId: ids.concept },
      ],
    });
  });

  t.after(cleanup);

  const tree = async () => {
    const r = await recomputeCourseProgress(studentId, courseId, null, {
      includeTree: true,
      persist: false,
    });
    const mod = r.hierarchy.modules[0];
    const lesson = mod.lessons[0];
    const topicNew = lesson.topics.find((x) => x.id === ids.topicNew);
    const topicOld = lesson.topics.find((x) => x.id === ids.topicOld);
    const subTopic = topicNew.subTopics[0];
    const concept = subTopic.concepts[0];
    return { r, mod, lesson, topicNew, topicOld, subTopic, concept };
  };

  await t.test("B. The tree nests SubTopic under Topic and Concept under SubTopic", async () => {
    const { topicNew, subTopic, concept } = await tree();

    assert.ok(Array.isArray(topicNew.subTopics), "topic exposes subTopics");
    assert.strictEqual(subTopic.id, ids.subTopic);
    assert.ok(Array.isArray(subTopic.concepts), "subtopic exposes concepts");
    assert.strictEqual(concept.id, ids.concept);
  });

  await t.test("B. CQA is carried at SubTopic and Concept level", async () => {
    const { subTopic, concept } = await tree();

    assert.deepStrictEqual(subTopic.contents.map((c) => c.id), ["stc_cnt_subtopic"]);
    assert.deepStrictEqual(subTopic.quizzes.map((q) => q.id), ["stc_quiz_subtopic"]);
    assert.deepStrictEqual(subTopic.assignments.map((a) => a.id), ["stc_asg_subtopic"]);

    assert.deepStrictEqual(concept.contents.map((c) => c.id), ["stc_cnt_concept"]);
    assert.deepStrictEqual(concept.quizzes.map((q) => q.id), ["stc_quiz_concept"]);
    assert.deepStrictEqual(concept.assignments.map((a) => a.id), ["stc_asg_concept"]);
  });

  await t.test("C. Concept/SubTopic items are NOT counted as Topic-direct items", async () => {
    const { topicNew } = await tree();

    // The topic owns exactly its OWN single content row, never the subtopic's
    // or the concept's. This is the double-counting guard.
    assert.deepStrictEqual(topicNew.contents.map((c) => c.id), ["stc_cnt_topic"]);
    assert.strictEqual(topicNew.quizzes.length, 0, "subtopic quiz must not appear on the topic");
    assert.strictEqual(topicNew.assignments.length, 0, "subtopic assignment must not appear on the topic");

    // Topic denominator = 1 own content + 1 applicable SubTopic = 2.
    assert.strictEqual(topicNew.directTotalItems, 1, "topic direct items");
    assert.strictEqual(topicNew.totalItems, 2, "topic total = own items + applicable subtopics");
  });

  await t.test("C. Every item appears exactly once across the whole tree", async () => {
    const { r } = await tree();
    const seen = [];
    const walk = (node) => {
      (node.contents || []).forEach((c) => seen.push(c.id));
      (node.quizzes || []).forEach((q) => seen.push(q.id));
      (node.assignments || []).forEach((a) => seen.push(a.id));
      for (const key of ["modules", "lessons", "topics", "subTopics", "concepts"]) {
        (node[key] || []).forEach(walk);
      }
    };
    walk(r.hierarchy);

    const dupes = seen.filter((id, i) => seen.indexOf(id) !== i);
    assert.deepStrictEqual(dupes, [], "no item may be counted twice, duplicates found: " + dupes);
    // 7 contents + 2 quizzes + 2 assignments
    assert.strictEqual(seen.length, 11, "every fixture item is present exactly once");
  });

  await t.test("A. A Topic with no SubTopics behaves exactly as before", async () => {
    const { topicOld } = await tree();

    assert.deepStrictEqual(topicOld.subTopics, [], "legacy topic has an empty subTopics array");
    assert.strictEqual(topicOld.directTotalItems, 1);
    // No children, so total === direct: identical to four-level behaviour.
    assert.strictEqual(topicOld.totalItems, 1);
    assert.strictEqual(topicOld.applicable, true);
    assert.strictEqual(topicOld.completed, false);
  });

  await t.test("B. Progress rolls Content -> Concept -> SubTopic -> Topic", async () => {
    // Concept needs all three of its own items before it completes.
    await progressService.completeContent(studentId, "stc_cnt_concept", true);
    let s = await tree();
    assert.strictEqual(s.concept.completed, false, "concept still has an open quiz and assignment");

    await prisma.quizProgress.upsert({
      where: { studentId_quizId: { studentId, quizId: "stc_quiz_concept" } },
      create: { studentId, quizId: "stc_quiz_concept", completed: true, completedAt: new Date() },
      update: { completed: true },
    });
    await prisma.assignmentProgress.upsert({
      where: { studentId_assignmentId: { studentId, assignmentId: "stc_asg_concept" } },
      create: { studentId, assignmentId: "stc_asg_concept", completed: true, completedAt: new Date() },
      update: { completed: true },
    });

    s = await tree();
    assert.strictEqual(s.concept.completed, true, "concept completes once all its own CQA is done");
    assert.strictEqual(s.concept.progressPercent, 100);

    // SubTopic denominator = 3 own items + 1 applicable concept = 4, and the
    // completed concept contributes exactly ONE unit.
    assert.strictEqual(s.subTopic.totalItems, 4);
    assert.strictEqual(s.subTopic.completedItems, 1, "only the concept unit so far");
    assert.strictEqual(s.subTopic.completed, false, "subtopic still has its own CQA open");

    // Topic must not complete while the subtopic below it is incomplete.
    assert.strictEqual(s.topicNew.completed, false);
  });

  await t.test("B. Completing SubTopic CQA completes SubTopic, then Topic", async () => {
    await progressService.completeContent(studentId, "stc_cnt_subtopic", true);
    await prisma.quizProgress.upsert({
      where: { studentId_quizId: { studentId, quizId: "stc_quiz_subtopic" } },
      create: { studentId, quizId: "stc_quiz_subtopic", completed: true, completedAt: new Date() },
      update: { completed: true },
    });
    await prisma.assignmentProgress.upsert({
      where: { studentId_assignmentId: { studentId, assignmentId: "stc_asg_subtopic" } },
      create: { studentId, assignmentId: "stc_asg_subtopic", completed: true, completedAt: new Date() },
      update: { completed: true },
    });

    let s = await tree();
    assert.strictEqual(s.subTopic.completed, true, "subtopic completes: own CQA plus its concept");
    assert.strictEqual(s.subTopic.completedItems, 4);
    assert.strictEqual(s.topicNew.completed, false, "topic still owns one incomplete content");

    await progressService.completeContent(studentId, "stc_cnt_topic", true);
    s = await tree();
    assert.strictEqual(s.topicNew.completed, true, "topic completes: own content plus its subtopic");
    assert.strictEqual(s.topicNew.completedItems, 2);
    assert.strictEqual(s.topicNew.progressPercent, 100);
  });

  await t.test("B. Container progress rows are persisted for the new levels", async () => {
    await recomputeCourseProgress(studentId, courseId, null, { includeTree: true });

    const cp = await prisma.conceptProgress.findUnique({
      where: { studentId_conceptId: { studentId, conceptId: ids.concept } },
    });
    const sp = await prisma.subTopicProgress.findUnique({
      where: { studentId_subTopicId: { studentId, subTopicId: ids.subTopic } },
    });

    assert.ok(cp, "ConceptProgress row written");
    assert.strictEqual(cp.completed, true);
    assert.ok(cp.completedAt, "completedAt stamped");
    assert.ok(sp, "SubTopicProgress row written");
    assert.strictEqual(sp.completed, true);
  });

  await t.test("B. Course reaches 100% only when every level is complete", async () => {
    let s = await tree();
    assert.strictEqual(s.r.completed, false, "old topic and higher-level content still open");

    await progressService.completeContent(
      studentId,
      ["stc_cnt_topic_old", "stc_cnt_lesson", "stc_cnt_module", "stc_cnt_course"],
      true
    );

    s = await tree();
    assert.strictEqual(s.topicOld.completed, true);
    assert.strictEqual(s.lesson.completed, true);
    assert.strictEqual(s.mod.completed, true);
    assert.strictEqual(s.r.completed, true, "course complete");
    assert.strictEqual(s.r.progressPercent, 100);
  });

  await t.test("Flat projections expose the new levels without dropping the old fields", async () => {
    const flat = await progressService.getStudentCourseProgress(studentId, courseId);

    // Pre-existing fields still present and still meaning the same thing.
    assert.ok(Array.isArray(flat.topicProgresses));
    assert.ok(Array.isArray(flat.completedContentIds));
    assert.ok(flat.topicProgresses.includes(ids.topicNew));

    // New, additive fields.
    assert.ok(flat.subTopicProgresses.includes(ids.subTopic), "completed subtopic is projected");
    assert.ok(flat.conceptProgresses.includes(ids.concept), "completed concept is projected");
    assert.ok(Array.isArray(flat.visitedSubTopicProgresses));
    assert.ok(Array.isArray(flat.visitedConceptProgresses));
  });

  await t.test("markVisited accepts SUBTOPIC and CONCEPT", async () => {
    const st = await progressService.markVisited(studentId, { subTopicId: ids.subTopic }, true);
    assert.strictEqual(st.entityType, "SUBTOPIC");
    assert.strictEqual(st.entityId, ids.subTopic);

    const cn = await progressService.markVisited(studentId, { conceptId: ids.concept }, true);
    assert.strictEqual(cn.entityType, "CONCEPT");

    const row = await prisma.conceptProgress.findUnique({
      where: { studentId_conceptId: { studentId, conceptId: ids.concept } },
    });
    assert.strictEqual(row.visited, true);
  });

  await t.test("Concept-level content resolves its course, so access is ENFORCED not skipped", async () => {
    // The coalescing chains this replaced all stopped at `topic`, so a concept
    // item would have resolved to undefined -- and every caller guards with
    // `if (courseId)`, meaning the check would have been silently SKIPPED.
    await assert.rejects(
      () =>
        progressService.completeContent(outsiderStudentId, "stc_cnt_concept", true, {
          id: outsiderUserId,
          role: "STUDENT",
        }),
      (err) => err.statusCode === 403,
      "an unenrolled student must be rejected for concept-level content"
    );

    const leaked = await prisma.contentProgress.findUnique({
      where: { studentId_contentId: { studentId: outsiderStudentId, contentId: "stc_cnt_concept" } },
    });
    assert.strictEqual(leaked, null, "no progress row may be seeded for an unenrolled student");
  });

  await t.test("SubTopic/Concept services: create, list, reorder, get-by-id", async () => {
    const created = await subTopicService.createSubTopic({ title: "ST2", topicId: ids.topicNew });
    assert.strictEqual(created.order, 2, "order auto-increments within the topic");
    assert.strictEqual(created.isPublished, true, "inherits published state of a PUBLISHED course");

    const c2 = await conceptService.createConcept({ title: "C2", subTopicId: ids.subTopic });
    // One common sequence per parent: C2 lands one past the SubTopic's last
    // item of ANY type (content 1, quiz 2, assignment 3), not after C1 alone.
    assert.strictEqual(c2.order, 4);

    const list = await subTopicService.getSubTopics(ids.topicNew, "INSTRUCTOR", instructorId);
    assert.deepStrictEqual(list.map((s) => s.title), ["ST1", "ST2"]);

    await subTopicService.reorderSubTopics(ids.topicNew, [
      { id: created.id, order: 1 },
      { id: ids.subTopic, order: 2 },
    ]);
    const reordered = await subTopicService.getSubTopics(ids.topicNew, "INSTRUCTOR", instructorId);
    assert.deepStrictEqual(reordered.map((s) => s.title), ["ST2", "ST1"]);

    const fetched = await subTopicService.getSubTopicById(ids.subTopic);
    assert.strictEqual(fetched.concepts.length, 2);

    // Restore original ordering, then drop the scratch rows.
    await subTopicService.reorderSubTopics(ids.topicNew, [
      { id: ids.subTopic, order: 1 },
      { id: created.id, order: 2 },
    ]);
    await conceptService.deleteConcept(c2.id);
    await subTopicService.deleteSubTopic(created.id);
  });

  await t.test("Students only see published SubTopics and Concepts", async () => {
    const draft = await subTopicService.createSubTopic({
      title: "draft st",
      topicId: ids.topicNew,
      isPublished: false,
    });

    const asStudent = await subTopicService.getSubTopics(ids.topicNew, "STUDENT", userId);
    assert.ok(!asStudent.some((s) => s.id === draft.id), "draft subtopic hidden from students");

    const asInstructor = await subTopicService.getSubTopics(ids.topicNew, "INSTRUCTOR", instructorId);
    assert.ok(asInstructor.some((s) => s.id === draft.id), "instructor still sees the draft");

    await subTopicService.deleteSubTopic(draft.id);
  });

  await t.test("Deleting a SubTopic removes its Concepts, their Content and their Quizzes", async () => {
    const st = await subTopicService.createSubTopic({ title: "doomed", topicId: ids.topicOld });
    const cn = await conceptService.createConcept({ title: "doomed concept", subTopicId: st.id });
    await prisma.content.create({
      data: { id: "stc_cnt_doomed", order: 1, conceptId: cn.id, type: "TEXT" },
    });
    const quiz = await prisma.quiz.create({
      data: { title: "doomed quiz", order: 2, passingScore: 50, courseId, conceptId: cn.id },
    });

    await subTopicService.deleteSubTopic(st.id);

    assert.strictEqual(await prisma.subTopic.findUnique({ where: { id: st.id } }), null);
    assert.strictEqual(await prisma.concept.findUnique({ where: { id: cn.id } }), null);
    assert.strictEqual(await prisma.content.findUnique({ where: { id: "stc_cnt_doomed" } }), null);
    assert.strictEqual(
      await prisma.quiz.findUnique({ where: { id: quiz.id } }),
      null,
      "concept quiz must not be orphaned"
    );
  });

  await t.test("Deleting a Topic removes the whole SubTopic/Concept subtree", async () => {
    const st = await subTopicService.createSubTopic({ title: "sub", topicId: ids.topicOld });
    const cn = await conceptService.createConcept({ title: "con", subTopicId: st.id });

    await topicService.deleteTopic(ids.topicOld);

    assert.strictEqual(await prisma.topic.findUnique({ where: { id: ids.topicOld } }), null);
    assert.strictEqual(await prisma.subTopic.findUnique({ where: { id: st.id } }), null);
    assert.strictEqual(await prisma.concept.findUnique({ where: { id: cn.id } }), null);
  });
});

/**
 * course.service integration: the four places that had to learn about the new
 * levels or silently lose data / block publishing.
 */
test("Course service understands SubTopic and Concept", async (t) => {
  const instructorId = "user_stc2_instructor";
  const courseId = "course_stc2";

  const cleanup = async () => {
    const dupes = await prisma.course
      .findMany({ where: { creatorId: instructorId }, select: { id: true } })
      .catch(() => []);
    for (const c of dupes) {
      await prisma.course.delete({ where: { id: c.id } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: instructorId } }).catch(() => {});
  };

  t.before(async () => {
    await cleanup();
    await prisma.user.create({
      data: { id: instructorId, email: "stc2@test.com", name: "STC2", role: "INSTRUCTOR", password: "hash" },
    });
    await prisma.course.create({
      data: { id: courseId, title: "STC2 Course", description: "desc", status: "DRAFT", creatorId: instructorId },
    });
    await prisma.module.create({ data: { id: "stc2_m", title: "M", order: 1, courseId } });
    await prisma.lesson.create({ data: { id: "stc2_l", title: "L", order: 1, moduleId: "stc2_m" } });
    await prisma.topic.create({ data: { id: "stc2_t", title: "T", order: 1, lessonId: "stc2_l" } });
    await prisma.subTopic.create({ data: { id: "stc2_st", title: "ST", order: 1, topicId: "stc2_t" } });
    await prisma.concept.create({ data: { id: "stc2_c", title: "C", order: 1, subTopicId: "stc2_st" } });
    // The lesson's ONLY real material lives at Concept level.
    await prisma.content.create({
      data: { id: "stc2_cnt", order: 1, conceptId: "stc2_c", type: "TEXT", htmlContent: "<p>real content</p>" },
    });
  });

  t.after(cleanup);

  await t.test("getCourseById nests SubTopics and Concepts under Topic", async () => {
    const courseService = require("../src/modules/courses/course.service");
    const course = await courseService.getCourseById(courseId, "INSTRUCTOR", instructorId);

    const topic = course.modules[0].lessons[0].topics[0];
    assert.strictEqual(topic.subTopics.length, 1, "subTopics returned");
    assert.strictEqual(topic.subTopics[0].concepts.length, 1, "concepts returned");
    assert.strictEqual(topic.subTopics[0].concepts[0].contents[0].id, "stc2_cnt");
  });

  await t.test("validateCourseForPublish accepts a lesson whose content is Concept-level", async () => {
    const courseService = require("../src/modules/courses/course.service");
    const result = await courseService.validateCourseForPublish(courseId);

    const emptyLesson = result.errors.find((e) => e.code === "EMPTY_LESSON");
    assert.strictEqual(emptyLesson, undefined, "concept content must count as usable lesson content");
    assert.strictEqual(result.canPublish, true, JSON.stringify(result.errors));
  });

  await t.test("publishCourse cascades isPublished to SubTopics and Concepts", async () => {
    const courseService = require("../src/modules/courses/course.service");
    await courseService.publishCourse(courseId, instructorId, "INSTRUCTOR");

    const st = await prisma.subTopic.findUnique({ where: { id: "stc2_st" } });
    const cn = await prisma.concept.findUnique({ where: { id: "stc2_c" } });

    // The roll-up filters every container on isPublished, so leaving these
    // false would make the content invisible AND absent from progress.
    assert.strictEqual(st.isPublished, true, "subtopic published with the course");
    assert.strictEqual(cn.isPublished, true, "concept published with the course");
  });

  await t.test("duplicateCourse copies the SubTopic/Concept subtree and its content", async () => {
    const courseService = require("../src/modules/courses/course.service");
    const copy = await courseService.duplicateCourse(courseId, instructorId);

    const full = await prisma.course.findUnique({
      where: { id: copy.id },
      include: {
        modules: {
          include: {
            lessons: {
              include: {
                topics: {
                  include: { subTopics: { include: { contents: true, concepts: { include: { contents: true } } } } },
                },
              },
            },
          },
        },
      },
    });

    const topic = full.modules[0].lessons[0].topics[0];
    assert.strictEqual(topic.subTopics.length, 1, "subtopic copied");
    const concept = topic.subTopics[0].concepts[0];
    assert.ok(concept, "concept copied");
    assert.strictEqual(concept.contents.length, 1, "concept content copied");
    assert.strictEqual(concept.contents[0].htmlContent, "<p>real content</p>");
    assert.notStrictEqual(concept.id, "stc2_c", "copy has fresh ids");
    assert.strictEqual(concept.isPublished, false, "a duplicate starts as a draft");
  });
});
