const prisma = require("../../config/database");

/**
 * ONE learning sequence per parent, in the order things were added.
 *
 * Everything a parent holds takes one place in one sequence: its Content rows
 * — ordinary content, Content(type=QUIZ) and Content(type=ASSIGNMENT), which
 * is how a Quiz or an Assignment is placed — AND its child containers
 * (Module under a Course, Lesson under a Module, Topic under a Lesson,
 * SubTopic under a Topic, Concept under a SubTopic). Example, a Course:
 *
 *   1 VIDEO, 2 Module "Introduction to Java", 3 IMAGE, 4 QUIZ, 5 ASSIGNMENT,
 *   6 Module "Variables"
 *
 * The same rule holds independently at every level: Course, Module, Lesson,
 * Topic, SubTopic and Concept (a Concept has no child containers, so its
 * sequence is its Content rows alone).
 *
 * A new item is appended after the parent's last item of any kind; an item
 * inserted at position K moves every later item (content or container) down
 * one; removing an item moves every later item up one. So Content.order and a
 * container's order are always positions in the parent's one sequence.
 *
 * Quiz.order and Assignment.order are not used: a quiz/assignment's position
 * is its Content row's order.
 *
 * The members live in two tables (Content and the child container's table),
 * each with its own per-parent unique (parent, order) index, so uniqueness
 * ACROSS them is kept here: every change runs inside a transaction holding a
 * per-parent advisory lock, and rows are parked far below zero while a range
 * moves so no unique index ever sees a transient duplicate.
 */

const EMPTY_SEQUENCE_ORDER = 0;

// Most specific parent first. A Content row has exactly one parent, but Quiz
// and Assignment rows may still carry ancestor ids, so a placement is always
// read as its most specific parent.
const PARENT_FIELDS_MOST_SPECIFIC_FIRST = ["conceptId", "subTopicId", "topicId", "lessonId", "moduleId", "courseId"];
const PARENT_FIELDS = [...PARENT_FIELDS_MOST_SPECIFIC_FIRST].reverse();

// For each parent field, the parent fields below it — a Content row is in this
// parent's sequence only when all of these are null.
const DEEPER_PARENT_FIELDS = {
  courseId: ["moduleId", "lessonId", "topicId", "subTopicId", "conceptId"],
  moduleId: ["lessonId", "topicId", "subTopicId", "conceptId"],
  lessonId: ["topicId", "subTopicId", "conceptId"],
  topicId: ["subTopicId", "conceptId"],
  subTopicId: ["conceptId"],
  conceptId: [],
};

// The child container that shares each parent's sequence.
const CHILD_KIND_OF_PARENT = {
  courseId: "module",
  moduleId: "lesson",
  lessonId: "topic",
  topicId: "subTopic",
  subTopicId: "concept",
  conceptId: null,
};

// Container -> the field naming its parent.
const CONTAINER_PARENT_FIELD = {
  module: "courseId",
  lesson: "moduleId",
  topic: "lessonId",
  subTopic: "topicId",
  concept: "subTopicId",
};

const QUIZ_CONTENT_TYPE = "QUIZ";
const ASSIGNMENT_CONTENT_TYPE = "ASSIGNMENT";
const ASSESSMENT_CONTENT_TYPES = new Set([QUIZ_CONTENT_TYPE, ASSIGNMENT_CONTENT_TYPE]);

/** True for a Content row that wraps a Quiz or an Assignment. */
const isAssessmentContent = (row) => ASSESSMENT_CONTENT_TYPES.has(row?.type);

const PARK_OFFSET = 1_000_000_000;
const PARKED_BELOW = -500_000_000;

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function assertParentField(parentField) {
  if (!Object.prototype.hasOwnProperty.call(DEEPER_PARENT_FIELDS, parentField)) {
    throw new Error(`Unknown sequence parent field: ${parentField}`);
  }
}

/** The most specific parent id field set on a row (conceptId > … > courseId), or undefined. */
function mostSpecificParentField(row) {
  return PARENT_FIELDS_MOST_SPECIFIC_FIRST.find((field) => row?.[field]);
}

/**
 * The single-parent placement for a Content row standing for `entity` (a Quiz
 * or Assignment, which may carry ancestor ids): only its most specific parent
 * is set, every other parent field is null.
 */
function singleParentPlacement(entity) {
  const parentField = mostSpecificParentField(entity);
  if (!parentField) return null;
  const data = {};
  for (const field of PARENT_FIELDS) data[field] = field === parentField ? entity[parentField] : null;
  return { parentField, parentId: entity[parentField], data };
}

/**
 * The tables that hold one parent's sequence, each with the filter selecting
 * that parent's rows: its own Content rows, and its child containers.
 */
function sequenceMembers(parentField, parentId) {
  assertParentField(parentField);
  if (!parentId) throw new Error(`A sequence needs a ${parentField}`);
  const ownContent = { [parentField]: parentId };
  for (const deeper of DEEPER_PARENT_FIELDS[parentField]) ownContent[deeper] = null;

  const members = [{ kind: "content", delegate: "content", where: ownContent }];
  const childKind = CHILD_KIND_OF_PARENT[parentField];
  if (childKind) members.push({ kind: childKind, delegate: childKind, where: { [parentField]: parentId } });
  return members;
}

