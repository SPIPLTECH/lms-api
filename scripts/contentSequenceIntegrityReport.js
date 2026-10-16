/**
 * READ-ONLY integrity report for the unified Content learning sequence.
 *
 * Everything runs inside one `READ ONLY` transaction, so Postgres itself
 * refuses any write — this script cannot change data even by mistake.
 *
 * It reports what the Content-sequence migration
 * (scripts/migrateContentSequence.js) needs to know before it touches
 * anything, and is re-run afterwards to prove the result:
 *
 *   - Content invariants: exactly one parent, type <-> quizId/assignmentId
 *   - every Quiz classified: sequence / QUALIFYING / batch / student practice
 *   - wrapper placement (wrapper parent vs the domain row's own parent)
 *   - wrapper position vs the item's original common-sequence order
 *   - NULL / duplicate orders, cross-type collisions in the old sequence
 *   - legacy Content(type=ASSIGNMENT) + ContentSubmission state
 *   - Content.data / htmlContent carried by assignment blocks
 *   - progress: ContentProgress vs the Quiz/Assignment domain state
 *   - how own items sit relative to child containers (product behaviour)
 *
 * Usage (from lms-api/):
 *   node scripts/contentSequenceIntegrityReport.js            summary
 *   node scripts/contentSequenceIntegrityReport.js --json f   also write full detail to f
 */
const fs = require("fs");
const prisma = require("../src/config/database");

const PRACTICE_QUIZ_TITLE = "Self-Generated Practice Quiz";
const PARENTS = ["conceptId", "subTopicId", "topicId", "lessonId", "moduleId", "courseId"]; // most specific first
const CHILD_TABLE = { courseId: "Module", moduleId: "Lesson", lessonId: "Topic", topicId: "SubTopic", subTopicId: "Concept" };

const mostSpecific = (row) => PARENTS.find((f) => row[f]) || null;
const parentKey = (row) => {
  const f = mostSpecific(row);
  return f ? `${f}:${row[f]}` : null;
};

/** Which quizzes belong in the learning sequence. QUALIFYING, batch-scoped and student practice quizzes are standalone. */
function classifyQuiz(q) {
  if (q.quizTag === "QUALIFYING") return "QUALIFYING";
  if (q.batchId) return "BATCH";
  if (q.title === PRACTICE_QUIZ_TITLE) return "PRACTICE";
  return "SEQUENCE";
}

