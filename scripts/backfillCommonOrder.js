/**
 * One-off backfill: rewrites every parent's items into ONE common sequence
 * (1, 2, 3, …) across Content, Quiz, Assignment and the parent's child entity
 * — the rule contentOrder.util.js now maintains for every add/insert/remove.
 *
 * Existing data predates that rule: each type kept its own counter (Content
 * 1..n, Lesson 1..n, …) and Quiz/Assignment sat in number bands
 * (1,000,001+ / 2,000,001+). For such a parent the common sequence is rebuilt
 * from the order items were ADDED (createdAt), while every type keeps its
 * current relative order (so an earlier manual reorder or "insert above" is
 * not undone): an item inherits the earliest createdAt of the items after it
 * in its own type, then all types are merged by that time.
 *
 * A parent that is already a common sequence (every order distinct, none in
 * the old bands, none missing) keeps its current order and is only compacted
 * to 1..n.
 *
 * Usage (from lms-api/):
 *   node scripts/backfillCommonOrder.js                 dry run, all courses
 *   node scripts/backfillCommonOrder.js --course <id>   dry run, one course
 *   node scripts/backfillCommonOrder.js --apply [...]   write the changes
 */
const {
  EMPTY_SEQUENCE_ORDER,
  COURSE_PARENT_FIELD,
  courseGroupRank,
  mostSpecificParentField,
  lockParentSequence,
} = require("../src/modules/contents/contentOrder.util");

// Orders at or above this were written by the old Quiz/Assignment bands.
const LEGACY_BAND_START = 1_000_000;
const PARK_OFFSET = 1_000_000_000;

// Tie-break when two types' items were added at the same instant (bulk imports).
const KIND_RANK = { content: 1, module: 2, lesson: 2, topic: 2, subTopic: 2, concept: 2, quiz: 3, assignment: 4 };

const time = (item) => new Date(item.createdAt).getTime();
const orderOrLast = (item) => (typeof item.order === "number" ? item.order : Number.POSITIVE_INFINITY);

function byCurrentPosition(a, b) {
  return (
    orderOrLast(a) - orderOrLast(b) ||
    time(a) - time(b) ||
    (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) ||
    String(a.id).localeCompare(String(b.id))
  );
}

function isCommonSequence(items) {
  const seen = new Set();
  for (const item of items) {
    if (typeof item.order !== "number" || item.order >= LEGACY_BAND_START || seen.has(item.order)) return false;
    seen.add(item.order);
  }
  return true;
}

/**
 * The target sequence for one parent's items.
 *
 * At Course level (`parentField === "courseId"`) the result is then grouped
 * into Content -> Modules -> Assignments -> Quizzes, each group keeping its
 * own relative order — the same invariant the create/reorder paths maintain.
 * The step is a stable partition, so re-running the backfill changes nothing.
 * No other level is partitioned.
 *
 * @param {{kind: string, id: string, order: number|null, createdAt: Date|string}[]} items
 * @param {string} [parentField]
 * @returns {{kind, id, order, createdAt, newOrder: number}[]} in sequence order
 */
function planParentSequence(items, parentField = null) {
  let sequence;

  if (isCommonSequence(items)) {
    sequence = [...items].sort(byCurrentPosition);
  } else {
    const byKind = new Map();
    for (const item of items) {
      if (!byKind.has(item.kind)) byKind.set(item.kind, []);
      byKind.get(item.kind).push(item);
    }

    const ranked = [];
    for (const list of byKind.values()) {
      list.sort(byCurrentPosition);
      // Suffix minimum: an item placed before an older item of its own type
      // (a reorder, an "insert above") belongs where that older item does.
      let earliest = Number.POSITIVE_INFINITY;
      const effective = new Array(list.length);
      for (let i = list.length - 1; i >= 0; i--) {
        earliest = Math.min(earliest, time(list[i]));
        effective[i] = earliest;
      }
      list.forEach((item, index) => ranked.push({ item, addedAt: effective[index], index }));
    }

    ranked.sort(
      (a, b) =>
        a.addedAt - b.addedAt ||
        orderOrLast(a.item) - orderOrLast(b.item) ||
        (KIND_RANK[a.item.kind] ?? 9) - (KIND_RANK[b.item.kind] ?? 9) ||
        a.index - b.index ||
        String(a.item.id).localeCompare(String(b.item.id))
    );
    sequence = ranked.map((entry) => entry.item);
  }

  if (parentField === COURSE_PARENT_FIELD) {
    // Stable, so items inside one group keep the relative order above.
    sequence = [...sequence].sort((a, b) => courseGroupRank(a.kind) - courseGroupRank(b.kind));
  }

  return sequence.map((item, index) => ({ ...item, newOrder: EMPTY_SEQUENCE_ORDER + index + 1 }));
}

