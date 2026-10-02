/**
 * THE student learning sequence.
 *
 * One ordered list of steps per course, built from Content rows only. The
 * player's Prev/Next, the Course Map, resume, the progress gates and the
 * server's access checks all read this one structure, so they cannot
 * disagree about what comes next.
 *
 * Input is the progress roll-up's hierarchy (utils/progressRollup.js), whose
 * every container carries `items`: its own Content rows — ordinary content,
 * Content(type=QUIZ) and Content(type=ASSIGNMENT) — already published-filtered
 * and stamped with the single completion rule (utils/itemCompletion.js).
 *
 * ORDER inside one container
 *   One sequence per container, in the order things were added: its Content
 *   rows (ordinary content, quizzes, assignments) and its child containers
 *   share it (contents/contentOrder.util.js), so the entries are simply sorted
 *   by that shared order — at every level, Course down to Concept.
 *
 * DOCUMENTS
 *   Consecutive untitled HTML rows of one container are one step (imported
 *   lectures store every paragraph as its own row). A merge never crosses a
 *   quiz, an assignment or a container boundary.
 *
 * LOCKS (linear)
 *   A step is open while every step before it is complete; from the first
 *   incomplete step on, later steps are locked — except steps the student has
 *   already visited, which never re-lock (adding a new item to an earlier
 *   lesson must not shut a student out of material they were already in).
 *   A lesson/topic the student qualified out of counts as complete (the
 *   roll-up marks its items complete).
 */

const { completionHint } = require("./itemCompletion");

const CHILD_KEY = { COURSE: "modules", MODULE: "lessons", LESSON: "topics", TOPIC: "subTopics", SUBTOPIC: "concepts", CONCEPT: null };
const CHILD_KIND = { COURSE: "MODULE", MODULE: "LESSON", LESSON: "TOPIC", TOPIC: "SUBTOPIC", SUBTOPIC: "CONCEPT" };
const PATH_FIELD = { MODULE: "moduleId", LESSON: "lessonId", TOPIC: "topicId", SUBTOPIC: "subTopicId", CONCEPT: "conceptId" };
const LEVEL = { COURSE: "course", MODULE: "module", LESSON: "lesson", TOPIC: "topic", SUBTOPIC: "subTopic", CONCEPT: "concept" };
const PARENT_FIELD_OF_KIND = { COURSE: "courseId", ...PATH_FIELD };

const EMPTY_PATH = Object.freeze({ moduleId: null, lessonId: null, topicId: null, subTopicId: null, conceptId: null });

// Body columns a step carries when the student may open it.
const BODY_FIELDS = ["videoUrl", "fileUrl", "htmlContent", "externalUrl", "duration", "data"];

/** Mirrors the player's long-standing rule: an HTML row that is really just an image is its own block. */
function isHtmlImage(row) {
  if (!row) return false;
  const type = String(row.type || "").toUpperCase();
  if (type === "IMAGE") return true;
  if (type === "HTML" && row.htmlContent) {
    return (
      row.htmlContent.includes("cc-image-block") ||
      /<figure[^>]*class="[^"]*cc-image-block[^"]*"/i.test(row.htmlContent) ||
      /<img\s+/i.test(row.htmlContent)
    );
  }
  return false;
}

/** The ordered entries of one container — see ORDER above. */
function orderContainerEntries(items = [], children = []) {
  const entries = [
    ...items.map((item) => ({ type: "item", item, order: item.order, rank: 0 })),
    ...children.map((node) => ({ type: "container", node, order: node.order, rank: 1 })),
  ];
  // Positions are unique within a parent; a legacy tie keeps Content first.
  entries.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.rank - b.rank);
  return entries.map(({ type, item, node }) => (type === "item" ? { type, item } : { type, node }));
}