/** The parent whose sequence a container belongs to. */
function containerParent(kind, row) {
  const parentField = CONTAINER_PARENT_FIELD[kind];
  if (!parentField) throw new Error(`Unknown container kind: ${kind}`);
  return { parentField, parentId: row?.[parentField] };
}

/**
 * Serializes changes to one parent's sequence until the surrounding
 * transaction ends. A no-op for a client without raw query support (the
 * in-memory test fake).
 */
async function lockParentSequence(client, parentField, parentId) {
  if (typeof client?.$queryRaw !== "function") return;
  const key = `sequence:${parentField}:${parentId}`;
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
}

/** The highest order in a parent's sequence across Content and child containers, or EMPTY_SEQUENCE_ORDER. */
async function getLastOrder(parentField, parentId, client = prisma) {
  let last = EMPTY_SEQUENCE_ORDER;
  for (const member of sequenceMembers(parentField, parentId)) {
    const result = await client[member.delegate].aggregate({ where: member.where, _max: { order: true } });
    const value = result?._max?.order;
    if (typeof value === "number" && value > last) last = value;
  }
  return last;
}

/** The order an appended item takes: one past the parent's last item of any kind. */
async function getNextOrder(parentField, parentId, client = prisma) {
  return (await getLastOrder(parentField, parentId, client)) + 1;
}

/**
 * Moves every member of a parent's sequence whose order is >= `fromOrder` by
 * `delta` (+1 opens a slot, -1 closes one), in both tables. Parked first, so
 * the unique indexes never see two rows on one position.
 */
async function shiftRange(parentField, parentId, fromOrder, delta, client) {
  const members = sequenceMembers(parentField, parentId);
  for (const member of members) {
    await client[member.delegate].updateMany({
      where: { ...member.where, order: { gte: fromOrder } },
      data: { order: { decrement: PARK_OFFSET } },
    });
  }
  for (const member of members) {
    await client[member.delegate].updateMany({
      where: { ...member.where, order: { lt: PARKED_BELOW } },
      data: { order: { increment: PARK_OFFSET + delta } },
    });
  }
}

/** A requested position must be a whole number; callers pass it straight from the API. */
function assertIntegerOrder(requestedOrder) {
  const requested = Number(requestedOrder);
  if (!Number.isInteger(requested)) throw badRequest("order must be an integer.");
  return requested;
}

const hasRequestedOrder = (requestedOrder) =>
  requestedOrder !== undefined && requestedOrder !== null && requestedOrder !== "";

/**
 * Resolves the position a new item (Content row or child container) takes in
 * its parent's sequence and makes room for it:
 *  - no requested order: appended after the last item of any kind;
 *  - requested K: inserted at K (clamped to 1..last+1); every later item of
 *    any kind moves down one.
 * Must run inside a transaction; takes the sequence lock itself.
 * @returns {Promise<number>} the order the new row must be created with
 */
async function claimSequenceOrder(parentField, parentId, requestedOrder, client) {
  await lockParentSequence(client, parentField, parentId);
  const next = await getNextOrder(parentField, parentId, client);
  if (!hasRequestedOrder(requestedOrder)) return next;

  const requested = assertIntegerOrder(requestedOrder);
  const position = Math.min(Math.max(requested, 1), next);
  if (position < next) await shiftRange(parentField, parentId, position, +1, client);
  return position;
}

/**
 * Closes the slot a removed item held: every later item of any kind moves up
 * one. Call after the row is deleted, in the same transaction.
 */
async function releaseSequenceOrder(parentField, parentId, removedOrder, client) {
  if (!parentField || !parentId || typeof removedOrder !== "number") return;
  await lockParentSequence(client, parentField, parentId);
  await shiftRange(parentField, parentId, removedOrder + 1, -1, client);
}

