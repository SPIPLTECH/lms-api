const prisma = require('../config/database');
const {
  QUALIFYING_TAG,
  getCourseQualifications,
  getCourseQualificationsForStudents
} = require('./qualification');
const {
  summarizeQuizAttempts,
  isQuizComplete,
  isAssignmentSubmissionComplete
} = require('./itemCompletion');

/**
 * Authoritative bottom-up progress roll-up engine.
 *
 * Every learning item is a Content row. A Quiz or an Assignment takes part in
 * the sequence — and in progress — through the Content row that wraps it
 * (Content(type=QUIZ, quizId) / Content(type=ASSIGNMENT, assignmentId)).
 * Unwrapped quizzes (QUALIFYING tests, student
 * practice quizzes) are not course items and are never counted here.
 *
 * Container chain: Course -> Module -> Lesson -> Topic -> SubTopic -> Concept.
 * SubTopic and Concept are OPTIONAL. Content can hang off any one of the six.
 *
 * Rules:
 * 1. Only published, student-accessible items count: published containers;
 *    a QUIZ/ASSIGNMENT item counts only while its Quiz/Assignment is published.
 * 2. Empty containers (0 applicable items/children) cannot complete or become
 *    visited, and are excluded from their parent's denominator.
 * 3. A container completes iff ALL its own items AND ALL its applicable child
 *    containers complete (or were qualified out of).
 * 4. Item completion is the ONE rule in utils/itemCompletion.js:
 *      ordinary Content -> ContentProgress.completed
 *      QUIZ FINAL       -> a passing attempt
 *      QUIZ SELF_TEST   -> any attempt
 *      ASSIGNMENT       -> a Submitted/Graded submission
 *    ContentProgress of a QUIZ/ASSIGNMENT item is kept equal to that rule
 *    (synced here whenever the roll-up persists), so the per-Content progress
 *    rows and the derived numbers can never disagree.
 * 5. Visited: ContentProgress.visited (a quiz attempt or an assignment
 *    submission also counts as a visit). Containers: every applicable
 *    item/child visited. Purely derived, exactly like completion (rule 3) --
 *    never sticky: a container stops being visited the moment unseen content
 *    is added to it, otherwise a Lesson keeps reporting visitedPercent 100 over
 *    items the student has never opened. POST /progress/visited on a container
 *    therefore does not survive the roll-up that follows it; only item-level
 *    visits are ground truth.
 * 6. Idempotent and transaction-aware. Preserves completedAt/visitedAt while
 *    an item/container stays complete/visited.
 *
 * Pass `options.includeTree` to also receive the hierarchical progress tree
 * (Course -> Module -> Lesson -> Topic -> SubTopic -> Concept), where every
 * node carries `items` — its own Content rows in Content.order — plus the
 * compatibility projections `contents` (ordinary content), `quizzes` and
 * `assignments` (the wrapped quiz/assignment items, keyed by their domain id
 * and carrying `contentId`).
 *
 * Pass `options.persist: false` for a read-only computation (an instructor
 * viewing a student, an access check): the same numbers and tree, but nothing
 * is written and the enrollment is not touched.
 */

/**
 * The container levels, shallowest -> deepest. OWN_ITEMS_ONLY below is derived
 * from it rather than hand-written.
 */
const LEVELS = ['course', 'module', 'lesson', 'topic', 'subTopic', 'concept'];

/**
 * Per level, the Prisma `where` that restricts Content to the rows that level
 * OWNS — rows naming it as parent and no deeper parent. A Content row has
 * exactly one parent (DB-enforced), so this is defensive; it also keeps the
 * roll-up correct if a row ever carried a stray ancestor id.
 *
 *   course   -> { moduleId: null, lessonId: null, topicId: null, subTopicId: null, conceptId: null }
 *   module   -> { lessonId: null, topicId: null, subTopicId: null, conceptId: null }
 *   ...
 *   concept  -> {}
 */