// ---------------------------------------------------------------------------

const PARENT_FIELD_OF_CHILD = {
  module: "courseId",
  lesson: "moduleId",
  topic: "lessonId",
  subTopic: "topicId",
  concept: "subTopicId",
};

const CQA_SELECT = {
  id: true,
  order: true,
  createdAt: true,
  courseId: true,
  moduleId: true,
  lessonId: true,
  topicId: true,
  subTopicId: true,
  conceptId: true,
};

async function courseScope(prisma, courseId) {
  const modules = await prisma.module.findMany({ where: { courseId }, select: { id: true } });
  const moduleIds = modules.map((m) => m.id);
  const lessons = await prisma.lesson.findMany({ where: { moduleId: { in: moduleIds } }, select: { id: true } });
  const lessonIds = lessons.map((l) => l.id);
  const topics = await prisma.topic.findMany({ where: { lessonId: { in: lessonIds } }, select: { id: true } });
  const topicIds = topics.map((t) => t.id);
  const subTopics = await prisma.subTopic.findMany({ where: { topicId: { in: topicIds } }, select: { id: true } });
  const subTopicIds = subTopics.map((s) => s.id);
  const concepts = await prisma.concept.findMany({ where: { subTopicId: { in: subTopicIds } }, select: { id: true } });

  return new Set([
    `courseId:${courseId}`,
    ...moduleIds.map((id) => `moduleId:${id}`),
    ...lessonIds.map((id) => `lessonId:${id}`),
    ...topicIds.map((id) => `topicId:${id}`),
    ...subTopicIds.map((id) => `subTopicId:${id}`),
    ...concepts.map((c) => `conceptId:${c.id}`),
  ]);
}

async function collectParents(prisma) {
  const parents = new Map();
  const add = (parentField, parentId, item) => {
    if (!parentField || !parentId) return;
    const key = `${parentField}:${parentId}`;
    if (!parents.has(key)) parents.set(key, { parentField, parentId, items: [] });
    parents.get(key).items.push(item);
  };

  for (const kind of ["content", "quiz", "assignment"]) {
    const rows = await prisma[kind].findMany({ select: CQA_SELECT });
    for (const row of rows) {
      const parentField = mostSpecificParentField(row);
      add(parentField, row[parentField], { kind, id: row.id, order: row.order, createdAt: row.createdAt });
    }
  }

  for (const [kind, parentField] of Object.entries(PARENT_FIELD_OF_CHILD)) {
    const rows = await prisma[kind].findMany({
      select: { id: true, order: true, createdAt: true, [parentField]: true },
    });
    for (const row of rows) {
      add(parentField, row[parentField], { kind, id: row.id, order: row.order, createdAt: row.createdAt });
    }
  }

  return parents;
}

async function applyParentPlan(prisma, parent, changes) {
  await prisma.$transaction(async (tx) => {
    await lockParentSequence(tx, parent.parentField, parent.parentId);
    // Park first so no row lands on a value another row of its table still holds.
    for (const change of changes) {
      await tx[change.kind].update({ where: { id: change.id }, data: { order: change.newOrder - PARK_OFFSET } });
    }
    for (const change of changes) {
      await tx[change.kind].update({ where: { id: change.id }, data: { order: change.newOrder } });
    }
  }, { timeout: 60_000 });
}

async function main() {
  const prisma = require("../src/config/database");
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const courseIndex = args.indexOf("--course");
  const courseId = courseIndex >= 0 ? args[courseIndex + 1] : null;

  const scope = courseId ? await courseScope(prisma, courseId) : null;
  const parents = await collectParents(prisma);

  let parentsChanged = 0;
  let rowsChanged = 0;
  let samplesShown = 0;

  for (const [key, parent] of parents) {
    if (scope && !scope.has(key)) continue;

    const plan = planParentSequence(parent.items, parent.parentField);
    const changes = plan.filter((entry) => entry.order !== entry.newOrder);
    if (changes.length === 0) continue;

    parentsChanged++;
    rowsChanged += changes.length;

    if (samplesShown < 10) {
      samplesShown++;
      console.log(`\n${key}`);
      for (const entry of plan) {
        console.log(`  ${String(entry.newOrder).padStart(3)}  ${entry.kind.padEnd(10)} ${entry.id}  (was ${entry.order})`);
      }
    }

    if (apply) await applyParentPlan(prisma, parent, changes);
  }

  console.log(
    `\n${apply ? "Applied" : "Dry run"}: ${parentsChanged} parent(s), ${rowsChanged} row(s) ${apply ? "renumbered" : "would be renumbered"}.`
  );
  if (!apply && parentsChanged > 0) console.log("Re-run with --apply to write these changes.");

  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { planParentSequence, isCommonSequence };