/** A parent's sequence members in their current order, tagged with their table. */
async function loadSequence(parentField, parentId, client) {
  const rows = [];
  for (const member of sequenceMembers(parentField, parentId)) {
    const found = await client[member.delegate].findMany({
      where: member.where,
      select: { id: true, order: true, createdAt: true },
    });
    for (const row of found) rows.push({ ...row, delegate: member.delegate });
  }
  // A Content row and a container on the same position (legacy data) keep a
  // stable order: Content first, then insertion time.
  const rank = (row) => (row.delegate === "content" ? 0 : 1);
  return rows.sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      rank(a) - rank(b) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/**
 * Rewrites a parent's sequence to exactly `orderedIds` (Content and container
 * ids alike), numbered 1..n. The ids must be the parent's current members,
 * each exactly once — anything else is a 400.
 */
async function applySequenceOrdering(parentField, parentId, orderedIds, client) {
  await lockParentSequence(client, parentField, parentId);
  const rows = await loadSequence(parentField, parentId, client);
  const byId = new Map(rows.map((row) => [row.id, row]));

  if (new Set(orderedIds).size !== orderedIds.length) throw badRequest("A reorder may not list an item twice.");
  if (orderedIds.length !== rows.length || orderedIds.some((id) => !byId.has(id))) {
    throw badRequest("A reorder must list exactly the items of one parent.");
  }

  const changes = orderedIds
    .map((id, index) => ({ id, order: index + 1, delegate: byId.get(id).delegate }))
    .filter((change) => byId.get(change.id).order !== change.order);
  if (changes.length === 0) return orderedIds.map((id, index) => ({ id, order: index + 1 }));

  // Park only the rows that move, then write their final positions.
  for (const delegate of new Set(changes.map((change) => change.delegate))) {
    await client[delegate].updateMany({
      where: { id: { in: changes.filter((change) => change.delegate === delegate).map((change) => change.id) } },
      data: { order: { decrement: PARK_OFFSET } },
    });
  }
  for (const change of changes) {
    await client[change.delegate].update({ where: { id: change.id }, data: { order: change.order } });
  }
  return orderedIds.map((id, index) => ({ id, order: index + 1 }));
}

/**
 * Moves some members of a parent's sequence to requested 1-based positions;
 * every other member keeps its relative order. `moves` is [{ id, order }] —
 * Content or container ids — the shape the Course Map sends for a swap. The
 * result is always a gap-free 1..n sequence.
 */
async function moveSequenceItems(parentField, parentId, moves, client) {
  if (!Array.isArray(moves) || moves.length === 0) return [];
  await lockParentSequence(client, parentField, parentId);
  const rows = await loadSequence(parentField, parentId, client);
  const memberIds = new Set(rows.map((row) => row.id));

  const movedIds = new Set();
  for (const move of moves) {
    if (!move?.id || !memberIds.has(move.id)) throw badRequest("A reorder may only move items of one parent.");
    if (movedIds.has(move.id)) throw badRequest("A reorder may not list an item twice.");
    movedIds.add(move.id);
    assertIntegerOrder(move.order);
  }

  const currentIndex = new Map(rows.map((row, index) => [row.id, index]));
  const result = rows.filter((row) => !movedIds.has(row.id)).map((row) => row.id);
  const ordered = [...moves].sort(
    (a, b) => Number(a.order) - Number(b.order) || currentIndex.get(a.id) - currentIndex.get(b.id)
  );
  for (const move of ordered) {
    const index = Math.min(Math.max(Number(move.order) - 1, 0), result.length);
    result.splice(index, 0, move.id);
  }

  return applySequenceOrdering(parentField, parentId, result, client);
}

// --- Content rows ------------------------------------------------------------

const claimContentOrder = (parentField, parentId, requestedOrder, client) =>
  claimSequenceOrder(parentField, parentId, requestedOrder, client);

/** Closes a removed Content row's slot in its parent's sequence. */
const releaseContentOrder = (row, client) => {
  const parentField = mostSpecificParentField(row);
  if (!parentField) return Promise.resolve();
  return releaseSequenceOrder(parentField, row[parentField], row.order, client);
};

const getNextContentOrder = (parentField, parentId, client = prisma) => getNextOrder(parentField, parentId, client);

// --- Child containers ----------------------------------------------------------

/** Position for a new container in its parent's sequence (e.g. a Topic in its Lesson's). */
const claimContainerOrder = (kind, parentId, requestedOrder, client) =>
  claimSequenceOrder(CONTAINER_PARENT_FIELD[kind], parentId, requestedOrder, client);

const releaseContainerOrder = (kind, parentId, removedOrder, client) =>
  releaseSequenceOrder(CONTAINER_PARENT_FIELD[kind], parentId, removedOrder, client);

/** Reorders containers within their parent's sequence; Content rows keep their relative order. */
const moveContainers = (kind, parentId, moves, client) =>
  moveSequenceItems(CONTAINER_PARENT_FIELD[kind], parentId, moves, client);

module.exports = {
  EMPTY_SEQUENCE_ORDER,
  PARENT_FIELDS,
  PARENT_FIELDS_MOST_SPECIFIC_FIRST,
  DEEPER_PARENT_FIELDS,
  CHILD_KIND_OF_PARENT,
  CONTAINER_PARENT_FIELD,
  QUIZ_CONTENT_TYPE,
  ASSIGNMENT_CONTENT_TYPE,
  ASSESSMENT_CONTENT_TYPES,
  isAssessmentContent,
  mostSpecificParentField,
  singleParentPlacement,
  sequenceMembers,
  containerParent,
  lockParentSequence,
  getLastOrder,
  getNextOrder,
  claimSequenceOrder,
  releaseSequenceOrder,
  applySequenceOrdering,
  moveSequenceItems,
  claimContentOrder,
  releaseContentOrder,
  getNextContentOrder,
  claimContainerOrder,
  releaseContainerOrder,
  moveContainers,
};