const OWN_ITEMS_ONLY = Object.fromEntries(
  LEVELS.map((level, i) => [
    level,
    Object.fromEntries(LEVELS.slice(i + 1).map((deeper) => [`${deeper}Id`, null]))
  ])
);

const ORDERED = [{ order: 'asc' }, { createdAt: 'asc' }];

// One select for every level's items: the Content row, plus the Quiz or
// Assignment it wraps.
const CONTENT_SELECT = {
  id: true,
  title: true,
  type: true,
  order: true,
  duration: true,
  quizId: true,
  assignmentId: true,
  quiz: {
    select: {
      id: true,
      title: true,
      quizTag: true,
      passingScore: true,
      timeLimit: true,
      attempts: true,
      isPublished: true,
      _count: { select: { questions: true, quizQuestions: true } }
    }
  },
  assignment: {
    select: { id: true, title: true, dueDate: true, marks: true, isPublished: true }
  }
};

/** Whether a Content row is a learning item a student can currently reach. */
function isVisibleItem(content) {
  if (content.type === 'QUIZ') {
    return Boolean(content.quiz) && content.quiz.isPublished !== false && content.quiz.quizTag !== QUALIFYING_TAG;
  }
  if (content.type === 'ASSIGNMENT') {
    return Boolean(content.assignment) && content.assignment.isPublished !== false;
  }
  return true;
}

/**
 * True when a container progress row needs writing: there is no row yet, or
 * one of the fields the roll-up owns differs from what is stored.
 *
 * Every roll-up recomputes every Concept/SubTopic/Topic/Lesson/Module of the
 * course, but a single completion or visit changes one or two of them. Writing
 * all of them anyway was one upsert per container per call — 20+ round trips
 * to the database on every "Mark as Complete", most of them rewriting the
 * value already there.
 */
function containerRowChanged(existing, row) {
  if (!existing) return true;
  return Object.keys(row).some((key) => {
    const next = row[key];
    const stored = existing[key];
    if (next instanceof Date || stored instanceof Date) {
      const nextTime = next ? new Date(next).getTime() : null;
      const storedTime = stored ? new Date(stored).getTime() : null;
      return nextTime !== storedTime;
    }
    return (next ?? null) !== (stored ?? null);
  });
}

const earliest = (dates) => {
  const valid = dates.filter(Boolean).map((d) => new Date(d));
  if (valid.length === 0) return null;
  return new Date(Math.min(...valid.map((d) => d.getTime())));
};

/**
 * Each container level's path up to its course, as a Prisma relation filter.
 * Used to load every level of one course in parallel instead of nesting.
 */
const IN_COURSE = {
  module: (courseId) => ({ courseId }),
  lesson: (courseId) => ({ module: { courseId } }),
  topic: (courseId) => ({ lesson: { module: { courseId } } }),
  subTopic: (courseId) => ({ topic: { lesson: { module: { courseId } } } }),
  concept: (courseId) => ({ subTopic: { topic: { lesson: { module: { courseId } } } } })
};

const CONTAINER_SELECT = { id: true, title: true, order: true };

// Content's parent columns, deepest first: a row belongs to the deepest
// level it names, which is exactly the level whose OWN_ITEMS_ONLY it passes.
const CONTENT_PARENT_FIELDS = ['conceptId', 'subTopicId', 'topicId', 'lessonId', 'moduleId', 'courseId'];

/**
 * The course's published hierarchy — Course -> Module -> Lesson -> Topic ->
 * SubTopic -> Concept, every level with its own Content rows in Content
 * order — as the same nested object one deep `findUnique` used to return.
 *
 * That single select compiled to one ~50-join SQL statement that PostgreSQL
 * spent 190-420 ms just planning (plus 190-300 ms executing) on every call,
 * and every roll-up runs it. Here each level is one small query, all issued
 * together, and the tree is assembled in memory:
 *  - a container is kept only when its parent was kept, so — as before —
 *    nothing under an unpublished container is reached;
 *  - rows are fetched in the same [order, createdAt] sort and grouped in
 *    that order, so every sibling list keeps its order;
 *  - a Content row goes to the level whose OWN_ITEMS_ONLY rule it passes.
 * Returns null when the course does not exist.
 */
