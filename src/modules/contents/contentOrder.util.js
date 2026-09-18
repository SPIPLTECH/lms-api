const prisma = require("../../config/database");

/**
 * ONE common sequence per parent.
 *
 * Every item that belongs to the same parent — its Content, Quiz and
 * Assignment rows AND its child hierarchy entity (Module under a Course,
 * Lesson under a Module, Topic under a Lesson, SubTopic under a Topic,
 * Concept under a SubTopic) — shares a single `order` sequence, in the order
 * the items were added:
 *
 *   Module: 1 Content-1, 2 Content-2, 3 Quiz-1, 4 Content-3, 5 Content-4,
 *           6 Quiz-2, 7 Assignment-1, 8 Lesson-1, 9 Lesson-2, 10 Content-5
 *
 * There are no per-type counters and no per-type number bands: a new item is
 * appended after the parent's last item of ANY type, an item inserted at a
 * position moves every later item of ANY type down one, and removing an item
 * moves every later item of ANY type up one, so `order` is always the item's
 * position in its parent's sequence. The same rule applies independently at
 * every level.
 *
 * The rows still live in separate tables (each with its own per-parent unique
 * index), so uniqueness ACROSS types is maintained here: every sequence change
 * runs inside a transaction holding a per-parent advisory lock.
 */

// The sequence value before anything has been added to a parent. The first
// item appended to an empty parent therefore gets EMPTY_SEQUENCE_ORDER + 1.
const EMPTY_SEQUENCE_ORDER = 0;

// Most specific parent first. Quiz rows may carry every ancestor id, so a row
// belongs to the sequence of its most specific parent only.
const PARENT_FIELDS_MOST_SPECIFIC_FIRST = [
  "conceptId",
  "subTopicId",
  "topicId",
  "lessonId",
  "moduleId",
  "courseId",
];

// For each parent field, the parent fields below it — a Content/Quiz/
// Assignment row is in this parent's sequence only when all of these are null.
const DEEPER_PARENT_FIELDS = {
  courseId: ["moduleId", "lessonId", "topicId", "subTopicId", "conceptId"],
  moduleId: ["lessonId", "topicId", "subTopicId", "conceptId"],
  lessonId: ["topicId", "subTopicId", "conceptId"],
  topicId: ["subTopicId", "conceptId"],
  subTopicId: ["conceptId"],
  conceptId: [],
};

// The child hierarchy entity that sits in each parent's sequence.
const CHILD_ENTITY_BY_PARENT_FIELD = {
  courseId: "module",
  moduleId: "lesson",
  lessonId: "topic",
  topicId: "subTopic",
  subTopicId: "concept",
  conceptId: null,
};

// Items are parked this far below zero while a range of the sequence moves,
// so no row ever collides with a neighbour mid-update (each table has a
// per-parent unique (parent, order) index). Real order values stay far above
// PARKED_BELOW, which is how the parked rows are found again.
const PARK_OFFSET = 1_000_000_000;
const PARKED_BELOW = -500_000_000;

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
 * Every table that holds items of one parent's sequence, with the filter that
 * selects exactly that parent's items from it.
 */
function sequenceMembers(parentField, parentId) {
  assertParentField(parentField);

  const ownItemWhere = { [parentField]: parentId };
  for (const deeper of DEEPER_PARENT_FIELDS[parentField]) ownItemWhere[deeper] = null;

  const members = [
    { kind: "content", delegate: "content", where: ownItemWhere },
    { kind: "quiz", delegate: "quiz", where: ownItemWhere },
    { kind: "assignment", delegate: "assignment", where: ownItemWhere },
  ];

  const childDelegate = CHILD_ENTITY_BY_PARENT_FIELD[parentField];
  if (childDelegate) {
    members.push({ kind: childDelegate, delegate: childDelegate, where: { [parentField]: parentId } });
  }

  return members;
}

/**
 * Serializes sequence changes for one parent until the surrounding
 * transaction ends, so two concurrent adds can never both take the same
 * position. A no-op for a client without raw query support.
 */
async function lockParentSequence(client, parentField, parentId) {
  if (typeof client?.$queryRaw !== "function") return;
  const key = `sequence:${parentField}:${parentId}`;
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
}

/** The highest `order` in a parent's sequence across every item type, or EMPTY_SEQUENCE_ORDER. */
async function getLastOrder(parentField, parentId, client = prisma) {
  let last = EMPTY_SEQUENCE_ORDER;
  for (const member of sequenceMembers(parentField, parentId)) {
    const result = await client[member.delegate].aggregate({
      where: member.where,
      _max: { order: true },
    });
    const value = result?._max?.order;
    if (typeof value === "number" && value > last) last = value;
  }
  return last;
}

/** The lowest `order` in a parent's sequence across every item type, or null when the parent is empty. */
async function getFirstOrder(parentField, parentId, client = prisma) {
  let first = null;
  for (const member of sequenceMembers(parentField, parentId)) {
    const result = await client[member.delegate].aggregate({
      where: member.where,
      _min: { order: true },
    });
    const value = result?._min?.order;
    if (typeof value === "number" && (first === null || value < first)) first = value;
  }
  return first;
}