const nodeStatus = (node) => ({
  completed: node?.completed === true,
  qualified: node?.qualified === true,
  satisfied: node?.satisfied === true || node?.completed === true,
  applicable: node?.applicable !== false,
  progressPercent: node?.progressPercent ?? 0,
  totalItems: node?.totalItems ?? 0,
  completedItems: node?.completedItems ?? 0,
});

function newStep(raw, index, bodies) {
  const { item, path, containerKind, containerId } = raw;
  const body = bodies?.get(item.contentId) || null;
  return {
    index,
    contentId: item.contentId,
    contentIds: [item.contentId],
    kind: item.kind,
    type: item.type,
    title: item.title ?? null,
    order: item.order,
    quizId: item.quizId ?? null,
    assignmentId: item.assignmentId ?? null,
    quizTag: item.quizTag ?? null,
    passingScore: item.passingScore ?? null,
    questionCount: item.questionCount ?? null,
    timeLimit: item.timeLimit ?? null,
    maxAttempts: item.maxAttempts ?? null,
    dueDate: item.dueDate ?? null,
    marks: item.marks ?? null,
    level: LEVEL[containerKind],
    containerId,
    path: { ...path },
    completed: item.completed === true,
    visited: item.visited === true,
    attempted: item.attempted === true,
    submissionStatus: item.submissionStatus ?? null,
    completionHint: completionHint(item.kind, item.quizTag),
    body: body ? Object.fromEntries(BODY_FIELDS.map((field) => [field, body[field] ?? null])) : null,
    _mergeable: item.kind === "CONTENT" && item.type === "HTML" && !isHtmlImage(body || item),
  };
}

function canMergeIntoDocument(step, raw, bodies) {
  if (!step._mergeable) return false;
  const { item } = raw;
  if (item.kind !== "CONTENT" || item.type !== "HTML") return false;
  if (item.title && String(item.title).trim()) return false;
  if (isHtmlImage(bodies?.get(item.contentId) || item)) return false;
  return step.containerId === raw.containerId && step.level === LEVEL[raw.containerKind];
}

function mergeIntoDocument(step, raw, bodies) {
  const { item } = raw;
  step.contentIds.push(item.contentId);
  step.completed = step.completed && item.completed === true;
  step.visited = step.visited && item.visited === true;
  const html = bodies?.get(item.contentId)?.htmlContent;
  if (step.body && html) step.body.htmlContent = [step.body.htmlContent, html].filter(Boolean).join("\n");
}

/**
 * Builds the course's learning sequence.
 *
 * @param {object} hierarchy roll-up hierarchy (computeCourseProgress includeTree)
 * @param {{ bodies?: Map<string, object> }} [options] Content body columns by
 *   id, for document merging and for the steps the student may open.
 * @returns {{ steps: object[], tree: object, currentIndex: number, resumeIndex: number }}
 */