async function loadPublishedHierarchy(client, courseId) {
  const published = (level) => ({ where: { isPublished: true, ...IN_COURSE[level](courseId) }, orderBy: ORDERED });

  const [course, modules, lessons, topics, subTopics, concepts, contents] = await Promise.all([
    client.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, status: true, sequentialLearning: true } }),
    client.module.findMany({ ...published('module'), select: CONTAINER_SELECT }),
    client.lesson.findMany({ ...published('lesson'), select: { ...CONTAINER_SELECT, moduleId: true } }),
    client.topic.findMany({ ...published('topic'), select: { ...CONTAINER_SELECT, lessonId: true } }),
    client.subTopic.findMany({ ...published('subTopic'), select: { ...CONTAINER_SELECT, topicId: true } }),
    client.concept.findMany({ ...published('concept'), select: { ...CONTAINER_SELECT, subTopicId: true } }),
    client.content.findMany({
      where: {
        OR: [
          { courseId, ...OWN_ITEMS_ONLY.course },
          ...['module', 'lesson', 'topic', 'subTopic', 'concept'].map((level) => ({
            [level]: IN_COURSE[level](courseId),
            ...OWN_ITEMS_ONLY[level]
          }))
        ]
      },
      orderBy: ORDERED,
      select: { ...CONTENT_SELECT, ...Object.fromEntries(CONTENT_PARENT_FIELDS.map((f) => [f, true])) }
    })
  ]);

  if (!course) return null;

  // Parents are attached before their children, so `byId` only ever holds
  // containers that are actually in the tree.
  const byId = new Map([[course.id, course]]);
  course.contents = [];
  course.modules = [];
  const attach = (rows, parentField, childrenKey, grandchildrenKey) => {
    for (const { [parentField]: parentId, ...row } of rows) {
      const parent = byId.get(parentId);
      if (!parent) continue;
      const node = { ...row, contents: [], ...(grandchildrenKey ? { [grandchildrenKey]: [] } : {}) };
      parent[childrenKey].push(node);
      byId.set(node.id, node);
    }
  };
  attach(modules.map((m) => ({ ...m, courseId })), 'courseId', 'modules', 'lessons');
  attach(lessons, 'moduleId', 'lessons', 'topics');
  attach(topics, 'lessonId', 'topics', 'subTopics');
  attach(subTopics, 'topicId', 'subTopics', 'concepts');
  attach(concepts, 'subTopicId', 'concepts', null);

  for (const row of contents) {
    const ownerField = CONTENT_PARENT_FIELDS.find((field) => row[field]);
    const owner = ownerField ? byId.get(row[ownerField]) : null;
    if (!owner) continue;
    const item = { ...row };
    for (const field of CONTENT_PARENT_FIELDS) delete item[field];
    owner.contents.push(item);
  }

  return course;
}

/**
 * Every reachable item and container id of a loaded hierarchy. Unpublished
 * quiz/assignment items are dropped from each container here — in place, and
 * idempotently, so one loaded tree can be collected again for each student.
 */
function collectCourseItems(course) {
  const allContents = [];
  const quizIds = new Set();
  const assignmentIds = new Set();
  const allConceptIds = new Set();
  const allSubTopicIds = new Set();
  const allTopicIds = new Set();
  const allLessonIds = new Set();
  const allModuleIds = new Set();

  const collectItems = (entity) => {
    entity.contents = (entity.contents || []).filter(isVisibleItem);
    for (const content of entity.contents) {
      allContents.push(content);
      if (content.type === 'QUIZ') quizIds.add(content.quizId);
      if (content.type === 'ASSIGNMENT') assignmentIds.add(content.assignmentId);
    }
  };

  collectItems(course);
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

  return {
    allContents,
    quizIds,
    assignmentIds,
    allConceptIds,
    allSubTopicIds,
    allTopicIds,
    allLessonIds,
    allModuleIds
  };
}

