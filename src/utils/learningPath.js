/**
 * The student's ordered path through a course, and what they may open.
 *
 * Sequential progression already existed in the browser: the learn page walks
 * an ordered unit list and refuses to cross out of a node that isn't finished.
 * This is the same rule computed on the server, from the same roll-up
 * hierarchy, so the decision the UI renders and the decision the API enforces
 * are one decision rather than two that can disagree. A client that skips the
 * check, or calls the API directly, gets the same answer.
 *
 * The rule, unchanged from the player's: walking the course in order, a node
 * is UNLOCKED while everything before it is settled, and every node from the
 * first unsettled one onward is LOCKED. "Settled" is completed OR qualified —
 * passing a lesson's qualifying test lets the student past it exactly as
 * finishing it would, which is the whole point of Phase 2.
 *
 * Nodes with nothing to track (`applicable === false`, e.g. an empty topic)
 * are transparent: they neither block nor need finishing, mirroring
 * progressRollup's own rule that empty containers don't hold up a parent.
 */

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
 * modules, lessons and topics, each immediately followed by its children, so
 * index order IS course order. Contents and quizzes are not gate nodes: they
 * are gated by the lesson/topic that owns them.
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

/**
 * True when a node no longer stands between the student and what follows it.
 *
 * A container (module/lesson) whose children are all settled is itself
 * settled even if its own roll-up hasn't caught up — the roll-up already
 * computes that, but reading `satisfied` here keeps this independent of when
 * the roll-up last ran.
 */
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
 * @returns {Array} one entry per gate node, in course order.
 */
const buildLearningPath = (hierarchy, qualifyingQuizzes = { byTopicId: new Map(), byLessonId: new Map() }) => {
  const gateNodes = flattenGateNodes(hierarchy);

  // A container is unfinished precisely BECAUSE its children are, so it must
  // never gate its own descendants — otherwise a module would lock the very
  // lessons that would complete it, and a course could never be started.
  // Only unfinished work the student has genuinely passed over blocks them.
  const isAncestorOf = (a, b) => {
    if (a.kind === "MODULE") return b.kind !== "MODULE" && b.moduleId === a.id;
    if (a.kind === "LESSON") return b.kind === "TOPIC" && b.lessonId === a.id;
    return false;
  };

  // A node inside a QUALIFIED container is not outstanding work. This is what
  // makes a skip actually worth anything: a student who qualified out of a
  // lesson never touched its topics, so those topics stay individually
  // incomplete forever — and if they still counted as unfinished they would
  // block everything after the lesson, and the skip would have bought nothing.
  //
  // Only `qualified` containers, not merely settled ones: a COMPLETED lesson
  // already implies its topics are complete (the roll-up cannot mark it
  // otherwise), so widening this to every settled container would have no
  // legitimate effect and would quietly excuse genuinely unfinished work.
  const byId = new Map(gateNodes.map((entry) => [entry.id, entry]));
  const inQualifiedContainer = (entry) => {
    const lesson = entry.kind === "TOPIC" ? byId.get(entry.lessonId) : null;
    if (lesson?.node?.qualified === true) return true;
    const mod = entry.kind !== "MODULE" ? byId.get(entry.moduleId) : null;
    return mod?.node?.qualified === true;
  };

  const isOutstanding = (entry) => !isSettled(entry.node) && !inQualifiedContainer(entry);

  const unsettledIndices = gateNodes
    .map((entry, index) => (isOutstanding(entry) ? index : -1))
    .filter((index) => index !== -1);

  // The earliest unfinished node that is not one of this node's own ancestors
  // — i.e. the work actually standing between the student and this node.
  const blockingIndexFor = (entry, index) => {
    for (const candidate of unsettledIndices) {
      if (candidate >= index) return -1;
      if (!isAncestorOf(gateNodes[candidate], entry)) return candidate;
    }
    return -1;
  };

  // Where the student is: the first unfinished node that isn't merely the
  // container of other unfinished work. Descendants follow their container
  // immediately, so it is enough to ask whether the next unfinished node is
  // inside this one.
  const currentIndex = unsettledIndices.find((index, position) => {
    const next = unsettledIndices[position + 1];
    return next === undefined || !isAncestorOf(gateNodes[index], gateNodes[next]);
  });

  return gateNodes.map((entry, index) => {
    const { node, kind } = entry;
    const settled = isSettled(node);
    const qualified = node.qualified === true;

    // A settled node always stays open, so earlier material can be reviewed
    // and a skipped lesson can still be opened later. A topic inside a
    // skipped lesson stays open too — skipped is not deleted, and the student
    // may want to read it after all.
    const locked = isOutstanding(entry) && blockingIndexFor(entry, index) !== -1;

    let status;
    if (qualified) status = PATH_STATUS.QUALIFIED;
    else if (node.completed === true) status = PATH_STATUS.COMPLETED;
    else if (locked) status = PATH_STATUS.LOCKED;
    else if (index === currentIndex) status = PATH_STATUS.CURRENT;
    else status = PATH_STATUS.AVAILABLE;

    // Only a lesson or topic can be skipped, and only while it is actually in
    // the student's way: something already finished or already qualified has
    // nothing left to skip, and something still locked is not their current
    // problem. A quiz with no questions never reaches this map.
    const qualifyingQuiz =
      kind === "TOPIC"
        ? qualifyingQuizzes.byTopicId.get(entry.id)
        : kind === "LESSON"
          ? qualifyingQuizzes.byLessonId.get(entry.id)
          : undefined;

    // A skip is only on offer if the student could actually still take the
    // test. Without the last clause a student who has spent the allowance was
    // still invited to "take a short qualifying test to skip this", and only
    // found out it was spent after clicking through — an invitation the system
    // had already decided to refuse.
    //
    // `canAttempt` is undefined when the caller supplied no studentId (see
    // getCourseQualifyingQuizzes), and `!== false` keeps those callers on
    // exactly the behaviour they had.
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
      // Whether a qualifying test is on offer here, and which one. Null keeps
      // "no skip available" and "skip available" a single field to read.
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
 * The single check every access-controlled path calls, so "can they be here?"
 * has exactly one answer in the codebase.
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
