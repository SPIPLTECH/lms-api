const prisma = require('../config/database');
const { QUALIFYING_TAG, getCourseQualifications } = require('./qualification');

/**
 * Authoritative bottom-up multi-entity progress roll-up engine.
 *
 * Participated Entity Types (CQA), each attachable at ANY container level:
 * - Content (direct at Course, Module, Lesson, Topic, SubTopic, Concept)
 * - Quiz (direct at Course, Module, Lesson, Topic, SubTopic, Concept)
 * - Assignment (direct at Course, Module, Lesson, Topic, SubTopic, Concept)
 *
 * Container chain: Course -> Module -> Lesson -> Topic -> SubTopic -> Concept.
 * SubTopic and Concept are OPTIONAL. A Topic with no SubTopics rolls up from
 * its own CQA exactly as it did before those levels existed, so pre-existing
 * courses produce identical numbers.
 *
 * Rules:
 * 1. Only published, student-accessible items are counted.
 * 2. Empty containers (0 applicable items/children) CANNOT complete or become visited (completed = false, visited = false)
 *    and are excluded from their parent's denominator so empty containers do not block completion.
 * 3. A parent container completes iff ALL applicable direct items AND ALL applicable child entities complete.
 * 4. Ground Truth Completions:
 *    - Content: ContentProgress row with completed = true
 *    - Quiz: QuizSubmission row with passed = true (or percentage >= passingScore)
 *    - Assignment: AssignmentSubmission row with status in ["Submitted", "Graded"]
 * 5. Ground Truth Visited:
 *    - Content: ContentProgress row with visited = true
 *    - Quiz: QuizProgress row with visited = true
 *    - Assignment: AssignmentProgress row with visited = true
 *    - Container (Concept/SubTopic/Topic/Lesson/Module/Course): explicitly marked visited OR all applicable children/items visited.
 * 6. Idempotent and transaction-aware. Preserves completedAt and visitedAt when remaining complete/visited.
 *
 * Pass `options.includeTree` to also receive the authoritative hierarchical progress
 * tree (Course -> Module -> Lesson -> Topic -> SubTopic -> Concept -> Content/Quiz/Assignment).
 *
 * Pass `options.persist: false` for a read-only computation (e.g. an
 * instructor viewing a student list): the same numbers and tree, but no
 * container progress rows are written and the enrollment is not
 * touched — so viewing never bumps a student's lastAccessedAt. Every level's
 * completion is computed from in-memory maps, so skipping the writes cannot
 * change the result.
 */
const ASSIGNMENT_COMPLETED_STATUSES = ['Submitted', 'Graded'];

function isAssignmentSubmissionComplete(submission) {
  return !!submission && ASSIGNMENT_COMPLETED_STATUSES.includes(submission.status);
}

/**
 * The container levels, shallowest -> deepest. Adding a level means adding it
 * here; OWN_ITEMS_ONLY below is derived from it rather than hand-written.
 */
const LEVELS = ['course', 'module', 'lesson', 'topic', 'subTopic', 'concept'];

/**
 * Per level, the Prisma `where` that restricts a relation to the items that
 * level OWNS -- i.e. rows naming it as parent and naming NO deeper parent.
 *
 * Content/Quiz/Assignment are polymorphic across all six levels, so without
 * these exclusions a Concept-attached row would be returned again by its
 * Topic's `contents` relation and counted twice -- inflating both the
 * denominator and the numerator at every level above it. Six levels means
 * fifteen exclusion terms, which is exactly the kind of hand-maintained list
 * that rots, so it is generated from LEVELS once:
 *
 *   course   -> { moduleId: null, lessonId: null, topicId: null, subTopicId: null, conceptId: null }
 *   module   -> { lessonId: null, topicId: null, subTopicId: null, conceptId: null }
 *   lesson   -> { topicId: null, subTopicId: null, conceptId: null }
 *   topic    -> { subTopicId: null, conceptId: null }
 *   subTopic -> { conceptId: null }
 *   concept  -> {}   (deepest level owns everything pointing at it)
 *
 * The first four entries are byte-for-byte what the four-level version spelled
 * out by hand, plus the two new NULL checks -- so existing courses, whose rows
 * all have subTopicId and conceptId NULL, match exactly as they did before.
 */
