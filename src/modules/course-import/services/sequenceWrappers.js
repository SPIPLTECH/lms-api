const crypto = require("crypto");
const { singleParentPlacement } = require("../../contents/contentOrder.util");

/**
 * Places a batch-imported course's quizzes and assignments in the learning
 * sequence.
 *
 * Importers write whole courses with createMany, outside content.service, so
 * they build the Content(type=QUIZ) / Content(type=ASSIGNMENT) rows that
 * place each quiz/assignment themselves — through this one helper, so every
 * import path follows the same rule:
 *
 *   - a QUALIFYING or batch-scoped quiz is standalone: no Content row;
 *   - every other quiz, and every assignment, gets exactly one Content row at
 *     its most specific parent;
 *   - the row takes the item's own requested `order` when that position is
 *     free in its parent's sequence, otherwise it is appended after the
 *     parent's last item — which is where an importer that "puts a level's
 *     quizzes after its content" means them to be;
 *   - `order` is removed from the quiz/assignment rows: Content.order is the
 *     only sequence order, Quiz.order / Assignment.order are no longer written.
 *
 * Quiz and assignment rows must carry their `id` (pre-generated), because the
 * Content rows reference them. Insert the returned rows AFTER the quizzes and
 * assignments.
 *
 * @param {object} args
 * @param {object[]} args.contentRows       ordinary Content rows of this batch (with `order`)
 * @param {object[]} [args.quizRows]        Quiz rows (id required)
 * @param {object[]} [args.assignmentRows]  Assignment rows (id required)
 * @param {Map<string, number>} [args.existingLastOrder]  "parentField:parentId" -> highest
 *   Content.order already in the database, for imports into an existing parent
 * @returns {object[]} Content rows to createMany
 */
function buildSequenceWrapperRows({ contentRows = [], quizRows = [], assignmentRows = [], existingLastOrder = new Map() }) {
  const keyOf = (placement) => `${placement.parentField}:${placement.parentId}`;
  const taken = new Map();
  const lastOrder = new Map(existingLastOrder);

  const claim = (key, order) => {
    if (!taken.has(key)) taken.set(key, new Set());
    taken.get(key).add(order);
    if (order > (lastOrder.get(key) || 0)) lastOrder.set(key, order);
  };

  for (const row of contentRows) {
    const placement = singleParentPlacement(row);
    if (placement && Number.isInteger(row.order)) claim(keyOf(placement), row.order);
  }

  const items = [
    ...quizRows
      .filter((quiz) => quiz.quizTag !== "QUALIFYING" && !quiz.batchId)
      .map((row) => ({ row, type: "QUIZ", link: { quizId: row.id } })),
    ...assignmentRows.map((row) => ({ row, type: "ASSIGNMENT", link: { assignmentId: row.id } })),
  ];

  // Requested positions first (in position order), then everything that only
  // asks to be appended, in the order the importer listed it.
  const requested = (item) => (Number.isInteger(item.row.order) && item.row.order > 0 ? item.row.order : Infinity);
  items.sort((a, b) => requested(a) - requested(b));

  const wrappers = [];
  for (const item of items) {
    if (!item.row.id) throw new Error(`An imported ${item.type.toLowerCase()} needs a pre-generated id.`);
    const placement = singleParentPlacement(item.row);
    if (!placement) continue;
    const key = keyOf(placement);
    const wanted = requested(item);
    const next = (lastOrder.get(key) || 0) + 1;
    // A requested position is honoured when it is free, is not among rows
    // already in the database, and does not leave a gap (an importer that
    // counted child containers asks for a position past the end — appended).
    const order =
      wanted !== Infinity && !(taken.get(key)?.has(wanted)) && wanted > (existingLastOrder.get(key) || 0) && wanted <= next
        ? wanted
        : next;
    claim(key, order);
    wrappers.push({
      id: crypto.randomUUID(),
      type: item.type,
      title: item.row.title ?? null,
      order,
      ...item.link,
      ...placement.data,
    });
  }

  for (const row of [...quizRows, ...assignmentRows]) delete row.order;
  return wrappers;
}

const CONTAINER_PARENT_FIELD = {
  module: "courseId",
  lesson: "moduleId",
  topic: "lessonId",
  subTopic: "topicId",
  concept: "subTopicId",
};

/**
 * Numbers a whole imported course as ONE learning sequence per parent — the
 * parent's Content rows and its child containers share it — in the layout an
 * import template describes: a level's content first, then its child
 * containers, then its quizzes and assignments, each group in the order the
 * importer listed it. Rewrites `order` on the content and container rows and
 * returns the Content rows that place the quizzes/assignments (insert them
 * AFTER the quizzes and assignments). `order` is removed from the
 * quiz/assignment rows. QUALIFYING and batch-scoped quizzes stay standalone.
 *
 * @param {object} args
 * @param {Array<{ kind: string, rows: object[] }>} args.containers e.g. [{ kind: "module", rows: moduleRows }]
 * @param {object[]} args.contentRows
 * @param {object[]} [args.quizRows]       Quiz rows (id required)
 * @param {object[]} [args.assignmentRows] Assignment rows (id required)
 * @returns {object[]} Content rows to createMany
 */
function sequenceImportedCourse({ containers = [], contentRows = [], quizRows = [], assignmentRows = [] }) {
  const parents = new Map();
  const groupOf = (key) => {
    if (!parents.has(key)) parents.set(key, { content: [], children: [], items: [] });
    return parents.get(key);
  };
  const byOrder = (a, b) => (Number.isInteger(a.order) ? a.order : Infinity) - (Number.isInteger(b.order) ? b.order : Infinity);

  for (const row of contentRows) {
    const placement = singleParentPlacement(row);
    if (placement) groupOf(`${placement.parentField}:${placement.parentId}`).content.push(row);
  }
  for (const { kind, rows } of containers) {
    const parentField = CONTAINER_PARENT_FIELD[kind];
    for (const row of rows || []) groupOf(`${parentField}:${row[parentField]}`).children.push(row);
  }
  const items = [
    ...quizRows
      .filter((quiz) => quiz.quizTag !== "QUALIFYING" && !quiz.batchId)
      .map((row) => ({ row, type: "QUIZ", link: { quizId: row.id } })),
    ...assignmentRows.map((row) => ({ row, type: "ASSIGNMENT", link: { assignmentId: row.id } })),
  ];
  for (const item of items) {
    if (!item.row.id) throw new Error(`An imported ${item.type.toLowerCase()} needs a pre-generated id.`);
    const placement = singleParentPlacement(item.row);
    if (placement) groupOf(`${placement.parentField}:${placement.parentId}`).items.push({ ...item, placement });
  }

  const wrappers = [];
  for (const group of parents.values()) {
    let order = 0;
    for (const row of [...group.content].sort(byOrder)) row.order = ++order;
    for (const row of [...group.children].sort(byOrder)) row.order = ++order;
    for (const item of [...group.items].sort((a, b) => byOrder(a.row, b.row))) {
      wrappers.push({
        id: crypto.randomUUID(),
        type: item.type,
        title: item.row.title ?? null,
        order: ++order,
        ...item.link,
        ...item.placement.data,
      });
    }
  }

  for (const row of [...quizRows, ...assignmentRows]) delete row.order;
  return wrappers;
}

module.exports = { buildSequenceWrapperRows, sequenceImportedCourse };