/**
 * The order for an item appended to a parent: one past the parent's last
 * item of ANY type (Content, Quiz, Assignment or child entity).
 */
async function getNextOrder(parentField, parentId, client = prisma) {
  return (await getLastOrder(parentField, parentId, client)) + 1;
}

/**
 * Moves every item of a parent's sequence whose order is >= `fromOrder`
 * by `delta` (+1 to open a slot, -1 to close one), across all item types.
 * Two phases per table so the per-parent unique indexes never see a
 * transient duplicate.
 */
async function moveSequenceRange(parentField, parentId, fromOrder, delta, client) {
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

/**
 * COURSE LEVEL ONLY: the Course sequence is four strict groups —
 *
 *   Course Content -> Modules -> Course Assignments -> Course Quizzes
 *
 * A Course-level Assignment is the work a student is given once every Module
 * of the course is done, so it may never sit before or between Modules, and
 * the Quizzes close the course. Inside a group items keep their own relative
 * order. This applies at Course level only: a Module/Lesson/Topic/SubTopic/
 * Concept sequence stays plain insertion order across all four types.
 */
const COURSE_PARENT_FIELD = "courseId";
const COURSE_GROUP_RANK = { content: 1, module: 2, assignment: 3, quiz: 4 };
const COURSE_GROUP_ORDER_MESSAGE =
  "Course-level items must stay grouped in order: content, then modules, then assignments, then quizzes.";

const isCourseLevel = (parentField) => parentField === COURSE_PARENT_FIELD;
const courseGroupRank = (kind) => COURSE_GROUP_RANK[kind] ?? COURSE_GROUP_RANK.content;

/**
 * Where an item of `kind` may land in a Course's sequence:
 *
 *  - `groupEnd`: the slot just past its group's last item — the order the
 *    first item of a LATER group holds — or null when no later group has an
 *    item, in which case the item is appended to the sequence.
 *  - `startsAfter` / `hasEarlier`: the last order held by an EARLIER group,
 *    so a requested position can be clamped into this item's own group.
 */
async function getCourseGroupBounds(courseId, kind, client) {
  const rank = courseGroupRank(kind);
  let startsAfter = EMPTY_SEQUENCE_ORDER;
  let hasEarlier = false;
  let groupEnd = null;

  for (const member of sequenceMembers(COURSE_PARENT_FIELD, courseId)) {
    const memberRank = courseGroupRank(member.kind);
    if (memberRank === rank) continue;
    const isEarlier = memberRank < rank;
    const result = await client[member.delegate].aggregate({
      where: member.where,
      ...(isEarlier ? { _max: { order: true } } : { _min: { order: true } }),
    });
    const value = isEarlier ? result?._max?.order : result?._min?.order;
    if (typeof value !== "number") continue;
    if (isEarlier) {
      hasEarlier = true;
      if (value > startsAfter) startsAfter = value;
    } else if (groupEnd === null || value < groupEnd) {
      groupEnd = value;
    }
  }

  return { startsAfter, hasEarlier, groupEnd };
}

/** A requested position must be a whole number; callers send it straight from the API. */
function assertIntegerOrder(requestedOrder) {
  const requested = Number(requestedOrder);
  if (!Number.isInteger(requested)) {
    const error = new Error("order must be an integer.");
    error.statusCode = 400;
    throw error;
  }
  return requested;
}

/**
 * Resolves the position a new item takes in its parent's sequence and makes
 * room for it.
 *
 * With no requested order the item is appended. With a requested order the
 * item is inserted at that position: every item of any type at or after it
 * moves down one. Positions never open a gap: past the end is an append, and
 * before the first item is the slot directly in front of it (so 0 is a valid
 * position in front of a sequence that starts at 1, and needs no shifting).
 *
 * At Course level the group rule above overrides the requested position: the
 * item lands at the end of its OWN group (Content before Modules before
 * Assignments before Quizzes), and a requested position is clamped into that
 * group instead of being allowed to cross a group boundary.
 *
 * Must run inside a transaction; takes the parent's sequence lock itself.
 * @param {string} [kind] the item's type ("content" | "module" | "assignment" |
 *   "quiz" | a child entity) — only the Course-level group rule reads it
 * @returns {Promise<number>} the order the new item must be created with
 */
async function claimSequenceOrder(parentField, parentId, requestedOrder, client, kind = null) {
  await lockParentSequence(client, parentField, parentId);

  const next = await getNextOrder(parentField, parentId, client);
  const hasRequest = requestedOrder !== undefined && requestedOrder !== null && requestedOrder !== "";

  if (isCourseLevel(parentField)) {
    const { startsAfter, hasEarlier, groupEnd } = await getCourseGroupBounds(parentId, kind, client);
    // The end of this item's own group: the slot the next group's first item
    // holds, or the end of the sequence when no later group has anything.
    const endOfGroup = groupEnd === null ? next : groupEnd;

    if (!hasRequest) {
      if (endOfGroup < next) await moveSequenceRange(parentField, parentId, endOfGroup, +1, client);
      return endOfGroup;
    }

    const requested = assertIntegerOrder(requestedOrder);
    const first = await getFirstOrder(parentField, parentId, client);
    const lowest = hasEarlier ? startsAfter + 1 : first === null ? 0 : Math.max(first - 1, 0);
    const position = Math.min(Math.max(requested, lowest), endOfGroup);
    if (first !== null && position >= first && position < next) {
      await moveSequenceRange(parentField, parentId, position, +1, client);
    }
    return position;
  }

  if (!hasRequest) return next;

  const requested = assertIntegerOrder(requestedOrder);
  const first = await getFirstOrder(parentField, parentId, client);
  const lowest = first === null ? 0 : Math.max(first - 1, 0);
  const position = Math.min(Math.max(requested, lowest), next);
  if (first !== null && position >= first && position < next) {
    await moveSequenceRange(parentField, parentId, position, +1, client);
  }
  return position;
}

/**
 * COURSE LEVEL ONLY: rejects a reorder that would break the Course groups —
 * every group must sit entirely after the groups before it. Moving items
 * WITHIN a group is always allowed. `pendingOrders` maps "<kind>:<id>" to the
 * order the caller wants to write.
 */
async function assertCourseGroupsOrdered(courseId, pendingOrders, client = prisma) {
  // Each group's span of orders, once the pending changes are applied.
  const spanByRank = new Map();
  for (const member of sequenceMembers(COURSE_PARENT_FIELD, courseId)) {
    const rows = await client[member.delegate].findMany({
      where: member.where,
      select: { id: true, order: true },
    });
    const rank = courseGroupRank(member.kind);
    for (const row of rows) {
      const pending = pendingOrders.get(`${member.kind}:${row.id}`);
      const order = pending === undefined ? row.order : pending;
      if (typeof order !== "number") continue;
      const span = spanByRank.get(rank) || { min: order, max: order };
      span.min = Math.min(span.min, order);
      span.max = Math.max(span.max, order);
      spanByRank.set(rank, span);
    }
  }

  // Adjacent groups are enough: spans that each start after the previous one
  // ends are ordered transitively.
  const ranks = [...spanByRank.keys()].sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) {
    if (spanByRank.get(ranks[i]).min <= spanByRank.get(ranks[i - 1]).max) {
      const error = new Error(COURSE_GROUP_ORDER_MESSAGE);
      error.statusCode = 400;
      throw error;
    }
  }
}