async function collect(tx) {
  const q = (sql) => tx.$queryRawUnsafe(sql);

  const checks = await q(`SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conrelid = '"Content"'::regclass AND contype = 'c' ORDER BY conname`);

  const contents = await q(`SELECT id, type::text AS type, "order", title, "courseId", "moduleId", "lessonId", "topicId",
      "subTopicId", "conceptId", "quizId", "assignmentId", "createdAt",
      (data IS NOT NULL) AS has_data, (COALESCE("htmlContent", '') <> '') AS has_html,
      num_nonnulls("courseId", "moduleId", "lessonId", "topicId", "subTopicId", "conceptId")::int AS parent_count
    FROM "Content"`);

  const quizzes = await q(`SELECT q.id, q.title, q."quizTag"::text AS "quizTag", q."batchId", q."order", q."createdAt",
      q."isPublished", q."courseId", q."moduleId", q."lessonId", q."topicId", q."subTopicId", q."conceptId",
      (SELECT count(*) FROM "QuizAttempt" a WHERE a."quizId" = q.id)::int AS attempts,
      (SELECT count(*) FROM "QuizSubmission" s WHERE s."quizId" = q.id)::int AS submissions
    FROM "Quiz" q`);

  const assignments = await q(`SELECT a.id, a.title, a."order", a."createdAt", a."dueDate", a."isPublished",
      a."courseId", a."moduleId", a."lessonId", a."topicId", a."subTopicId", a."conceptId",
      (SELECT count(*) FROM "AssignmentSubmission" s WHERE s."assignmentId" = a.id)::int AS submissions,
      COALESCE(a."courseId", m."courseId", lm."courseId", tm."courseId", stm."courseId", cm."courseId") AS owner_course
    FROM "Assignment" a
    LEFT JOIN "Module" m ON m.id = a."moduleId"
    LEFT JOIN "Lesson" l ON l.id = a."lessonId" LEFT JOIN "Module" lm ON lm.id = l."moduleId"
    LEFT JOIN "Topic" t ON t.id = a."topicId" LEFT JOIN "Lesson" tl ON tl.id = t."lessonId" LEFT JOIN "Module" tm ON tm.id = tl."moduleId"
    LEFT JOIN "SubTopic" st ON st.id = a."subTopicId" LEFT JOIN "Topic" stt ON stt.id = st."topicId"
      LEFT JOIN "Lesson" stl ON stl.id = stt."lessonId" LEFT JOIN "Module" stm ON stm.id = stl."moduleId"
    LEFT JOIN "Concept" c ON c.id = a."conceptId" LEFT JOIN "SubTopic" cst ON cst.id = c."subTopicId"
      LEFT JOIN "Topic" ct ON ct.id = cst."topicId" LEFT JOIN "Lesson" cl ON cl.id = ct."lessonId"
      LEFT JOIN "Module" cm ON cm.id = cl."moduleId"`);

  const contentSubmissions = await q(`SELECT cs.id, cs."contentId", cs."studentId", cs.status, cs.grade, cs.feedback,
      cs."submittedAt", cs."fileUrl", cs."textAnswer", c."assignmentId", c.type::text AS content_type,
      s.id AS asg_sub_id, s.status AS asg_status, s.grade AS asg_grade, s.feedback AS asg_feedback,
      s."fileUrl" AS asg_file_url, s."textAnswer" AS asg_text
    FROM "ContentSubmission" cs
    JOIN "Content" c ON c.id = cs."contentId"
    LEFT JOIN "AssignmentSubmission" s ON s."assignmentId" = c."assignmentId" AND s."studentId" = cs."studentId"`);

  const containers = {};
  for (const [parentField, table] of Object.entries(CHILD_TABLE)) {
    containers[parentField] = await q(`SELECT id, "${parentField}" AS parent_id, "order" FROM "${table}"`);
  }

  const quizSubs = await q(`SELECT "quizId", "studentId", passed FROM "QuizSubmission"`);
  const quizAttempts = await q(`SELECT DISTINCT "quizId", "studentId" FROM "QuizAttempt"`);
  const asgSubs = await q(`SELECT "assignmentId", "studentId", status FROM "AssignmentSubmission"`);
  const wrapperProgress = await q(`SELECT cp."contentId", cp."studentId", cp.completed, c."quizId", c."assignmentId"
    FROM "ContentProgress" cp JOIN "Content" c ON c.id = cp."contentId"
    WHERE c."quizId" IS NOT NULL OR c."assignmentId" IS NOT NULL`);

  return { checks, contents, quizzes, assignments, contentSubmissions, containers, quizSubs, quizAttempts, asgSubs, wrapperProgress };
}