function buildLearningSequence(hierarchy, { bodies = null } = {}) {
  const raws = [];
  const containerSpans = []; // [{ treeNode, firstRaw, lastRaw }]

  const visit = (node, kind, path) => {
    const childKey = CHILD_KEY[kind];
    const children = childKey ? node?.[childKey] || [] : [];
    const firstRaw = raws.length;
    const entries = [];

    for (const entry of orderContainerEntries(node?.items || [], children)) {
      if (entry.type === "item") {
        entries.push({ type: "step", rawIndex: raws.length });
        raws.push({ item: entry.item, path, containerKind: kind, containerId: node.id });
      } else {
        const childKind = CHILD_KIND[kind];
        const childPath = { ...path, [PATH_FIELD[childKind]]: entry.node.id };
        entries.push({ type: "container", node: visit(entry.node, childKind, childPath) });
      }
    }

    const treeNode = {
      kind,
      level: LEVEL[kind],
      id: node?.id ?? null,
      title: node?.title ?? null,
      order: node?.order ?? null,
      path: kind === "COURSE" ? { ...EMPTY_PATH } : { ...path },
      ...nodeStatus(node),
      entries,
    };
    containerSpans.push({ treeNode, firstRaw, lastRaw: raws.length - 1 });
    return treeNode;
  };

  const tree = visit(hierarchy || {}, "COURSE", { ...EMPTY_PATH });

  // Raw items -> steps, merging documents.
  const steps = [];
  const stepOfRaw = [];
  for (const raw of raws) {
    const previous = steps[steps.length - 1];
    if (previous && canMergeIntoDocument(previous, raw, bodies)) {
      mergeIntoDocument(previous, raw, bodies);
      stepOfRaw.push(previous.index);
      continue;
    }
    const step = newStep(raw, steps.length, bodies);
    steps.push(step);
    stepOfRaw.push(step.index);
  }

  // Locks: linear by completion; visited steps never re-lock.
  let firstIncomplete = -1;
  for (const step of steps) {
    step.locked = firstIncomplete !== -1 && !step.visited;
    step.blockedByIndex = step.locked ? firstIncomplete : null;
    if (!step.completed && firstIncomplete === -1) firstIncomplete = step.index;
    delete step._mergeable;
  }

  // Tree entries reference steps, not raw rows; a merged document appears once.
  const remap = (node) => {
    const entries = [];
    for (const entry of node.entries) {
      if (entry.type === "step") {
        const stepIndex = stepOfRaw[entry.rawIndex];
        const last = entries[entries.length - 1];
        if (!(last?.type === "step" && last.stepIndex === stepIndex)) entries.push({ type: "step", stepIndex });
      } else {
        entries.push({ type: "container", node: remap(entry.node) });
      }
    }
    node.entries = entries;
    return node;
  };
  remap(tree);

  for (const { treeNode, firstRaw, lastRaw } of containerSpans) {
    const hasSteps = lastRaw >= firstRaw;
    treeNode.firstStepIndex = hasSteps ? stepOfRaw[firstRaw] : null;
    treeNode.lastStepIndex = hasSteps ? stepOfRaw[lastRaw] : null;
    treeNode.locked = hasSteps ? steps[treeNode.firstStepIndex].locked === true : false;
  }

  // Locked steps never carry their material.
  for (const step of steps) {
    if (step.locked) step.body = null;
  }

  const currentIndex = firstIncomplete === -1 ? Math.max(steps.length - 1, 0) : firstIncomplete;
  return { steps, tree, currentIndex: steps.length ? currentIndex : -1, resumeIndex: resolveResumeIndex(steps) };
}

/**
 * Where "Continue learning" lands — the same promise the player always made:
 *   the last visited step if it is still incomplete; the step after it if it
 *   is complete; the first step for a student who has visited nothing; the
 *   last step once the whole course is done. A target that is locked falls
 *   back to the first incomplete step, the one the student can actually do.
 */
function resolveResumeIndex(steps) {
  if (!steps.length) return -1;
  let lastVisited = -1;
  for (const step of steps) if (step.visited) lastVisited = step.index;

  let target;
  if (lastVisited === -1) target = 0;
  else if (!steps[lastVisited].completed) target = lastVisited;
  else target = Math.min(lastVisited + 1, steps.length - 1);

  if (steps[target].locked) {
    const firstIncomplete = steps.find((step) => !step.completed);
    target = firstIncomplete ? firstIncomplete.index : target;
  }
  return target;
}

/** The step a Content row (or a merged document containing it) belongs to, or null. */
function findStepForContent(sequence, contentId) {
  if (!contentId) return null;
  return sequence.steps.find((step) => step.contentIds.includes(contentId)) || null;
}

/** Every container node of the tree, depth-first. */
function flattenContainers(tree) {
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    for (const entry of node.entries) if (entry.type === "container") walk(entry.node);
  };
  if (tree) walk(tree);
  return nodes;
}

module.exports = {
  LEVEL,
  PARENT_FIELD_OF_KIND,
  isHtmlImage,
  orderContainerEntries,
  buildLearningSequence,
  resolveResumeIndex,
  findStepForContent,
  flattenContainers,
};