const OWN_ITEMS_ONLY = Object.fromEntries(
  LEVELS.map((level, i) => [
    level,
    Object.fromEntries(LEVELS.slice(i + 1).map((deeper) => [`${deeper}Id`, null]))
  ])
);

async function computeCourseProgress(studentId, courseId, tx = null, options = {}) {
  const client = tx || prisma;
  const includeTree = options.includeTree === true;
  const persist = options.persist !== false;

  const contentSelect = { id: true, title: true, type: true, order: true, duration: true };
  const quizSelect = {
    id: true,
    title: true,
    order: true,
    passingScore: true,
    _count: {
      select: {
        questions: true,
        quizQuestions: true
      }
    }
  };
  // `order` is the assignment's position in its parent's common sequence
  // (shared with Content, Quizzes and child entities), like contentSelect/quizSelect.
  const assignmentSelect = { id: true, title: true, order: true, dueDate: true };

  // A QUALIFYING quiz is the test that lets a student SKIP its lesson/topic,
  // not an item inside it. Counting it as required learning would mean a
  // topic could only be completed by passing the very test that exempts the
  // student from it — and a student who never intends to skip would be left
  // with a permanently incomplete topic. Every quiz lookup below therefore
  // filters it out; qualification is read separately, from the attempts.
  const GRADED_QUIZ_TAGS = { quizTag: { not: QUALIFYING_TAG } };

  // 1. Fetch live published hierarchy including direct Contents, Quizzes, Assignments at all levels
  const course = await client.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      status: true,
      contents: {
        where: { ...OWN_ITEMS_ONLY.course },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: contentSelect
      },
      quizzes: {
        where: { isPublished: true, ...OWN_ITEMS_ONLY.course, ...GRADED_QUIZ_TAGS },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: quizSelect
      },
      assignments: {
        where: { isPublished: true, ...OWN_ITEMS_ONLY.course },
        select: assignmentSelect
      },
      modules: {
        where: { isPublished: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          title: true,
          order: true,
          contents: {
            where: { ...OWN_ITEMS_ONLY.module },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            select: contentSelect
          },
          quizzes: {
            where: { isPublished: true, ...OWN_ITEMS_ONLY.module, ...GRADED_QUIZ_TAGS },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            select: quizSelect
          },
          assignments: {
            where: { isPublished: true, ...OWN_ITEMS_ONLY.module },
            select: assignmentSelect
          },
          lessons: {
            where: { isPublished: true },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              title: true,
              order: true,
              contents: {
                where: { ...OWN_ITEMS_ONLY.lesson },
                orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                select: contentSelect
              },
              quizzes: {
                where: { isPublished: true, ...OWN_ITEMS_ONLY.lesson, ...GRADED_QUIZ_TAGS },
                orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                select: quizSelect
              },
              assignments: {
                where: { isPublished: true, ...OWN_ITEMS_ONLY.lesson },
                select: assignmentSelect
              },
              topics: {
                where: { isPublished: true },
                orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                select: {
                  id: true,
                  title: true,
                  order: true,
                  contents: {
                    where: { ...OWN_ITEMS_ONLY.topic },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                    select: contentSelect
                  },
                  quizzes: {
                    where: { isPublished: true, ...OWN_ITEMS_ONLY.topic, ...GRADED_QUIZ_TAGS },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                    select: quizSelect
                  },
                  assignments: {
                    where: { isPublished: true, ...OWN_ITEMS_ONLY.topic },
                    select: assignmentSelect
                  },
                  subTopics: {
                    where: { isPublished: true },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                    select: {
                      id: true,
                      title: true,
                      order: true,
                      contents: {
                        where: { ...OWN_ITEMS_ONLY.subTopic },
                        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                        select: contentSelect
                      },
                      quizzes: {
                        where: { isPublished: true, ...OWN_ITEMS_ONLY.subTopic, ...GRADED_QUIZ_TAGS },
                        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                        select: quizSelect
                      },
                      assignments: {
                        where: { isPublished: true, ...OWN_ITEMS_ONLY.subTopic },
                        select: assignmentSelect
                      },
                      concepts: {
                        where: { isPublished: true },
                        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                        select: {
                          id: true,
                          title: true,
                          order: true,
                          contents: {
                            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                            select: contentSelect
                          },
                          quizzes: {
                            where: { isPublished: true, ...GRADED_QUIZ_TAGS },
                            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                            select: quizSelect
                          },
                          assignments: {
                            where: { isPublished: true },
                            select: assignmentSelect
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!course) {
    throw new Error(`Course with ID ${courseId} not found`);
  }

  // 2. Collect all item IDs across all 6 levels
  const allContentIds = new Set();
  const allQuizMap = new Map(); // quizId -> passingScore
  const allAssignmentIds = new Set();
  // Container ids scope the existing-progress lookups below to this course
  // only, instead of every course the student has ever touched.
  const allConceptIds = new Set();
  const allSubTopicIds = new Set();
  const allTopicIds = new Set();
  const allLessonIds = new Set();
  const allModuleIds = new Set();

  // Every container's own CQA is collected the same way, so the walk below
  // only has to say WHICH containers exist, not repeat the three .forEach
  // lines at each of six levels.
  const collectItems = (entity) => {
    entity.contents.forEach((c) => allContentIds.add(c.id));
    entity.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
    entity.assignments.forEach((a) => allAssignmentIds.add(a.id));
  };

  // Course direct
  collectItems(course);

  // Modules, Lessons, Topics, SubTopics, Concepts
  for (const mod of course.modules) {
    allModuleIds.add(mod.id);
    collectItems(mod);

    for (const lesson of mod.lessons) {
      allLessonIds.add(lesson.id);
      collectItems(lesson);

      for (const topic of lesson.topics) {
        allTopicIds.add(topic.id);
        collectItems(topic);

        for (const subTopic of topic.subTopics || []) {
          allSubTopicIds.add(subTopic.id);
          collectItems(subTopic);

          for (const concept of subTopic.concepts || []) {
            allConceptIds.add(concept.id);
            collectItems(concept);
          }
        }
      }
    }
  }

  // 3. Fetch Ground Truth completions & visited states for Student, plus the
  // existing container-progress rows needed to preserve completedAt/visitedAt.
  // All eight lookups are independent of one another (each only depends on
  // the id sets collected in step 2), so they run as ONE parallel batch
  // instead of a chain of sequential round trips -- the dominant cost of a
  // rollup on a remote database is round-trip latency, not query cost, so
  // collapsing N sequential awaits into one Promise.all is the single
  // biggest lever on wall-clock time here.
  const quizIds = Array.from(allQuizMap.keys());
  const assignmentIds = Array.from(allAssignmentIds);
  const conceptIds = Array.from(allConceptIds);
  const subTopicIds = Array.from(allSubTopicIds);
  const topicIds = Array.from(allTopicIds);
  const lessonIds = Array.from(allLessonIds);
  const moduleIds = Array.from(allModuleIds);

  const [
    cpRecords,
    qsRecords,
    qpRecords,
    asRecords,
    apRecords,
    existingConceptProgresses,
    existingSubTopicProgresses,
    existingTopicProgresses,
    existingLessonProgresses,
    existingModuleProgresses,
    qualifications
  ] = await Promise.all([
    allContentIds.size > 0
      ? client.contentProgress.findMany({
          where: { studentId, contentId: { in: Array.from(allContentIds) } },
          select: { contentId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    quizIds.length > 0
      ? client.quizSubmission.findMany({
          where: { studentId, quizId: { in: quizIds } },
          select: { quizId: true, passed: true, percentage: true, score: true, totalMarks: true, submittedAt: true }
        })
      : [],
    quizIds.length > 0
      ? client.quizProgress.findMany({
          where: { studentId, quizId: { in: quizIds } },
          select: { quizId: true, visited: true, visitedAt: true, completed: true, completedAt: true }
        })
      : [],
    assignmentIds.length > 0
      ? client.assignmentSubmission.findMany({
          where: { studentId, assignmentId: { in: assignmentIds } },
          select: { assignmentId: true, status: true, grade: true, submittedAt: true }
        })
      : [],
    assignmentIds.length > 0
      ? client.assignmentProgress.findMany({
          where: { studentId, assignmentId: { in: assignmentIds } },
          select: { assignmentId: true, visited: true, visitedAt: true, completed: true, completedAt: true }
        })
      : [],
    conceptIds.length > 0
      ? client.conceptProgress.findMany({
          where: { studentId, conceptId: { in: conceptIds } },
          select: { conceptId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    subTopicIds.length > 0
      ? client.subTopicProgress.findMany({
          where: { studentId, subTopicId: { in: subTopicIds } },
          select: { subTopicId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    topicIds.length > 0
      ? client.topicProgress.findMany({
          where: { studentId, topicId: { in: topicIds } },
          select: { topicId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    lessonIds.length > 0
      ? client.lessonProgress.findMany({
          where: { studentId, lessonId: { in: lessonIds } },
          select: { lessonId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    moduleIds.length > 0
      ? client.moduleProgress.findMany({
          where: { studentId, moduleId: { in: moduleIds } },
          select: { moduleId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    // The lessons/topics this student has qualified out of, read from the
    // Phase 1 attempt log rather than stored anywhere of its own.
    getCourseQualifications(studentId, courseId, client)
  ]);

  const { qualifiedTopicIds, qualifiedLessonIds } = qualifications;

  // A. Content Progress
  const completedContentSet = new Set();
  const visitedContentSet = new Set();
  const contentProgressMap = new Map();
  cpRecords.forEach((r) => {
    contentProgressMap.set(r.contentId, r);
    if (r.completed) completedContentSet.add(r.contentId);
    if (r.visited) visitedContentSet.add(r.contentId);
  });

  // B. Quiz Progress & Submissions
  const completedQuizSet = new Set();
  const visitedQuizSet = new Set();
  const quizSubmissionMap = new Map();
  const quizProgressMap = new Map();
  qsRecords.forEach((qs) => {
    quizSubmissionMap.set(qs.quizId, qs);
    const minPassScore = allQuizMap.get(qs.quizId) || 0;
    if (qs.passed || (qs.percentage !== undefined && qs.percentage >= minPassScore)) {
      completedQuizSet.add(qs.quizId);
    }
  });
  qpRecords.forEach((qp) => {
    quizProgressMap.set(qp.quizId, qp);
    if (qp.visited) visitedQuizSet.add(qp.quizId);
    if (qp.completed) completedQuizSet.add(qp.quizId);
  });

  // C. Assignment Progress & Submissions
  const completedAssignmentSet = new Set();
  const visitedAssignmentSet = new Set();
  const assignmentSubmissionMap = new Map();
  const assignmentProgressMap = new Map();
  asRecords.forEach((r) => {
    assignmentSubmissionMap.set(r.assignmentId, r);
    if (isAssignmentSubmissionComplete(r)) completedAssignmentSet.add(r.assignmentId);
  });
  apRecords.forEach((ap) => {
    assignmentProgressMap.set(ap.assignmentId, ap);
    if (ap.visited) visitedAssignmentSet.add(ap.assignmentId);
    if (ap.completed) completedAssignmentSet.add(ap.assignmentId);
  });

  const conceptProgressMap = new Map(existingConceptProgresses.map((cp) => [cp.conceptId, cp]));
  const subTopicProgressMap = new Map(existingSubTopicProgresses.map((sp) => [sp.subTopicId, sp]));
  const topicProgressMap = new Map(existingTopicProgresses.map((tp) => [tp.topicId, tp]));
  const lessonProgressMap = new Map(existingLessonProgresses.map((lp) => [lp.lessonId, lp]));
  const moduleProgressMap = new Map(existingModuleProgresses.map((mp) => [mp.moduleId, mp]));

  const now = new Date();

  // In-memory status per container level, produced bottom-up.
  const newStatus = () => ({
    applicable: new Map(),
    completed: new Map(),
    visited: new Map(),
    completedAt: new Map(),
    visitedAt: new Map(),
    qualified: new Map(),
    qualifiedAt: new Map(),
    // completed OR qualified -- the single flag a PARENT reads when deciding
    // whether this child still holds it back.
    satisfied: new Map()
  });

  // Only Topic and Lesson offer a qualifying test; every other level passes
  // this, so `satisfied` there is simply `completed`.
  const NOT_QUALIFIABLE = new Map();

  // The deepest level has no child containers.
  const NO_CHILDREN = newStatus();

  /**
   * One container's status from its OWN Content/Quiz/Assignment plus its
   * applicable child containers.
   *
   * This is character-for-character the rule the four-level version applied
   * separately at Topic, Lesson and Module -- lifted into one function because
   * it now has to run at FIVE levels, and five hand-written copies would be
   * five chances to read the wrong level's Map (a mistake that produces a
   * silently wrong percentage rather than a crash). The calculation itself is
   * unchanged:
   *
   *   applicable = it has at least one own item or one applicable child
   *   completed  = applicable AND every own item complete
   *                          AND every applicable child complete
   *   visited    = explicitly marked visited (sticky), OR everything below visited
   *
   * `children` is empty at Concept, which reduces this to "own items only" --
   * and for a Topic with no SubTopics it likewise reduces to exactly the
   * pre-existing Topic behaviour, which is what keeps old courses identical.
   */
  const computeContainer = (entity, children, existing, childStatus) => {
    const applicableChildren = children.filter((c) => childStatus.applicable.get(c.id) === true);

    const hasItems =
      entity.contents.length +
        entity.quizzes.length +
        entity.assignments.length +
        applicableChildren.length >
      0;

    const isCompleted =
      hasItems &&
      entity.contents.every((c) => completedContentSet.has(c.id)) &&
      entity.quizzes.every((q) => completedQuizSet.has(q.id)) &&
      entity.assignments.every((a) => completedAssignmentSet.has(a.id)) &&
      // A child the student qualified out of no longer holds its parent
      // back: the student demonstrated they already knew it.
      applicableChildren.every((c) => childStatus.satisfied.get(c.id) === true);

    const isVisited =
      existing?.visited ||
      (hasItems &&
        entity.contents.every((c) => visitedContentSet.has(c.id)) &&
        entity.quizzes.every((q) => visitedQuizSet.has(q.id)) &&
        entity.assignments.every((a) => visitedAssignmentSet.has(a.id)) &&
        applicableChildren.every((c) => childStatus.visited.get(c.id) === true));

    return {
      applicable: hasItems,
      completed: isCompleted,
      // Preserve the ORIGINAL timestamp while the container stays complete/
      // visited, exactly as before -- never restamp it on a later recompute.
      completedAt: isCompleted ? (existing?.completed ? existing.completedAt : now) : null,
      visited: isVisited,
      visitedAt: isVisited ? (existing?.visited ? existing.visitedAt : now) : null
    };
  };

  /**
   * Runs one whole level. Every container at a level depends only on its own
   * items and its own children (never on a sibling), so all upserts for a
   * level are independent writes -- collected and flushed with a single
   * Promise.all, exactly as the previous per-level loops did, instead of one
   * awaited round trip per container.
   */
  const runLevel = ({
    entities,
    childrenOf,
    childStatus,
    progressMap,
    delegate,
    idField,
    qualifiedIds = NOT_QUALIFIABLE
  }) => {
    const status = newStatus();
    const upserts = [];
    const qualifiable = qualifiedIds !== NOT_QUALIFIABLE;

    for (const entity of entities) {
      const r = computeContainer(entity, childrenOf(entity), progressMap.get(entity.id), childStatus);

      // Materialized from the qualifying attempts, exactly as `completed` is
      // materialized from the container's items. qualifiedAt is the first
      // passing attempt's timestamp, so it does not move when the student
      // retakes the test.
      const isQualified = qualifiedIds.has(entity.id);
      const qualifiedAt = isQualified ? qualifiedIds.get(entity.id) : null;

      status.applicable.set(entity.id, r.applicable);
      status.completed.set(entity.id, r.completed);
      status.visited.set(entity.id, r.visited);
      status.completedAt.set(entity.id, r.completedAt);
      status.visitedAt.set(entity.id, r.visitedAt);
      status.qualified.set(entity.id, isQualified);
      status.qualifiedAt.set(entity.id, qualifiedAt);
      status.satisfied.set(entity.id, r.completed || isQualified);

      if (persist) {
        const row = {
          completed: r.completed,
          completedAt: r.completedAt,
          visited: r.visited,
          visitedAt: r.visitedAt,
          ...(qualifiable ? { qualified: isQualified, qualifiedAt } : {})
        };
        upserts.push(
          delegate.upsert({
            where: { [`studentId_${idField}`]: { studentId, [idField]: entity.id } },
            create: { studentId, [idField]: entity.id, ...row },
            update: row
          })
        );
      }
    }

    return { status, upserts };
  };

  // Flattened container lists, deepest first. Built once and reused by both
  // the roll-up below and nothing else -- the tree builder walks the nested
  // structure directly, as before.
  const allLessonsFlat = course.modules.flatMap((m) => m.lessons);
  const allTopicsFlat = allLessonsFlat.flatMap((l) => l.topics);
  const allSubTopicsFlat = allTopicsFlat.flatMap((t) => t.subTopics || []);
  const allConceptsFlat = allSubTopicsFlat.flatMap((st) => st.concepts || []);

  // 4. Roll up bottom-up: Concept -> SubTopic -> Topic -> Lesson -> Module.
  // Each level must wait for the one below it to settle, because its
  // completion reads that level's status maps.
  const conceptRun = runLevel({
    entities: allConceptsFlat,
    childrenOf: () => [],
    childStatus: NO_CHILDREN,
    progressMap: conceptProgressMap,
    delegate: client.conceptProgress,
    idField: 'conceptId'
  });
  if (persist) await Promise.all(conceptRun.upserts);

  const subTopicRun = runLevel({
    entities: allSubTopicsFlat,
    childrenOf: (st) => st.concepts || [],
    childStatus: conceptRun.status,
    progressMap: subTopicProgressMap,
    delegate: client.subTopicProgress,
    idField: 'subTopicId'
  });
  if (persist) await Promise.all(subTopicRun.upserts);

  const topicRun = runLevel({
    entities: allTopicsFlat,
    childrenOf: (t) => t.subTopics || [],
    childStatus: subTopicRun.status,
    progressMap: topicProgressMap,
    delegate: client.topicProgress,
    idField: 'topicId',
    qualifiedIds: qualifiedTopicIds
  });
  if (persist) await Promise.all(topicRun.upserts);

  const lessonRun = runLevel({
    entities: allLessonsFlat,
    childrenOf: (l) => l.topics,
    childStatus: topicRun.status,
    progressMap: lessonProgressMap,
    delegate: client.lessonProgress,
    idField: 'lessonId',
    qualifiedIds: qualifiedLessonIds
  });
  if (persist) await Promise.all(lessonRun.upserts);

  const moduleRun = runLevel({
    entities: course.modules,
    childrenOf: (m) => m.lessons,
    childStatus: lessonRun.status,
    progressMap: moduleProgressMap,
    delegate: client.moduleProgress,
    idField: 'moduleId'
  });
  if (persist) await Promise.all(moduleRun.upserts);

  // 7. Helper functions for mapping items and building direct item counts
  const mapContent = (c) => {
    const cp = contentProgressMap.get(c.id);
    return {
      id: c.id,
      kind: 'CONTENT',
      title: c.title,
      contentType: c.type,
      order: c.order,
      duration: c.duration,
      visited: visitedContentSet.has(c.id),
      visitedAt: cp?.visitedAt ?? null,
      completed: completedContentSet.has(c.id),
      completedAt: cp?.completedAt ?? null
    };
  };

  const mapQuiz = (q) => {
    const sub = quizSubmissionMap.get(q.id) || null;
    const qp = quizProgressMap.get(q.id) || null;
    const questionCount = (q._count?.questions || 0) + (q._count?.quizQuestions || 0);
    return {
      id: q.id,
      kind: 'QUIZ',
      title: q.title,
      order: q.order,
      passingScore: q.passingScore,
      questionCount,
      visited: visitedQuizSet.has(q.id),
      visitedAt: qp?.visitedAt ?? null,
      completed: completedQuizSet.has(q.id),
      attempted: !!sub,
      score: sub?.score ?? null,
      totalMarks: sub?.totalMarks ?? null,
      percentage: sub?.percentage ?? null,
      passed: sub?.passed ?? null,
      submittedAt: sub?.submittedAt ?? null
    };
  };

  const mapAssignment = (a) => {
    const sub = assignmentSubmissionMap.get(a.id) || null;
    const ap = assignmentProgressMap.get(a.id) || null;
    return {
      id: a.id,
      kind: 'ASSIGNMENT',
      title: a.title,
      order: a.order,
      dueDate: a.dueDate,
      visited: visitedAssignmentSet.has(a.id),
      visitedAt: ap?.visitedAt ?? null,
      completed: completedAssignmentSet.has(a.id),
      submissionStatus: sub?.status ?? 'NotSubmitted',
      grade: sub?.grade ?? null,
      submittedAt: sub?.submittedAt ?? null
    };
  };

  // Direct (non-inherited) learning items owned by an entity, with their own counts.
  const buildDirect = (entity) => {
    const contents = entity.contents.map(mapContent);
    const quizzes = entity.quizzes.map(mapQuiz);
    const assignments = entity.assignments.map(mapAssignment);
    const items = [...contents, ...quizzes, ...assignments];
    return {
      contents,
      quizzes,
      assignments,
      directTotalItems: items.length,
      directCompletedItems: items.filter((i) => i.completed).length,
      directVisitedItems: items.filter((i) => i.visited).length
    };
  };

  const pct = (count, total) => (total > 0 ? Math.round((count / total) * 100) : 0);

  // 8. Build tree and roll up immediate-child denominators at every level:
  //    Parent Total Items = Direct Items + Immediate Applicable Child Containers
  //    Parent Completed Items = Direct Completed Items + Immediate Completed Child Containers
  /**
   * One node of the response tree. `childrenTree` is the already-built array
   * of immediate child containers ([] at Concept).
   *
   * The denominator rule is unchanged and still immediate-child only:
   *   totalItems = own items + applicable immediate child containers
   * with each applicable child worth exactly ONE unit, and only when complete.
   * A Topic whose `subTopics` array is empty therefore produces byte-identical
   * numbers to the four-level version.
   */
  const buildNode = (entity, childrenKey, childrenTree, status) => {
    const direct = buildDirect(entity);
    const applicableChildren = childrenTree.filter((c) => c.applicable);
    const totalItems = direct.directTotalItems + applicableChildren.length;
    const completedItems =
      direct.directCompletedItems + applicableChildren.filter((c) => c.satisfied).length;
    const visitedItems =
      direct.directVisitedItems + applicableChildren.filter((c) => c.visited).length;

    return {
      id: entity.id,
      title: entity.title,
      order: entity.order,
      ...direct,
      ...(childrenKey ? { [childrenKey]: childrenTree } : {}),
      totalItems,
      completedItems,
      visitedItems,
      progressPercent: pct(completedItems, totalItems),
      visitedPercent: pct(visitedItems, totalItems),
      applicable: status.applicable.get(entity.id) === true,
      completed: status.completed.get(entity.id) === true,
      completedAt: status.completedAt.get(entity.id) ?? null,
      // Skipped after passing this node's qualifying test (Topic/Lesson only;
      // always false elsewhere). Reported separately from `completed` so the
      // player can say "skipped" and not "done", while `satisfied` is the
      // single flag progression reads — no caller has to check both.
      qualified: status.qualified.get(entity.id) === true,
      qualifiedAt: status.qualifiedAt.get(entity.id) ?? null,
      satisfied: status.satisfied.get(entity.id) === true,
      visited: status.visited.get(entity.id) === true,
      visitedAt: status.visitedAt.get(entity.id) ?? null
    };
  };

  const modulesTree = course.modules.map((mod) => {
    const lessonsTree = mod.lessons.map((lesson) => {
      const topicsTree = lesson.topics.map((topic) => {
        const subTopicsTree = (topic.subTopics || []).map((subTopic) => {
          const conceptsTree = (subTopic.concepts || []).map((concept) =>
            buildNode(concept, null, [], conceptRun.status)
          );
          return buildNode(subTopic, 'concepts', conceptsTree, subTopicRun.status);
        });
        return buildNode(topic, 'subTopics', subTopicsTree, topicRun.status);
      });
      return buildNode(lesson, 'topics', topicsTree, lessonRun.status);
    });
    return buildNode(mod, 'lessons', lessonsTree, moduleRun.status);
  });

  const courseDirect = buildDirect(course);
  const applicableModules = modulesTree.filter((m) => m.applicable);
  const courseTotalItems = courseDirect.directTotalItems + applicableModules.length;
  const courseCompletedItems = courseDirect.directCompletedItems + applicableModules.filter((m) => m.completed).length;
  const courseVisitedItems = courseDirect.directVisitedItems + applicableModules.filter((m) => m.visited).length;

  const progressPercent = pct(courseCompletedItems, courseTotalItems);
  const visitedPercent = pct(courseVisitedItems, courseTotalItems);

  const isCourseCompleted = courseTotalItems > 0 && courseCompletedItems === courseTotalItems;
  const isCourseVisited = courseTotalItems > 0 && courseVisitedItems === courseTotalItems;

  const existingEnrollment = persist
    ? await client.enrollment.findUnique({
        where: { studentId_courseId: { studentId, courseId } }
      })
    : null;

  if (existingEnrollment) {
    const courseCompletedAt = isCourseCompleted
      ? (existingEnrollment.completed ? existingEnrollment.completedAt : now)
      : null;

    await client.enrollment.update({
      where: { id: existingEnrollment.id },
      data: {
        progressPercent,
        completed: isCourseCompleted,
        completedAt: courseCompletedAt,
        lastAccessedAt: now
      }
    });
  }

  const result = {
    courseId,
    studentId,
    totalItems: courseTotalItems,
    completedItems: courseCompletedItems,
    progressPercent,
    completed: isCourseCompleted,
    visitedItems: courseVisitedItems,
    visitedPercent,
    visited: isCourseVisited
  };

  if (!includeTree) return result;

  result.hierarchy = {
    id: course.id,
    title: course.title,
    status: course.status,
    ...courseDirect,
    modules: modulesTree,
    totalItems: courseTotalItems,
    completedItems: courseCompletedItems,
    visitedItems: courseVisitedItems,
    progressPercent,
    visitedPercent,
    completed: isCourseCompleted,
    // A course is not skippable as a whole; carried for shape parity with
    // every other node in the tree.
    qualified: false,
    qualifiedAt: null,
    satisfied: isCourseCompleted,
    visited: isCourseVisited
  };

  return result;
}

/**
 * Serializes concurrent rollups for the same (studentId, courseId) pair.
 *
 * completeContent/markVisited/completeLesson can all be in flight for the
 * same student and course at once (e.g. the auto-visit fired when a block
 * opens racing the "Mark as Complete" click for that same block, or a
 * double-click before the mutation's own isPending guard commits). Each
 * call independently reads Content/Quiz/Assignment ground truth, computes
 * fresh Topic/Lesson/Module/Enrollment values, and writes them with no
 * shared transaction -- two overlapping calls can interleave their reads
 * and writes so that whichever call's write lands LAST wins the row, even
 * if it was computed from an OLDER snapshot (a classic lost update). Since
 * every one of these calls is independent, cheap, in-process bookkeeping
 * (no cross-request state, no I/O), a simple per-key promise chain is
 * enough to make them run one-at-a-time rather than interleaved, without
 * touching how any individual rollup is computed. Calls for different
 * students/courses never block each other.
 *
 * Only applies to the caller-owned-transaction-free path: a caller that
 * passes its own `tx` already controls its own sequencing.
 */
const rollupChains = new Map();

function runExclusive(key, fn) {
  const tail = rollupChains.get(key) || Promise.resolve();
  const settled = tail.then(fn, fn);
  const chained = settled.then(
    () => {},
    () => {}
  );
  rollupChains.set(key, chained);
  chained.finally(() => {
    if (rollupChains.get(key) === chained) rollupChains.delete(key);
  });
  return settled;
}

async function recomputeCourseProgress(studentId, courseId, tx = null, options = {}) {
  if (tx) return computeCourseProgress(studentId, courseId, tx, options);
  return runExclusive(`${studentId}:${courseId}`, () => computeCourseProgress(studentId, courseId, tx, options));
}

/**
 * Ensures progress is initialized and computed.
 */
async function ensureProgressInitialized(studentId, courseId, tx = null) {
  return recomputeCourseProgress(studentId, courseId, tx);
}

module.exports = {
  recomputeCourseProgress,
  ensureProgressInitialized
};