function analyse(d) {
  const report = {};
  const wrapperByQuiz = new Map(d.contents.filter((c) => c.quizId).map((c) => [c.quizId, c]));
  const wrapperByAsg = new Map(d.contents.filter((c) => c.assignmentId).map((c) => [c.assignmentId, c]));

  report.checkConstraints = d.checks.map((c) => c.conname);

  // --- Content invariants -------------------------------------------------
  report.contentInvariants = {
    total: d.contents.length,
    byType: d.contents.reduce((acc, c) => ((acc[c.type] = (acc[c.type] || 0) + 1), acc), {}),
    parentCountNotOne: d.contents.filter((c) => c.parent_count !== 1).map((c) => c.id),
    quizTypeWithoutQuizId: d.contents.filter((c) => c.type === "QUIZ" && !c.quizId).map((c) => c.id),
    quizIdOnNonQuiz: d.contents.filter((c) => c.type !== "QUIZ" && c.quizId).map((c) => c.id),
    assignmentTypeWithoutAssignmentId: d.contents.filter((c) => c.type === "ASSIGNMENT" && !c.assignmentId).map((c) => c.id),
    assignmentIdOnNonAssignment: d.contents.filter((c) => c.type !== "ASSIGNMENT" && c.assignmentId).map((c) => c.id),
  };

  // --- Quizzes ------------------------------------------------------------
  const quizRows = d.quizzes.map((qz) => {
    const w = wrapperByQuiz.get(qz.id) || null;
    const cls = classifyQuiz(qz);
    return {
      id: qz.id, title: qz.title, tag: qz.quizTag, cls, batchId: qz.batchId, order: qz.order,
      createdAt: qz.createdAt, attempts: qz.attempts, submissions: qz.submissions,
      parent: parentKey(qz), wrapperId: w?.id || null, wrapperParent: w ? parentKey(w) : null, wrapperOrder: w?.order ?? null,
    };
  });
  report.quizzes = {
    total: quizRows.length,
    byClass: quizRows.reduce((acc, r) => ((acc[r.cls] = (acc[r.cls] || 0) + 1), acc), {}),
    nullOrderByTag: quizRows.filter((r) => r.order === null).reduce((acc, r) => ((acc[r.tag] = (acc[r.tag] || 0) + 1), acc), {}),
    sequenceQuizWithoutWrapper: quizRows.filter((r) => r.cls === "SEQUENCE" && !r.wrapperId).map((r) => r.id),
    standaloneQuizWithWrapper: quizRows.filter((r) => r.cls !== "SEQUENCE" && r.wrapperId).map((r) => ({ id: r.id, cls: r.cls })),
    wrapperPlacementConflicts: quizRows
      .filter((r) => r.wrapperId && r.wrapperParent !== r.parent)
      .map((r) => ({ id: r.id, quizParent: r.parent, wrapperParent: r.wrapperParent })),
    withAttemptsOrSubmissions: quizRows.filter((r) => r.attempts || r.submissions).length,
  };

  // --- Assignments --------------------------------------------------------
  const asgRows = d.assignments.map((a) => {
    const w = wrapperByAsg.get(a.id) || null;
    return {
      id: a.id, title: a.title, order: a.order, createdAt: a.createdAt, dueDate: a.dueDate,
      submissions: a.submissions, ownerCourse: a.owner_course, parent: parentKey(a),
      wrapperId: w?.id || null, wrapperParent: w ? parentKey(w) : null, wrapperOrder: w?.order ?? null,
      wrapperCreatedBeforeAssignment: w ? new Date(w.createdAt) < new Date(a.createdAt) : false,
    };
  });
  report.assignments = {
    total: asgRows.length,
    nullOrder: asgRows.filter((r) => r.order === null).map((r) => r.id),
    withoutWrapper: asgRows.filter((r) => !r.wrapperId).map((r) => r.id),
    wrapperPlacementConflicts: asgRows
      .filter((r) => r.wrapperId && r.wrapperParent !== r.parent)
      .map((r) => ({ id: r.id, assignmentParent: r.parent, wrapperParent: r.wrapperParent })),
    missingOwnerCourse: asgRows.filter((r) => !r.ownerCourse).map((r) => r.id),
    // A wrapper older than its Assignment means the Content row came first:
    // a legacy lesson-composer Assignment block that a backfill linked to a
    // newly created Assignment row.
    createdFromLegacyContentBlock: asgRows.filter((r) => r.wrapperCreatedBeforeAssignment).map((r) => ({
      id: r.id, wrapperId: r.wrapperId, dueDate: r.dueDate, createdAt: r.createdAt,
    })),
    withSubmissions: asgRows.filter((r) => r.submissions).length,
  };

  // --- Legacy content assignments ----------------------------------------
  const asgContents = d.contents.filter((c) => c.type === "ASSIGNMENT");
  report.legacyContentAssignments = {
    assignmentContentWithData: asgContents.filter((c) => c.has_data).map((c) => c.id),
    assignmentContentWithHtml: asgContents.filter((c) => c.has_html).map((c) => c.id),
    contentSubmissions: d.contentSubmissions.length,
    contentSubmissionsNotMirrored: d.contentSubmissions
      .filter((s) => !s.asg_sub_id)
      .map((s) => ({ id: s.id, contentId: s.contentId, studentId: s.studentId, assignmentId: s.assignmentId })),
    contentSubmissionsMirroredWithDifferences: d.contentSubmissions
      .filter((s) => s.asg_sub_id && (s.status !== s.asg_status || (s.grade || null) !== (s.asg_grade || null)
        || (s.feedback || null) !== (s.asg_feedback || null) || (s.fileUrl || null) !== (s.asg_file_url || null)
        || (s.textAnswer || null) !== (s.asg_text || null)))
      .map((s) => s.id),
  };

  // --- Order analysis per parent -----------------------------------------
  // The pre-migration common sequence: normal content by Content.order,
  // quizzes/assignments by their own (original) order, child containers by
  // theirs. Wrapper Content rows are reported separately.
  const parents = new Map();
  const add = (key, entry) => {
    if (!key) return;
    if (!parents.has(key)) parents.set(key, []);
    parents.get(key).push(entry);
  };
  for (const c of d.contents) {
    if (c.quizId || c.assignmentId) continue;
    add(parentKey(c), { kind: "content", id: c.id, order: c.order });
  }
  for (const r of quizRows) if (r.cls === "SEQUENCE") add(r.parent, { kind: "quiz", id: r.id, order: r.order });
  for (const r of asgRows) add(r.parent, { kind: "assignment", id: r.id, order: r.order });
  for (const [parentField, rows] of Object.entries(d.containers)) {
    for (const row of rows) add(`${parentField}:${row.parent_id}`, { kind: "child", id: row.id, order: row.order });
  }

  const crossTypeCollisions = [];
  const placement = { ownBeforeChildren: 0, ownAfterChildren: 0, interleaved: 0, examplesInterleaved: [] };
  const assessmentsAfterChildren = { yes: 0, no: 0 };
  for (const [key, entries] of parents) {
    const byOrder = new Map();
    for (const e of entries) {
      if (e.order === null || e.order === undefined) continue;
      if (!byOrder.has(e.order)) byOrder.set(e.order, []);
      byOrder.get(e.order).push(e);
    }
    for (const [order, list] of byOrder) {
      if (list.length > 1) crossTypeCollisions.push({ parent: key, order, items: list.map((e) => `${e.kind}:${e.id}`) });
    }
    const children = entries.filter((e) => e.kind === "child");
    const own = entries.filter((e) => e.kind !== "child" && typeof e.order === "number");
    if (!children.length || !own.length) continue;
    const minChild = Math.min(...children.map((e) => e.order));
    const maxChild = Math.max(...children.map((e) => e.order));
    const before = own.filter((e) => e.order < minChild).length;
    const after = own.filter((e) => e.order > maxChild).length;
    if (before === own.length) placement.ownBeforeChildren++;
    else if (after === own.length) placement.ownAfterChildren++;
    else {
      placement.interleaved++;
      if (placement.examplesInterleaved.length < 10) {
        placement.examplesInterleaved.push({
          parent: key,
          sequence: [...entries].filter((e) => typeof e.order === "number").sort((a, b) => a.order - b.order)
            .map((e) => `${e.order}:${e.kind}`).join(" "),
        });
      }
    }
    for (const e of own.filter((x) => x.kind !== "content")) {
      if (e.order > maxChild) assessmentsAfterChildren.yes++;
      else assessmentsAfterChildren.no++;
    }
  }
  report.ordering = {
    parentsAnalysed: parents.size,
    crossTypeCollisions,
    ownItemsVsChildContainers: placement,
    quizAndAssignmentAfterAllChildren: assessmentsAfterChildren,
  };

  // Where each wrapper sits vs where its item sat in the old common sequence.
  const wrapperPosition = { atOriginalOrder: 0, elsewhere: 0, originalUnknown: 0, examples: [] };
  for (const r of [...quizRows.filter((x) => x.wrapperId).map((x) => ({ ...x, kind: "quiz" })),
    ...asgRows.filter((x) => x.wrapperId).map((x) => ({ ...x, kind: "assignment" }))]) {
    if (r.order === null) wrapperPosition.originalUnknown++;
    else if (r.order === r.wrapperOrder) wrapperPosition.atOriginalOrder++;
    else {
      wrapperPosition.elsewhere++;
      if (wrapperPosition.examples.length < 10) {
        wrapperPosition.examples.push({ kind: r.kind, id: r.id, originalOrder: r.order, wrapperOrder: r.wrapperOrder });
      }
    }
  }
  report.wrapperPosition = wrapperPosition;

  // --- Progress agreement -------------------------------------------------
  const passed = new Set(d.quizSubs.filter((s) => s.passed).map((s) => `${s.quizId}|${s.studentId}`));
  const attempted = new Set(d.quizAttempts.map((s) => `${s.quizId}|${s.studentId}`));
  for (const s of d.quizSubs) attempted.add(`${s.quizId}|${s.studentId}`);
  const submitted = new Set(d.asgSubs.filter((s) => ["Submitted", "Graded"].includes(s.status)).map((s) => `${s.assignmentId}|${s.studentId}`));
  const tagById = new Map(d.quizzes.map((qz) => [qz.id, qz.quizTag]));
  const quizDone = (quizId, studentId) => {
    const key = `${quizId}|${studentId}`;
    return tagById.get(quizId) === "SELF_TEST" ? attempted.has(key) : passed.has(key);
  };
  const progress = { wrapperRows: d.wrapperProgress.length, completedButDomainIncomplete: [], domainCompleteButNoCompletedRow: 0 };
  const completedKeys = new Set();
  for (const p of d.wrapperProgress) {
    const done = p.quizId ? quizDone(p.quizId, p.studentId) : submitted.has(`${p.assignmentId}|${p.studentId}`);
    if (p.completed) completedKeys.add(`${p.quizId || p.assignmentId}|${p.studentId}`);
    if (p.completed && !done) progress.completedButDomainIncomplete.push({ contentId: p.contentId, studentId: p.studentId });
  }
  for (const qz of d.quizzes) {
    if (!wrapperByQuiz.has(qz.id)) continue;
    for (const key of attempted) {
      const [quizId, studentId] = key.split("|");
      if (quizId === qz.id && quizDone(quizId, studentId) && !completedKeys.has(key)) progress.domainCompleteButNoCompletedRow++;
    }
  }
  for (const key of submitted) {
    const [assignmentId] = key.split("|");
    if (wrapperByAsg.has(assignmentId) && !completedKeys.has(key)) progress.domainCompleteButNoCompletedRow++;
  }
  report.progress = progress;

  return { report, detail: { quizRows, asgRows } };
}

async function main() {
  const jsonIndex = process.argv.indexOf("--json");
  const jsonPath = jsonIndex > -1 ? process.argv[jsonIndex + 1] : null;

  const data = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return collect(tx);
    },
    { timeout: 180000, maxWait: 30000 }
  );

  const { report, detail } = analyse(data);
  console.log(JSON.stringify(report, null, 2));
  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify({ report, detail }, null, 2));
    console.log(`\nFull detail written to ${jsonPath}`);
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { classifyQuiz, PRACTICE_QUIZ_TITLE };
