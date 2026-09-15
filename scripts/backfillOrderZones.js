/**
 * One-off backfill: rewrites every existing Quiz's `order` into the Quiz
 * zone (QUIZ_ORDER_BASE+) and every existing Assignment's `order` into the
 * Assignment zone (ASSIGNMENT_ORDER_BASE+), grouped independently per parent
 * scope (course/module/lesson/topic), preserving each group's existing
 * relative order (falling back to createdAt for Assignments, which had no
 * order at all before this).
 *
 * Content, Module, Lesson, and Topic rows are never touched.
 *
 * Run manually: node lms-api/scripts/backfillOrderZones.js
 */
const prisma = require("../src/config/database");
const { QUIZ_ORDER_BASE, ASSIGNMENT_ORDER_BASE } = require("../src/modules/contents/contentOrder.util");

const PARENT_FIELDS = ["topicId", "lessonId", "moduleId", "courseId"];

// Groups rows by whichever single parent field is set (a row only ever has
// one, per the existing xor-validated create schemas), keyed as "field:id".
function groupByParentScope(rows) {
  const groups = new Map();
  for (const row of rows) {
    const field = PARENT_FIELDS.find((f) => row[f]);
    if (!field) continue;
    const key = `${field}:${row[field]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

async function backfillQuizzes() {
  const quizzes = await prisma.quiz.findMany({
    select: { id: true, order: true, createdAt: true, courseId: true, moduleId: true, lessonId: true, topicId: true },
  });

  const groups = groupByParentScope(quizzes);
  let updated = 0;

  for (const rows of groups.values()) {
    rows.sort((a, b) => {
      const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) return orderDiff;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    for (let i = 0; i < rows.length; i++) {
      const newOrder = QUIZ_ORDER_BASE + i + 1;
      if (rows[i].order === newOrder) continue;
      await prisma.quiz.update({ where: { id: rows[i].id }, data: { order: newOrder } });
      updated++;
    }
  }

  console.log(`Quizzes rewritten into the Quiz zone: ${updated}`);
}

async function backfillAssignments() {
  const assignments = await prisma.assignment.findMany({
    select: { id: true, order: true, createdAt: true, courseId: true, moduleId: true, lessonId: true, topicId: true },
  });

  const groups = groupByParentScope(assignments);
  let updated = 0;

  for (const rows of groups.values()) {
    rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    for (let i = 0; i < rows.length; i++) {
      const newOrder = ASSIGNMENT_ORDER_BASE + i + 1;
      if (rows[i].order === newOrder) continue;
      await prisma.assignment.update({ where: { id: rows[i].id }, data: { order: newOrder } });
      updated++;
    }
  }

  console.log(`Assignments rewritten into the Assignment zone: ${updated}`);
}

async function main() {
  await backfillQuizzes();
  await backfillAssignments();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
