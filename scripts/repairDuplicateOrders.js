/**
 * One-off repair: renumbers every parent whose common sequence has two items
 * on the same `order` (a Content and a Lesson, a Quiz and a Topic, …) to a
 * clean 1..n, keeping the order the instructor sidebar currently shows them
 * in. Parents without a duplicate slot are left untouched.
 *
 * Those duplicates were written by the old per-type reorders. Every reorder
 * now goes through moveSequenceItems / swapSequenceItems (contentOrder.util.js),
 * which cannot write one, so this is a safety net for data written before
 * that; a parent holding one fails every later add or delete with P2002.
 * The sequence members are the parent's Content rows (quizzes and
 * assignments included, through their Content rows) and its child containers.
 *
 * Usage (from lms-api/):
 *   node scripts/repairDuplicateOrders.js            dry run
 *   node scripts/repairDuplicateOrders.js --apply    write the changes
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { sequenceMembers, lockParentSequence } = require("../src/modules/contents/contentOrder.util");
const p = new PrismaClient({ transactionOptions: { maxWait: 10000, timeout: 60000 } });
const PARK = 1_000_000_000;
const APPLY = process.argv.includes("--apply");
// Same tie-break the sidebar renders with: order, createdAt, content < child rows/assignment < quiz.
const rank = (k) => (k === "content" ? 1 : k === "quiz" ? 3 : 2);
const cmp = (a, b) => a.order - b.order || a.createdAt - b.createdAt || rank(a.kind) - rank(b.kind);

async function itemsOf(client, parentField, parentId) {
  const items = [];
  for (const m of sequenceMembers(parentField, parentId)) {
    const rows = await client[m.delegate].findMany({ where: m.where, select: { id: true, title: true, order: true, createdAt: true } });
    for (const r of rows) items.push({ kind: m.kind, ...r });
  }
  return items.sort(cmp);
}

(async () => {
  const parents = [];
  for (const [field, delegate] of [["courseId", "course"], ["moduleId", "module"], ["lessonId", "lesson"], ["topicId", "topic"], ["subTopicId", "subTopic"], ["conceptId", "concept"]]) {
    for (const row of await p[delegate].findMany({ select: { id: true, title: true } })) parents.push({ field, id: row.id, title: row.title });
  }
  let repaired = 0;
  for (const parent of parents) {
    const items = await itemsOf(p, parent.field, parent.id);
    const orders = items.map((i) => i.order);
    if (new Set(orders).size === orders.length) continue; // no duplicate slot: leave untouched
    repaired++;
    console.log(`\n${parent.field} ${parent.id} "${parent.title}"`);
    items.forEach((it, i) => console.log(`  ${String(it.order).padStart(3)} -> ${String(i + 1).padStart(3)}  ${it.kind.padEnd(10)} ${it.title}`));
    if (!APPLY) continue;
    await p.$transaction(async (tx) => {
      await lockParentSequence(tx, parent.field, parent.id);
      const fresh = await itemsOf(tx, parent.field, parent.id);
      const changes = fresh.map((it, i) => ({ ...it, newOrder: i + 1 })).filter((c) => c.order !== c.newOrder);
      for (const c of changes) await tx[c.kind].update({ where: { id: c.id }, data: { order: c.newOrder - PARK } });
      for (const c of changes) await tx[c.kind].update({ where: { id: c.id }, data: { order: c.newOrder } });
    });
  }
  console.log(`\n${APPLY ? "Applied to" : "Dry run:"} ${repaired} parent(s) with duplicate slots, of ${parents.length} checked.`);
  if (APPLY) {
    let left = 0;
    for (const parent of parents) {
      const orders = (await itemsOf(p, parent.field, parent.id)).map((i) => i.order);
      if (new Set(orders).size !== orders.length) left++;
    }
    console.log(`Parents still holding a duplicate slot: ${left}`);
  }
  await p.$disconnect();
})().catch(async (e) => { console.log("ERR", e.code || "", e.message); await p.$disconnect(); process.exit(1); });