/**
 * The student's ground truth for a course's items, plus their existing
 * container rows (to preserve completedAt/visitedAt). Independent reads, one
 * parallel batch — on a remote database the round trips, not the queries, are
 * the cost. `studentId` is one id, or `{ in: [...] }` to read many students
 * at once; every row carries its studentId for grouping.
 */
async function readStudentRows(client, studentId, items) {
  const contentIds = items.allContents.map((c) => c.id);
  const quizIdList = Array.from(items.quizIds);
  const assignmentIdList = Array.from(items.assignmentIds);

  const [
    cpRecords,
    attemptRecords,
    submissionRecords,
    assignmentSubmissionRecords,
    conceptProgresses,
    subTopicProgresses,
    topicProgresses,
    lessonProgresses,
    moduleProgresses
  ] = await Promise.all([
    contentIds.length > 0
      ? client.contentProgress.findMany({
          where: { studentId, contentId: { in: contentIds } },
          select: { studentId: true, contentId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    quizIdList.length > 0
      ? client.quizAttempt.findMany({
          where: { studentId, quizId: { in: quizIdList } },
          select: { studentId: true, quizId: true, passed: true, percentage: true, score: true, totalMarks: true, submittedAt: true }
        })
      : [],
    quizIdList.length > 0
      ? client.quizSubmission.findMany({
          where: { studentId, quizId: { in: quizIdList } },
          select: { studentId: true, quizId: true, passed: true, percentage: true, score: true, totalMarks: true, submittedAt: true }
        })
      : [],
    assignmentIdList.length > 0
      ? client.assignmentSubmission.findMany({
          where: { studentId, assignmentId: { in: assignmentIdList } },
          select: { studentId: true, assignmentId: true, status: true, grade: true, submittedAt: true }
        })
      : [],
    items.allConceptIds.size > 0
      ? client.conceptProgress.findMany({
          where: { studentId, conceptId: { in: Array.from(items.allConceptIds) } },
          select: { studentId: true, conceptId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    items.allSubTopicIds.size > 0
      ? client.subTopicProgress.findMany({
          where: { studentId, subTopicId: { in: Array.from(items.allSubTopicIds) } },
          select: { studentId: true, subTopicId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    items.allTopicIds.size > 0
      ? client.topicProgress.findMany({
          where: { studentId, topicId: { in: Array.from(items.allTopicIds) } },
          select: { studentId: true, topicId: true, completed: true, completedAt: true, visited: true, visitedAt: true, qualified: true, qualifiedAt: true }
        })
      : [],
    items.allLessonIds.size > 0
      ? client.lessonProgress.findMany({
          where: { studentId, lessonId: { in: Array.from(items.allLessonIds) } },
          select: { studentId: true, lessonId: true, completed: true, completedAt: true, visited: true, visitedAt: true, qualified: true, qualifiedAt: true }
        })
      : [],
    items.allModuleIds.size > 0
      ? client.moduleProgress.findMany({
          where: { studentId, moduleId: { in: Array.from(items.allModuleIds) } },
          select: { studentId: true, moduleId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : []
  ]);

  return {
    cpRecords,
    attemptRecords,
    submissionRecords,
    assignmentSubmissionRecords,
    conceptProgresses,
    subTopicProgresses,
    topicProgresses,
    lessonProgresses,
    moduleProgresses
  };
}

/**
 * Options beyond includeTree/persist:
 * - preloaded: { course, rows, qualifications } — the loaded hierarchy and
 *   this student's reads, from computeCourseProgressForStudents. Nothing is
 *   read or written; the roll-up is computed from them as is.
 */
async function computeCourseProgress(studentId, courseId, tx = null, options = {}) {
  const client = tx || prisma;
  const includeTree = options.includeTree === true;
  const preloaded = options.preloaded || null;
  let persist = options.persist !== false && !preloaded;

  // 1. The live published hierarchy, every level with its own Content rows.
  const course = preloaded ? preloaded.course : await loadPublishedHierarchy(client, courseId);

  if (!course) {
    throw new Error(`Course with ID ${courseId} not found`);
  }

  // A course with sequential learning off keeps no progress: the roll-up is
  // still computed for whoever asks, but nothing is written.
  if (course.sequentialLearning === false) persist = false;

  // 2. Every reachable item and container id.
  const items = collectCourseItems(course);
  const { allContents } = items;

  // 3. This student's ground truth and existing container rows.
  const [rows, qualifications, existingEnrollment] = preloaded
    ? [preloaded.rows, preloaded.qualifications, null]
    : await Promise.all([
        readStudentRows(client, studentId, items),
        // The lessons/topics this student has qualified out of, read from the
        // attempt log rather than stored anywhere of its own.
        getCourseQualifications(studentId, courseId, client),
        // Written at the end (progressPercent / lastAccessedAt); read here with
        // the rest instead of as one more round trip after the container writes.
        // Only this function writes `completed`/`completedAt`, under the per-key
        // lock, so reading it earlier sees the same row.
        persist
          ? client.enrollment.findUnique({
              where: { studentId_courseId: { studentId, courseId } }
            })
          : null
      ]);

  const {
    cpRecords,
    attemptRecords,
    submissionRecords,
    assignmentSubmissionRecords,
    conceptProgresses: existingConceptProgresses,
    subTopicProgresses: existingSubTopicProgresses,
    topicProgresses: existingTopicProgresses,
    lessonProgresses: existingLessonProgresses,
    moduleProgresses: existingModuleProgresses
  } = rows;
  const { qualifiedTopicIds, qualifiedLessonIds } = qualifications;

  const contentProgressMap = new Map(cpRecords.map((r) => [r.contentId, r]));
  const attemptsByQuiz = new Map();
  for (const attempt of attemptRecords) {
    if (!attemptsByQuiz.has(attempt.quizId)) attemptsByQuiz.set(attempt.quizId, []);
    attemptsByQuiz.get(attempt.quizId).push(attempt);
  }
  const submissionByQuiz = new Map(submissionRecords.map((s) => [s.quizId, s]));
  const assignmentSubmissionMap = new Map(assignmentSubmissionRecords.map((s) => [s.assignmentId, s]));

  // A. Every item's state, from the ONE completion rule. `domain*` is what the
  // Quiz/Assignment says; ContentProgress of a wrapper is synced to it below.
  const itemState = new Map();
  for (const content of allContents) {
    const cp = contentProgressMap.get(content.id) || null;
    let completed;
    let domainCompletedAt = null;
    let activity = false;
    let extra = {};

    if (content.type === 'QUIZ') {
      const attempts = attemptsByQuiz.get(content.quizId) || [];
      const latest = submissionByQuiz.get(content.quizId) || null;
      const summary = summarizeQuizAttempts(attempts, latest, content.quiz.passingScore);
      completed = isQuizComplete(content.quiz.quizTag, summary);
      activity = summary.attempted;
      if (completed) {
        const qualifying = content.quiz.quizTag === 'SELF_TEST' ? attempts : attempts.filter((a) => a.passed);
        domainCompletedAt = earliest([...qualifying.map((a) => a.submittedAt), latest?.submittedAt]);
      }
      extra = {
        attempted: summary.attempted,
        passed: summary.passed,
        score: latest?.score ?? null,
        totalMarks: latest?.totalMarks ?? null,
        percentage: latest?.percentage ?? null,
        submittedAt: latest?.submittedAt ?? null
      };
    } else if (content.type === 'ASSIGNMENT') {
      const submission = assignmentSubmissionMap.get(content.assignmentId) || null;
      completed = isAssignmentSubmissionComplete(submission);
      activity = Boolean(submission);
      domainCompletedAt = completed ? submission.submittedAt : null;
      extra = {
        submissionStatus: submission?.status ?? 'NotSubmitted',
        grade: submission?.grade ?? null,
        submittedAt: submission?.submittedAt ?? null
      };
    } else {
      completed = cp?.completed === true;
    }

    const visited = cp?.visited === true || activity;
    itemState.set(content.id, {
      completed,
      visited,
      completedAt: completed ? (cp?.completed ? cp.completedAt : domainCompletedAt) : null,
      visitedAt: visited ? (cp?.visited ? cp.visitedAt : domainCompletedAt) : null,
      domainCompletedAt,
      extra
    });
  }

  // B. Keep each QUIZ/ASSIGNMENT item's ContentProgress equal to the rule, so
  // the per-Content rows other code reads never drift from the roll-up.
  if (persist) {
    const now = new Date();
    const syncs = [];
    for (const content of allContents) {
      if (content.type !== 'QUIZ' && content.type !== 'ASSIGNMENT') continue;
      const cp = contentProgressMap.get(content.id) || null;
      const state = itemState.get(content.id);
      const needsSync =
        (cp?.completed === true) !== state.completed || (state.visited && cp?.visited !== true);
      if (!needsSync) continue;
      const row = {
        completed: state.completed,
        completedAt: state.completed ? (cp?.completed ? cp.completedAt : state.domainCompletedAt || now) : null,
        visited: state.visited || cp?.visited === true,
        visitedAt: state.visited ? (cp?.visitedAt || state.domainCompletedAt || now) : cp?.visitedAt ?? null
      };
      syncs.push(
        client.contentProgress.upsert({
          where: { studentId_contentId: { studentId, contentId: content.id } },
          create: { studentId, contentId: content.id, ...row },
          update: row
        })
      );
      state.completedAt = row.completedAt;
      state.visitedAt = row.visitedAt;
    }
    if (syncs.length > 0) await Promise.all(syncs);
  }

  const completedContentSet = new Set();
  const visitedContentSet = new Set();
  for (const [id, state] of itemState) {
    if (state.completed) completedContentSet.add(id);
    if (state.visited) visitedContentSet.add(id);
  }

  // C. Qualification completes the whole skipped subtree. A student who passed
  // a topic's/lesson's qualifying test has it -- and everything inside it --
  // counted as completed, so the skipped node, its items and every percentage
  // above it read "done" rather than "0 of N". Derived here on every roll-up
  // rather than written to ContentProgress, so no item-level activity is
  // fabricated; `qualified` still records that it was a skip.
  const completeSubtree = (entity) => {
    entity.contents.forEach((c) => completedContentSet.add(c.id));
    for (const child of entity.topics || entity.subTopics || entity.concepts || []) {
      completeSubtree(child);
    }
  };
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      if (qualifiedLessonIds.has(lesson.id)) {
        completeSubtree(lesson);
        continue;
      }
      for (const topic of lesson.topics) {
        if (qualifiedTopicIds.has(topic.id)) completeSubtree(topic);
      }
    }
  }

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
   * One container's status from its OWN items plus its applicable child
   * containers:
   *
   *   applicable = it has at least one own item or one applicable child
   *   completed  = applicable AND every own item complete
   *                          AND every applicable child satisfied
   *   visited    = everything below visited -- purely derived, never sticky
   */
  const computeContainer = (entity, children, existing, childStatus) => {
    const applicableChildren = children.filter((c) => childStatus.applicable.get(c.id) === true);

    const hasItems = entity.contents.length + applicableChildren.length > 0;

    const isCompleted =
      hasItems &&
      entity.contents.every((c) => completedContentSet.has(c.id)) &&
      // A child the student qualified out of no longer holds its parent
      // back: the student demonstrated they already knew it.
      applicableChildren.every((c) => childStatus.satisfied.get(c.id) === true);

    const isVisited =
      hasItems &&
      entity.contents.every((c) => visitedContentSet.has(c.id)) &&
      applicableChildren.every((c) => childStatus.visited.get(c.id) === true);

    return {
      applicable: hasItems,
      completed: isCompleted,
      // Preserve the ORIGINAL timestamp while the container stays complete/
      // visited -- never restamp it on a later recompute.
      completedAt: isCompleted ? (existing?.completed ? existing.completedAt : now) : null,
      visited: isVisited,
      visitedAt: isVisited ? (existing?.visited ? existing.visitedAt : now) : null
    };
  };

  /**
   * Runs one whole level. Every container depends only on its own items and
   * its own children (never a sibling), so a level's upserts are independent
   * writes flushed with one Promise.all.
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
    // Rows this student does not have yet. The first roll-up of a course
    // creates one per container (hundreds on a large course); one upsert
    // each was measured at ~6 s, so they go out as a single createMany.
    const creates = [];
    const qualifiable = qualifiedIds !== NOT_QUALIFIABLE;
    const upsertRow = (entityId, row) =>
      delegate.upsert({
        where: { [`studentId_${idField}`]: { studentId, [idField]: entityId } },
        create: { studentId, [idField]: entityId, ...row },
        update: row
      });

    for (const entity of entities) {
      const r = computeContainer(entity, childrenOf(entity), progressMap.get(entity.id), childStatus);

      // Materialized from the qualifying attempts, exactly as `completed` is
      // materialized from the container's items. qualifiedAt is the first
      // passing attempt's timestamp, so it does not move on a retake.
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
        const existing = progressMap.get(entity.id);
        // Unchanged rows are left alone — see containerRowChanged.
        if (!containerRowChanged(existing, row)) continue;
        if (existing) upserts.push(upsertRow(entity.id, row));
        else creates.push({ entityId: entity.id, row });
      }
    }

    if (creates.length > 0) {
      upserts.push(
        (async () => {
          const { count } = await delegate.createMany({
            data: creates.map(({ entityId, row }) => ({ studentId, [idField]: entityId, ...row })),
            skipDuplicates: true
          });
          // Some row appeared since it was read (another instance's roll-up):
          // write these through upsert, so the outcome is the one the
          // per-row upserts always produced — this computation's values.
          if (count < creates.length) {
            await Promise.all(creates.map(({ entityId, row }) => upsertRow(entityId, row)));
          }
        })()
      );
    }

    return { status, upserts };
  };

  const allLessonsFlat = course.modules.flatMap((m) => m.lessons);
  const allTopicsFlat = allLessonsFlat.flatMap((l) => l.topics);
  const allSubTopicsFlat = allTopicsFlat.flatMap((t) => t.subTopics || []);
  const allConceptsFlat = allSubTopicsFlat.flatMap((st) => st.concepts || []);

  // 4. Roll up bottom-up: Concept -> SubTopic -> Topic -> Lesson -> Module.
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

  // 5. Items as the tree reports them. Every item carries `contentId` (its
  // sequence identity) and `kind`; a QUIZ/ASSIGNMENT item's `id` is its
  // Quiz/Assignment id, so existing readers keyed by those ids keep working.
  const mapItem = (content) => {
    const state = itemState.get(content.id);
    const base = {
      contentId: content.id,
      type: content.type,
      order: content.order,
      visited: visitedContentSet.has(content.id),
      visitedAt: state?.visitedAt ?? null,
      completed: completedContentSet.has(content.id),
      completedAt: state?.completedAt ?? null
    };

    if (content.type === 'QUIZ') {
      return {
        ...base,
        kind: 'QUIZ',
        id: content.quizId,
        quizId: content.quizId,
        title: content.quiz.title ?? content.title,
        quizTag: content.quiz.quizTag,
        passingScore: content.quiz.passingScore,
        timeLimit: content.quiz.timeLimit,
        maxAttempts: content.quiz.attempts,
        questionCount: (content.quiz._count?.questions || 0) + (content.quiz._count?.quizQuestions || 0),
        ...state.extra
      };
    }

    if (content.type === 'ASSIGNMENT') {
      return {
        ...base,
        kind: 'ASSIGNMENT',
        id: content.assignmentId,
        assignmentId: content.assignmentId,
        title: content.assignment.title ?? content.title,
        dueDate: content.assignment.dueDate,
        marks: content.assignment.marks,
        ...state.extra
      };
    }

    return {
      ...base,
      kind: 'CONTENT',
      id: content.id,
      title: content.title,
      contentType: content.type,
      duration: content.duration
    };
  };

  // Direct (non-inherited) learning items owned by an entity, with their counts.
  const buildDirect = (entity) => {
    const items = entity.contents.map(mapItem);
    return {
      items,
      contents: items.filter((i) => i.kind === 'CONTENT'),
      quizzes: items.filter((i) => i.kind === 'QUIZ'),
      assignments: items.filter((i) => i.kind === 'ASSIGNMENT'),
      directTotalItems: items.length,
      directCompletedItems: items.filter((i) => i.completed).length,
      directVisitedItems: items.filter((i) => i.visited).length
    };
  };

  const pct = (count, total) => (total > 0 ? Math.round((count / total) * 100) : 0);

  // 6. Build the tree and roll up immediate-child denominators at every level:
  //    Parent Total Items     = Direct Items + Immediate Applicable Child Containers
  //    Parent Completed Items = Direct Completed Items + Immediate Satisfied Child Containers
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
      // always false elsewhere). Reported apart from `completed` so the player
      // can say "skipped" and not "done", while `satisfied` is the single flag
      // progression reads.
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
 * completeContent/markVisited/submissions can all be in flight for the same
 * student and course at once (an auto-visit racing a "Mark as Complete"
 * click, a double click). Each call reads ground truth and writes container
 * rows with no shared transaction, so two overlapping calls could interleave
 * and leave whichever write landed LAST from an older snapshot. A per-key
 * promise chain makes them run one at a time. Different students/courses
 * never block each other.
 *
 * Only applies when the caller owns no transaction: a caller that passes its
 * own `tx` already controls its own sequencing.
 *
 * Read-only computations (`persist: false` — the access checks behind
 * /playback/start, content-complete and visit) skip the chain: they write
 * nothing, so there is no update for them to lose, and queueing them behind
 * a concurrent persisting roll-up of the same course made a page load wait
 * for several full roll-ups in a row.
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
  if (tx || options.persist === false) return computeCourseProgress(studentId, courseId, tx, options);
  return runExclusive(`${studentId}:${courseId}`, () => computeCourseProgress(studentId, courseId, tx, options));
}

const groupByStudent = (rowList) => {
  const groups = new Map();
  for (const row of rowList) {
    if (!groups.has(row.studentId)) groups.set(row.studentId, []);
    groups.get(row.studentId).push(row);
  }
  return groups;
};

/**
 * Read-only roll-ups for many students of ONE course (the Student Directory):
 * the same result as recomputeCourseProgress(..., { persist: false }) per
 * student, but the course tree is loaded once and each read is one query for
 * all of them — a fixed ~17 queries per course instead of ~17 per student.
 * Run per (student, course) pair in parallel, a 44-enrollment directory queued
 * ~800 queries on the connection pool and starved every other request until
 * they failed with P2024 (pool timeout).
 *
 * Returns Map studentId -> roll-up. Throws when the course does not exist.
 */
async function computeCourseProgressForStudents(studentIds, courseId, options = {}) {
  const course = await loadPublishedHierarchy(prisma, courseId);
  if (!course) {
    throw new Error(`Course with ID ${courseId} not found`);
  }

  const items = collectCourseItems(course);
  const [rows, qualificationsByStudent] = await Promise.all([
    readStudentRows(prisma, { in: studentIds }, items),
    getCourseQualificationsForStudents(studentIds, courseId)
  ]);
  const grouped = Object.entries(rows).map(([key, rowList]) => [key, groupByStudent(rowList)]);

  const results = new Map();
  for (const studentId of studentIds) {
    const ownRows = Object.fromEntries(grouped.map(([key, groups]) => [key, groups.get(studentId) || []]));
    results.set(
      studentId,
      await computeCourseProgress(studentId, courseId, null, {
        includeTree: options.includeTree,
        preloaded: { course, rows: ownRows, qualifications: qualificationsByStudent.get(studentId) }
      })
    );
  }
  return results;
}

module.exports = {
  recomputeCourseProgress,
  computeCourseProgressForStudents,
  containerRowChanged
};
