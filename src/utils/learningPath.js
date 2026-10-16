/**
 * The student's path through a course at module / lesson / topic granularity,
 * with the qualifying-test (skip) offers that hang off lessons and topics.
 *
 * It does NOT have a locking rule of its own. Whether a node is locked, and
 * which node is CURRENT, is read off the learning sequence
 * (utils/learningSequence.js) — the same steps the player walks and the API
 * enforces — so the path, the player and the access checks are one decision:
 *
 *   - a node is LOCKED when its first step is locked (the student cannot
 *     enter it yet);
 *   - the CURRENT node is the deepest module/lesson/topic holding the
 *     student's current step (the first incomplete one);
 *   - a node with no steps (`applicable === false`, e.g. an empty topic) is
 *     transparent: never locked, never current.
 *
 * "Settled" is completed OR qualified — passing a lesson's qualifying test
 * lets the student past it exactly as finishing it would.
 */
const { buildLearningSequence, flattenContainers } = require("./learningSequence");

/** What a node is, from the student's point of view. */
const PATH_STATUS = {
  COMPLETED: "COMPLETED",
  QUALIFIED: "QUALIFIED",
  CURRENT: "CURRENT",
  AVAILABLE: "AVAILABLE",
  LOCKED: "LOCKED"
};

/**
 * Flattens the roll-up hierarchy into the ordered list of gate nodes —
 * modules, lessons and topics, each immediately followed by its children.
 */
const flattenGateNodes = (hierarchy) => {
  const nodes = [];
  if (!hierarchy) return nodes;

  for (const mod of hierarchy.modules || []) {
    nodes.push({ kind: "MODULE", id: mod.id, title: mod.title, node: mod, moduleId: mod.id, lessonId: null, topicId: null });
    for (const lesson of mod.lessons || []) {
      nodes.push({ kind: "LESSON", id: lesson.id, title: lesson.title, node: lesson, moduleId: mod.id, lessonId: lesson.id, topicId: null });
      for (const topic of lesson.topics || []) {
        nodes.push({ kind: "TOPIC", id: topic.id, title: topic.title, node: topic, moduleId: mod.id, lessonId: lesson.id, topicId: topic.id });
      }
    }
  }

  return nodes;
};

/** True when a node no longer stands between the student and what follows it. */
const isSettled = (node) => {
  if (!node) return true;
  if (node.applicable === false) return true;
  return node.satisfied === true || node.completed === true;
};

/**
 * The ordered learning path for one student and course.
 *
 * @param {object} hierarchy  `hierarchy` from computeCourseProgress({ includeTree: true }).
 * @param {object} qualifyingQuizzes  from getCourseQualifyingQuizzes().
 * @param {object} [sequence] buildLearningSequence(hierarchy) — pass it when
 *   the caller already built one, so it is not built twice.
 * @returns {Array} one entry per gate node, in course order.
 */
const buildLearningPath = (
  hierarchy,
  qualifyingQuizzes = { byTopicId: new Map(), byLessonId: new Map() },
  sequence = buildLearningSequence(hierarchy)
) => {
  const gateNodes = flattenGateNodes(hierarchy);
  const sequenceNodeById = new Map(
    flattenContainers(sequence.tree)
      .filter((node) => node.kind !== "COURSE")
      .map((node) => [node.id, node])
  );

  const currentStep = sequence.currentIndex >= 0 ? sequence.steps[sequence.currentIndex] : null;
  const currentIncomplete = currentStep && !currentStep.completed ? currentStep : null;
  const currentNodeId = currentIncomplete
    ? currentIncomplete.path.topicId || currentIncomplete.path.lessonId || currentIncomplete.path.moduleId || null
    : null;

  return gateNodes.map((entry) => {
    const { node, kind } = entry;
    const settled = isSettled(node);
    const qualified = node.qualified === true;
    const locked = sequenceNodeById.get(entry.id)?.locked === true;

    // A qualified node is completed by the roll-up (its whole subtree counts as
    // done), so it reads COMPLETED; QUALIFIED is left only for a qualified node
    // with nothing in it to complete. `qualified` still records the skip.
    let status;
    if (node.completed === true) status = PATH_STATUS.COMPLETED;
    else if (qualified) status = PATH_STATUS.QUALIFIED;
    else if (locked) status = PATH_STATUS.LOCKED;
    else if (entry.id === currentNodeId) status = PATH_STATUS.CURRENT;
    else status = PATH_STATUS.AVAILABLE;

    // Only a lesson or topic can be skipped, and only while it is actually in
    // the student's way: something finished or qualified has nothing left to
    // skip, and something still locked is not their current problem.
    const qualifyingQuiz =
      kind === "TOPIC"
        ? qualifyingQuizzes.byTopicId.get(entry.id)
        : kind === "LESSON"
          ? qualifyingQuizzes.byLessonId.get(entry.id)
          : undefined;

    // A skip is only on offer if the student could actually still take the
    // test (`canAttempt` is undefined when no studentId was supplied).
    const skippable =
      Boolean(qualifyingQuiz) &&
      !settled &&
      !locked &&
      node.applicable !== false &&
      qualifyingQuiz.canAttempt !== false;

    return {
      kind,
      id: entry.id,
      title: entry.title,
      moduleId: entry.moduleId,
      lessonId: entry.lessonId,
      topicId: entry.topicId,
      status,
      locked,
      completed: node.completed === true,
      qualified,
      qualifiedAt: node.qualifiedAt ?? null,
      satisfied: settled,
      applicable: node.applicable !== false,
      progressPercent: node.progressPercent ?? 0,
      totalItems: node.totalItems ?? 0,
      completedItems: node.completedItems ?? 0,
      skippable,
      qualifyingQuiz: qualifyingQuiz
        ? {
            id: qualifyingQuiz.id,
            title: qualifyingQuiz.title,
            passingScore: qualifyingQuiz.passingScore,
            attempts: qualifyingQuiz.attempts,
            timeLimit: qualifyingQuiz.timeLimit,
            questionCount: qualifyingQuiz.questionCount
          }
        : null
    };
  });
};

/**
 * Whether the student may open one lesson/topic right now, and why not.
 */
const resolveAccess = (path, { lessonId = null, topicId = null } = {}) => {
  const targetId = topicId || lessonId;
  if (!targetId) return { allowed: true, entry: null, reason: null };

  const entry = path.find((p) => p.id === targetId);
  // A node that isn't a gate node in this course (an id from elsewhere, or
  // unpublished) is not something this function can vouch for; the caller's
  // own existence/ownership checks still apply.
  if (!entry) return { allowed: true, entry: null, reason: null };

  if (!entry.locked) return { allowed: true, entry, reason: null };

  return {
    allowed: false,
    entry,
    reason: `Finish the earlier ${entry.kind === "TOPIC" ? "topics" : "lessons"} in this course before opening “${entry.title}”.`
  };
};

/** The next thing the student should be doing, or null when nothing is left. */
const resolveNextItem = (path) =>
  path.find((entry) => entry.status === PATH_STATUS.CURRENT) || null;

module.exports = {
  PATH_STATUS,
  flattenGateNodes,
  isSettled,
  buildLearningPath,
  resolveAccess,
  resolveNextItem
};