/**
 * Closes the slot a removed item held, so every later item of any type moves
 * up one and `order` keeps matching position. Call after the item is deleted,
 * in the same transaction. A row with no order (legacy) leaves nothing to close.
 */
async function releaseSequenceOrder(parentField, parentId, removedOrder, client) {
  if (!parentField || !parentId || typeof removedOrder !== "number") return;
  await lockParentSequence(client, parentField, parentId);
  await moveSequenceRange(parentField, parentId, removedOrder + 1, -1, client);
}

/**
 * COURSE LEVEL ONLY: guards a reorder request before it is written.
 *
 * `rows` is the caller's [{ id, order }] payload for one item type. Any row
 * that turns out to be Course-direct is checked against the Course group rule,
 * with every other Course item left where it is; rows at other levels are
 * ignored, so Module/Lesson/Topic/SubTopic/Concept reordering is unaffected.
 */
async function assertCourseReorderAllowed(kind, rows, client = prisma) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const delegate = kind === "module" ? "module" : kind;
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (ids.length === 0) return;

  const stored = await client[delegate].findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      courseId: true,
      ...(kind === "module"
        ? {}
        : { moduleId: true, lessonId: true, topicId: true, subTopicId: true, conceptId: true }),
    },
  });

  const requestedById = new Map(rows.map((row) => [row.id, row.order]));
  const byCourse = new Map();
  for (const row of stored) {
    const isCourseDirect = kind === "module" || mostSpecificParentField(row) === COURSE_PARENT_FIELD;
    if (!isCourseDirect || !row.courseId) continue;
    if (!byCourse.has(row.courseId)) byCourse.set(row.courseId, new Map());
    byCourse.get(row.courseId).set(`${kind}:${row.id}`, requestedById.get(row.id));
  }

  for (const [courseId, pendingOrders] of byCourse) {
    await assertCourseGroupsOrdered(courseId, pendingOrders, client);
  }
}

module.exports = {
  EMPTY_SEQUENCE_ORDER,
  COURSE_PARENT_FIELD,
  PARENT_FIELDS_MOST_SPECIFIC_FIRST,
  mostSpecificParentField,
  sequenceMembers,
  lockParentSequence,
  getFirstOrder,
  COURSE_GROUP_RANK,
  courseGroupRank,
  getCourseGroupBounds,
  getLastOrder,
  getNextOrder,
  claimSequenceOrder,
  assertCourseGroupsOrdered,
  assertCourseReorderAllowed,
  releaseSequenceOrder,
};
