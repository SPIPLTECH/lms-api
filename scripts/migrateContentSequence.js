/**
 * Quiz + Assignment -> unified Content sequence: the data migration
 * (step 2 of 3 — see scripts/content-sequence-1-schema.sql for the order).
 *
 * What it changes is decided by scripts/lib/contentSequenceMigration.js (pure,
 * unit-tested); this runner only loads, backs up, applies and verifies.
 *
 *   node scripts/migrateContentSequence.js
 *       DRY RUN. Plans the migration, prints the report, then executes the
 *       whole plan inside a transaction against the real database — so every
 *       unique index and foreign key is exercised — and ROLLS IT BACK.
 *       Nothing is written.
 *
 *   node scripts/migrateContentSequence.js --apply [--backup-dir <dir>]
 *       Writes a JSON backup of every row the plan reads (default
 *       ../migration-backups, outside the repository: it holds student data),
 *       then applies the plan in ONE transaction and re-checks the
 *       invariants on the real rows before committing. Any failure rolls the
 *       whole migration back.
 *
 * Re-runnable: on an already-migrated database the plan is empty.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const prisma = require("../src/config/database");
const { planContentSequenceMigration, checkInvariants } = require("./lib/contentSequenceMigration");

const PARENTS = { courseId: true, moduleId: true, lessonId: true, topicId: true, subTopicId: true, conceptId: true };
const DRY_RUN_ROLLBACK = Symbol("dry-run rollback");
const TX_OPTIONS = { timeout: 15 * 60 * 1000, maxWait: 60 * 1000 };

const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};

async function loadSnapshot(client) {
  const [contents, quizzes, assignments, contentSubmissions, assignmentSubmissions, quizAttempts, quizSubmissions, contentProgress, quizProgress, assignmentProgress] =
    await Promise.all([
      client.content.findMany({
        select: { id: true, type: true, order: true, title: true, ...PARENTS, quizId: true, assignmentId: true, createdAt: true, htmlContent: true, fileUrl: true, data: true },
      }),
      client.quiz.findMany({
        select: { id: true, title: true, quizTag: true, batchId: true, order: true, passingScore: true, ...PARENTS, createdAt: true },
      }),
      client.assignment.findMany({
        select: { id: true, title: true, order: true, dueDate: true, attachments: true, ...PARENTS, createdAt: true },
      }),
      client.contentSubmission.findMany(),
      client.assignmentSubmission.findMany(),
      client.quizAttempt.findMany({ select: { quizId: true, studentId: true, passed: true, submittedAt: true } }),
      client.quizSubmission.findMany({ select: { quizId: true, studentId: true, passed: true, percentage: true, submittedAt: true } }),
      client.contentProgress.findMany(),
      client.quizProgress.findMany(),
      client.assignmentProgress.findMany(),
    ]);
  const containers = {
    module: await client.module.findMany({ select: { id: true, courseId: true, order: true, createdAt: true } }),
    lesson: await client.lesson.findMany({ select: { id: true, moduleId: true, order: true, createdAt: true } }),
    topic: await client.topic.findMany({ select: { id: true, lessonId: true, order: true, createdAt: true } }),
    subTopic: await client.subTopic.findMany({ select: { id: true, topicId: true, order: true, createdAt: true } }),
    concept: await client.concept.findMany({ select: { id: true, subTopicId: true, order: true, createdAt: true } }),
  };
  return { contents, quizzes, assignments, contentSubmissions, assignmentSubmissions, quizAttempts, quizSubmissions, contentProgress, quizProgress, assignmentProgress, containers };
}

async function applyPlan(tx, plan) {
  // a. Standalone quizzes lose their sequence row.
  if (plan.deleteContents.length) await tx.content.deleteMany({ where: { id: { in: plan.deleteContents } } });

  // b. Legacy assignment blocks become Assignments, their submissions follow.
  for (const { data } of plan.createAssignments) await tx.assignment.create({ data });
  for (const { id, assignmentId } of plan.linkContents) await tx.content.update({ where: { id }, data: { assignmentId } });
  if (plan.createAssignmentSubmissions.length) {
    await tx.assignmentSubmission.createMany({ data: plan.createAssignmentSubmissions.map((s) => s.data) });
  }
  for (const { id, data } of plan.updateAssignments) await tx.assignment.update({ where: { id }, data });

  // c. Park every row that moves, so no unique (parent, order) index ever sees
  //    two rows on one position; then re-parent; then final orders.
  for (let i = 0; i < plan.reorderContents.length; i++) {
    await tx.content.update({ where: { id: plan.reorderContents[i].id }, data: { order: -1_000_000 - i } });
  }
  for (let i = 0; i < plan.reorderContainers.length; i++) {
    const { kind, id } = plan.reorderContainers[i];
    await tx[kind].update({ where: { id }, data: { order: -1_000_000 - i } });
  }
  for (const { id, data } of plan.reparentContents) await tx.content.update({ where: { id }, data });
  for (const { id, order } of plan.reorderContents) await tx.content.update({ where: { id }, data: { order } });
  for (const { kind, id, order } of plan.reorderContainers) await tx[kind].update({ where: { id }, data: { order } });

  // d. Missing wrappers, already at their final position.
  for (const { data } of plan.createContents) {
    const { createdAt, ...row } = data;
    await tx.content.create({ data: row });
  }

  // e. Wrapper progress = the completion rule.
  for (const { studentId, contentId, data } of plan.upsertContentProgress) {
    await tx.contentProgress.upsert({
      where: { studentId_contentId: { studentId, contentId } },
      create: { studentId, contentId, ...data },
      update: data,
    });
  }

  // f. Verify on the real rows before anything is committed.
  const rows = await tx.content.findMany({ select: { id: true, type: true, order: true, ...PARENTS, quizId: true, assignmentId: true } });
  const { containers } = await loadSnapshot(tx);
  const containerRows = Object.entries(containers).flatMap(([kind, list]) => list.map((row) => ({ ...row, kind })));
  const problems = checkInvariants(rows, containerRows);
  if (problems.length) {
    const error = new Error(`Invariants violated after applying the plan: ${JSON.stringify(problems.slice(0, 20))}`);
    error.problems = problems;
    throw error;
  }
  return rows.length;
}

const countPlan = (plan) => Object.fromEntries(Object.entries(plan).map(([key, list]) => [key, list.length]));

async function main() {
  const apply = process.argv.includes("--apply");
  const backupDir = path.resolve(argValue("--backup-dir") || path.join(__dirname, "..", "..", "migration-backups"));

  const snapshot = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return loadSnapshot(tx);
    },
    { timeout: 180000, maxWait: 30000 }
  );

  const { plan, report, finalContents, finalContainers } = planContentSequenceMigration(snapshot, { newId: () => crypto.randomUUID() });
  const plannedProblems = checkInvariants(finalContents, finalContainers);

  console.log(`\n=== Content sequence migration — ${apply ? "APPLY" : "DRY RUN (rolled back)"} ===`);
  console.log("Report:", JSON.stringify(report, null, 2));
  console.log("Planned changes:", JSON.stringify(countPlan(plan), null, 2));
  if (plannedProblems.length) {
    console.error("The plan itself would violate invariants:", plannedProblems.slice(0, 20));
    process.exitCode = 1;
    return;
  }
  const total = Object.values(countPlan(plan)).reduce((sum, n) => sum + n, 0);
  if (total === 0) {
    console.log("\nNothing to migrate — the database already satisfies the unified sequence.");
    return;
  }

  if (apply) {
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `content-sequence-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), snapshot, plan, report }, null, 2));
    console.log(`\nBackup written: ${file}`);
  }

  const started = Date.now();
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await applyPlan(tx, plan);
      console.log(`\nApplied inside the transaction; ${rows} Content rows re-checked, all invariants hold.`);
      if (!apply) throw DRY_RUN_ROLLBACK;
    }, TX_OPTIONS);
    console.log(`Committed in ${Math.round((Date.now() - started) / 1000)}s.`);
  } catch (error) {
    if (error === DRY_RUN_ROLLBACK) {
      console.log(`Dry run: rolled back after ${Math.round((Date.now() - started) / 1000)}s. Nothing was written.`);
      return;
    }
    throw error;
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("\nMigration failed — nothing was committed.\n", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { loadSnapshot, applyPlan };
