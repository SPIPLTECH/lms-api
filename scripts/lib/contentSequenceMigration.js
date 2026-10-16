/**
 * Plans the Quiz/Assignment -> unified Content sequence migration.
 *
 * Pure: given a snapshot of the database (plain rows), it returns the exact
 * list of changes to make and a report of what it found. The runner
 * (scripts/migrateContentSequence.js) loads the snapshot, writes a backup,
 * applies the plan in one transaction and re-checks the invariants before
 * committing. Keeping the decisions here makes every one of them testable
 * without a database (test/content-sequence-migration.test.js).
 *
 * What it does:
 *  1. Classifies every Quiz. Standalone: QUALIFYING tests, batch-scoped
 *     assessments, student-generated practice quizzes — they must NOT be
 *     learning-sequence items. Every other quiz is a sequence item.
 *  2. Gives every sequence Quiz and every Assignment exactly one Content
 *     wrapper (type QUIZ / ASSIGNMENT), and removes a wrapper from any
 *     standalone quiz.
 *  3. Reconciles legacy lesson-composer assignment blocks
 *     (Content type ASSIGNMENT with no Assignment): creates the Assignment
 *     (title, htmlContent -> description, the block's file -> attachments,
 *     no due date), links it, and copies its ContentSubmission rows into
 *     AssignmentSubmission (grades, feedback, status, files, timestamps).
 *  4. Repairs a wrapper whose parent is wrong: exactly the most specific
 *     parent of the Quiz/Assignment it wraps, nothing else.
 *  5. Numbers every parent's ONE sequence — its Content rows and its child
 *     containers together — 1..n: positions already distinct are kept; where
 *     the two kinds collide, each kind keeps its relative order and they are
 *     merged by when items were added.
 *  6. Clears due dates invented by an earlier backfill (exactly 14 days after
 *     a legacy block's Assignment was created) — the block never had one.
 *  7. Makes each wrapper's ContentProgress match the one completion rule
 *     (utils/itemCompletion.js) and carries QuizProgress/AssignmentProgress
 *     visits over to it.
 */
const { summarizeQuizAttempts, isQuizComplete, isAssignmentSubmissionComplete } = require("../../src/utils/itemCompletion");

const PRACTICE_QUIZ_TITLE = "Self-Generated Practice Quiz";
const PARENTS_MOST_SPECIFIC_FIRST = ["conceptId", "subTopicId", "topicId", "lessonId", "moduleId", "courseId"];
const PARENT_FIELDS = [...PARENTS_MOST_SPECIFIC_FIRST].reverse();
const INVENTED_DUE_DATE_MS = 14 * 24 * 60 * 60 * 1000;
const KIND_RANK = { content: 1, assignment: 2, quiz: 3 };

const mostSpecific = (row) => PARENTS_MOST_SPECIFIC_FIRST.find((field) => row?.[field]) || null;
const parentKeyOf = (row) => {
  const field = mostSpecific(row);
  return field ? `${field}:${row[field]}` : null;
};
const singleParent = (row) => {
  const field = mostSpecific(row);
  const data = {};
  for (const f of PARENT_FIELDS) data[f] = f === field ? row[field] : null;
  return data;
};
const sameParent = (a, b) => PARENT_FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));
const time = (value) => (value ? new Date(value).getTime() : 0);

/** Why a quiz is not a learning-sequence item, or null when it is one. */
function standaloneReason(quiz) {
  if (quiz.quizTag === "QUALIFYING") return "QUALIFYING";
  if (quiz.batchId) return "BATCH";
  if (quiz.title === PRACTICE_QUIZ_TITLE && (quiz.order === null || quiz.order === undefined)) return "PRACTICE";
  return null;
}

/** The instructor file a legacy assignment block carried, as an Assignment attachment. */
function attachmentFromBlock(content) {
  if (!content.fileUrl) return null;
  const fromData = content.data && typeof content.data === "object" ? content.data.originalFileName : null;
  const fromUrl = decodeURIComponent(String(content.fileUrl).split("?")[0].split("/").pop() || "");
  return { url: content.fileUrl, name: fromData || fromUrl || "Attachment", type: null };
}

/**
 * @param {object} snapshot
 *   contents:              Content rows (id, type, order, title, 6 parent ids, quizId,
 *                          assignmentId, createdAt, htmlContent, fileUrl, data)
 *   quizzes:               Quiz rows (id, title, quizTag, batchId, order, passingScore,
 *                          6 parent ids, createdAt)
 *   assignments:           Assignment rows (id, title, order, dueDate, attachments,
 *                          6 parent ids, createdAt)
 *   contentSubmissions:    ContentSubmission rows
 *   assignmentSubmissions: AssignmentSubmission rows
 *   quizAttempts:          QuizAttempt rows (quizId, studentId, passed, submittedAt)
 *   quizSubmissions:       QuizSubmission rows (quizId, studentId, passed, percentage, submittedAt)
 *   contentProgress:       ContentProgress rows
 *   quizProgress:          QuizProgress rows
 *   assignmentProgress:    AssignmentProgress rows
 * @param {{ newId: () => string }} ids
 */
function planContentSequenceMigration(snapshot, { newId }) {
  const contents = snapshot.contents.map((c) => ({ ...c }));
  const contentById = new Map(contents.map((c) => [c.id, c]));
  const quizById = new Map(snapshot.quizzes.map((q) => [q.id, q]));
  const assignments = snapshot.assignments.map((a) => ({ ...a }));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));

  const plan = {
    deleteContents: [], // [contentId]
    createAssignments: [], // [{ data }]
    createContents: [], // [{ data }]
    linkContents: [], // [{ id, assignmentId }]
    updateAssignments: [], // [{ id, data }]
    createAssignmentSubmissions: [], // [{ data }]
    reparentContents: [], // [{ id, data }]
    reorderContents: [], // [{ id, order }]  (final orders; the runner parks first)
    reorderContainers: [], // [{ kind, id, order }]  (same parent sequences)
    upsertContentProgress: [], // [{ studentId, contentId, data }]
  };
  const report = {
    quizzes: { sequence: 0, standalone: {} },
    wrappersCreated: { QUIZ: 0, ASSIGNMENT: 0 },
    wrappersRemovedFromStandaloneQuizzes: 0,
    legacyBlocksReconciled: 0,
    legacySubmissionsCopied: 0,
    legacySubmissionsAlreadyPresent: 0,
    legacySubmissionConflicts: [],
    attachmentsRecovered: 0,
    inventedDueDatesCleared: 0,
    wrappersReparented: 0,
    parentsReordered: 0,
    contentRowsReordered: 0,
    containersReordered: 0,
    progressRowsSynced: 0,
    unresolved: [],
  };

  // --- 1 + 2a. Quizzes ------------------------------------------------------
  const wrapperByQuiz = new Map(contents.filter((c) => c.quizId).map((c) => [c.quizId, c]));
  for (const quiz of snapshot.quizzes) {
    const reason = standaloneReason(quiz);
    const wrapper = wrapperByQuiz.get(quiz.id);
    if (reason) {
      report.quizzes.standalone[reason] = (report.quizzes.standalone[reason] || 0) + 1;
      if (wrapper) {
        plan.deleteContents.push(wrapper.id);
        contentById.delete(wrapper.id);
        report.wrappersRemovedFromStandaloneQuizzes += 1;
      }
      continue;
    }
    report.quizzes.sequence += 1;
    if (!wrapper) {
      if (!mostSpecific(quiz)) {
        report.unresolved.push({ kind: "quiz", id: quiz.id, reason: "no parent" });
        continue;
      }
      const row = {
        id: newId(),
        type: "QUIZ",
        title: quiz.title,
        quizId: quiz.id,
        assignmentId: null,
        order: null, // set by the reorder step
        createdAt: quiz.createdAt,
        ...singleParent(quiz),
      };
      plan.createContents.push({ data: row });
      contentById.set(row.id, row);
      report.wrappersCreated.QUIZ += 1;
    }
  }

  // --- 3. Legacy assignment blocks -----------------------------------------
  const submissionsByContent = new Map();
  for (const sub of snapshot.contentSubmissions) {
    if (!submissionsByContent.has(sub.contentId)) submissionsByContent.set(sub.contentId, []);
    submissionsByContent.get(sub.contentId).push(sub);
  }
  const existingAsgSub = new Map(snapshot.assignmentSubmissions.map((s) => [`${s.assignmentId}|${s.studentId}`, s]));

  for (const content of [...contentById.values()]) {
    if (content.type !== "ASSIGNMENT" || content.assignmentId) continue;
    const assignmentId = newId();
    const attachment = attachmentFromBlock(content);
    const data = {
      id: assignmentId,
      title: content.title || "Assignment",
      description: content.htmlContent || null,
      dueDate: null,
      attachments: attachment ? [attachment] : undefined,
      isPublished: true,
      ...singleParent(content),
    };
    plan.createAssignments.push({ data });
    plan.linkContents.push({ id: content.id, assignmentId });
    content.assignmentId = assignmentId;
    const asg = { ...data, createdAt: content.createdAt, order: content.order };
    assignments.push(asg);
    assignmentById.set(assignmentId, asg);
    report.legacyBlocksReconciled += 1;
    if (attachment) report.attachmentsRecovered += 1;
  }

  // Copy every ContentSubmission of a block into its Assignment (legacy blocks
  // reconciled now, and any reconciled earlier whose copies are missing).
  for (const [contentId, subs] of submissionsByContent) {
    const content = contentById.get(contentId);
    if (!content?.assignmentId) continue;
    for (const sub of subs) {
      const key = `${content.assignmentId}|${sub.studentId}`;
      const existing = existingAsgSub.get(key);
      if (existing) {
        const same =
          existing.status === sub.status &&
          (existing.grade ?? null) === (sub.grade ?? null) &&
          (existing.feedback ?? null) === (sub.feedback ?? null) &&
          (existing.fileUrl ?? null) === (sub.fileUrl ?? null) &&
          (existing.textAnswer ?? null) === (sub.textAnswer ?? null);
        if (same) report.legacySubmissionsAlreadyPresent += 1;
        else report.legacySubmissionConflicts.push({ contentSubmissionId: sub.id, assignmentSubmissionId: existing.id });
        continue;
      }
      const data = {
        id: newId(),
        assignmentId: content.assignmentId,
        studentId: sub.studentId,
        status: sub.status,
        grade: sub.grade ?? null,
        feedback: sub.feedback ?? null,
        submittedAt: sub.submittedAt,
        fileUrl: sub.fileUrl ?? null,
        fileName: sub.fileName ?? null,
        fileSize: sub.fileSize ?? null,
        fileType: sub.fileType ?? null,
        textAnswer: sub.textAnswer ?? null,
      };
      plan.createAssignmentSubmissions.push({ data });
      existingAsgSub.set(key, data);
      report.legacySubmissionsCopied += 1;
    }
  }

  // --- 2b. Assignments without a wrapper -----------------------------------
  const wrapperByAssignment = new Map([...contentById.values()].filter((c) => c.assignmentId).map((c) => [c.assignmentId, c]));
  for (const asg of assignments) {
    if (wrapperByAssignment.has(asg.id)) continue;
    if (!mostSpecific(asg)) {
      report.unresolved.push({ kind: "assignment", id: asg.id, reason: "no parent" });
      continue;
    }
    const row = {
      id: newId(),
      type: "ASSIGNMENT",
      title: asg.title,
      quizId: null,
      assignmentId: asg.id,
      order: null,
      createdAt: asg.createdAt,
      ...singleParent(asg),
    };
    plan.createContents.push({ data: row });
    contentById.set(row.id, row);
    wrapperByAssignment.set(asg.id, row);
    report.wrappersCreated.ASSIGNMENT += 1;
  }

  // --- 6. Invented due dates ------------------------------------------------
  for (const asg of assignments) {
    const wrapper = wrapperByAssignment.get(asg.id);
    if (!wrapper || !asg.dueDate) continue;
    const blockCameFirst = time(wrapper.createdAt) < time(asg.createdAt);
    const invented = Math.abs(time(asg.dueDate) - time(asg.createdAt) - INVENTED_DUE_DATE_MS) < 60 * 1000;
    if (blockCameFirst && invented) {
      plan.updateAssignments.push({ id: asg.id, data: { dueDate: null } });
      report.inventedDueDatesCleared += 1;
    }
    // A block reconciled before this run whose file never reached its Assignment.
    if (blockCameFirst && (!Array.isArray(asg.attachments) || asg.attachments.length === 0)) {
      const attachment = attachmentFromBlock(wrapper);
      if (attachment) {
        const pending = plan.updateAssignments.find((u) => u.id === asg.id);
        if (pending) pending.data.attachments = [attachment];
        else plan.updateAssignments.push({ id: asg.id, data: { attachments: [attachment] } });
        report.attachmentsRecovered += 1;
      }
    }
  }

  // --- 4. Wrapper placement -------------------------------------------------
  for (const content of contentById.values()) {
    const domain = content.quizId ? quizById.get(content.quizId) : content.assignmentId ? assignmentById.get(content.assignmentId) : null;
    if (!domain) continue;
    const target = singleParent(domain);
    if (sameParent(content, target)) continue;
    Object.assign(content, target);
    if (!plan.createContents.some((c) => c.data.id === content.id)) {
      plan.reparentContents.push({ id: content.id, data: target });
      report.wrappersReparented += 1;
    }
  }

  // --- 5. ONE sequence per parent: its Content rows AND its child containers --
  // A parent's Content rows (ordinary content, quiz and assignment rows) and
  // its child containers share one numbering, in the order things were added.
  //  - Positions already distinct across both kinds: kept, compacted to 1..n.
  //  - Positions colliding (each kind numbered on its own): each kind keeps its
  //    current relative order, and the kinds are merged by when items were
  //    added — an item counts as added no later than anything after it in its
  //    own kind, so a manual reorder within a kind is never undone.
  const CONTAINER_PARENT = { module: "courseId", lesson: "moduleId", topic: "lessonId", subTopic: "topicId", concept: "subTopicId" };
  const containersByParent = new Map();
  for (const [kind, rows] of Object.entries(snapshot.containers || {})) {
    for (const row of rows) {
      const key = `${CONTAINER_PARENT[kind]}:${row[CONTAINER_PARENT[kind]]}`;
      if (!containersByParent.has(key)) containersByParent.set(key, []);
      containersByParent.get(key).push({ ...row, kind });
    }
  }

  const byParent = new Map();
  for (const content of contentById.values()) {
    const key = parentKeyOf(content);
    if (!key) continue;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(content);
  }
  for (const key of containersByParent.keys()) if (!byParent.has(key)) byParent.set(key, []);

  const createdIds = new Set(plan.createContents.map((created) => created.data.id));
  const KIND_TIE = { content: 0, container: 1 };
  const finalContainers = [];

  const monotoneTimes = (rows) => {
    const times = new Array(rows.length);
    let floor = Infinity;
    for (let i = rows.length - 1; i >= 0; i--) {
      floor = Math.min(floor, time(rows[i].createdAt) || Infinity);
      times[i] = floor;
    }
    return times;
  };

  for (const [key, contentRows] of byParent) {
    const containers = containersByParent.get(key) || [];
    const sortedContent = [...contentRows].sort(
      (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || time(a.createdAt) - time(b.createdAt) || String(a.id).localeCompare(String(b.id))
    );
    const sortedContainers = [...containers].sort(
      (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || time(a.createdAt) - time(b.createdAt)
    );

    const all = [...sortedContent.map((row) => ({ row, kind: "content" })), ...sortedContainers.map((row) => ({ row, kind: "container" }))];
    const orders = all.map((entry) => entry.row.order);
    const distinct = orders.every((o) => Number.isInteger(o)) && new Set(orders).size === orders.length;

    let merged;
    if (distinct) {
      merged = [...all].sort((a, b) => a.row.order - b.row.order);
    } else {
      const contentTimes = monotoneTimes(sortedContent);
      const containerTimes = monotoneTimes(sortedContainers);
      merged = [];
      let i = 0;
      let j = 0;
      while (i < sortedContent.length || j < sortedContainers.length) {
        const takeContent =
          j >= sortedContainers.length ||
          (i < sortedContent.length &&
            (contentTimes[i] < containerTimes[j] ||
              (contentTimes[i] === containerTimes[j] && KIND_TIE.content <= KIND_TIE.container)));
        if (takeContent) merged.push({ row: sortedContent[i++], kind: "content" });
        else merged.push({ row: sortedContainers[j++], kind: "container" });
      }
    }

    let changed = false;
    merged.forEach(({ row, kind }, index) => {
      const order = index + 1;
      if (row.order === order) {
        if (kind === "container") finalContainers.push({ ...row, order });
        return;
      }
      changed = true;
      if (kind === "content") {
        if (!createdIds.has(row.id)) plan.reorderContents.push({ id: row.id, order, parentKey: key });
        row.order = order;
      } else {
        plan.reorderContainers.push({ kind: row.kind, id: row.id, order, parentKey: key });
        finalContainers.push({ ...row, order });
      }
    });
    if (changed) report.parentsReordered += 1;
  }
  report.contentRowsReordered = plan.reorderContents.length;
  report.containersReordered = plan.reorderContainers.length;
  // New wrappers carry their final order from here.
  for (const created of plan.createContents) created.data.order = contentById.get(created.data.id).order;

  // --- 7. ContentProgress of every wrapper ------------------------------------
  const attemptsByKey = new Map();
  for (const attempt of snapshot.quizAttempts) {
    const key = `${attempt.quizId}|${attempt.studentId}`;
    if (!attemptsByKey.has(key)) attemptsByKey.set(key, []);
    attemptsByKey.get(key).push(attempt);
  }
  const quizSubByKey = new Map(snapshot.quizSubmissions.map((s) => [`${s.quizId}|${s.studentId}`, s]));
  const cpByKey = new Map(snapshot.contentProgress.map((p) => [`${p.contentId}|${p.studentId}`, p]));
  const quizVisit = new Map(snapshot.quizProgress.filter((p) => p.visited).map((p) => [`${p.quizId}|${p.studentId}`, p]));
  const asgVisit = new Map(snapshot.assignmentProgress.filter((p) => p.visited).map((p) => [`${p.assignmentId}|${p.studentId}`, p]));

  for (const content of contentById.values()) {
    if (!content.quizId && !content.assignmentId) continue;
    const students = new Set();
    const domainId = content.quizId || content.assignmentId;
    const collect = (rows, field) => rows.filter((r) => r[field] === domainId).forEach((r) => students.add(r.studentId));
    if (content.quizId) {
      collect(snapshot.quizAttempts, "quizId");
      collect(snapshot.quizSubmissions, "quizId");
      collect(snapshot.quizProgress, "quizId");
    } else {
      [...existingAsgSub.values()].filter((s) => s.assignmentId === domainId).forEach((s) => students.add(s.studentId));
      collect(snapshot.assignmentProgress, "assignmentId");
    }
    snapshot.contentProgress.filter((p) => p.contentId === content.id).forEach((p) => students.add(p.studentId));

    for (const studentId of students) {
      const key = `${domainId}|${studentId}`;
      let completed;
      let completedAt = null;
      let activityAt = null;
      if (content.quizId) {
        const quiz = quizById.get(content.quizId);
        const attempts = attemptsByKey.get(key) || [];
        const latest = quizSubByKey.get(key) || null;
        const summary = summarizeQuizAttempts(attempts, latest, quiz?.passingScore);
        completed = isQuizComplete(quiz?.quizTag, summary);
        const relevant = quiz?.quizTag === "SELF_TEST" ? attempts : attempts.filter((a) => a.passed);
        const stamps = [...relevant.map((a) => time(a.submittedAt)), latest ? time(latest.submittedAt) : 0].filter(Boolean);
        completedAt = completed && stamps.length ? new Date(Math.min(...stamps)) : null;
        const any = [...attempts.map((a) => time(a.submittedAt)), latest ? time(latest.submittedAt) : 0].filter(Boolean);
        activityAt = any.length ? new Date(Math.min(...any)) : null;
      } else {
        const sub = existingAsgSub.get(key) || null;
        completed = isAssignmentSubmissionComplete(sub);
        completedAt = completed ? new Date(sub.submittedAt) : null;
        activityAt = sub ? new Date(sub.submittedAt) : null;
      }
      const visitRow = content.quizId ? quizVisit.get(key) : asgVisit.get(key);
      const current = cpByKey.get(`${content.id}|${studentId}`) || null;
      const visited = Boolean(current?.visited || visitRow || activityAt);
      const visitedAt = current?.visitedAt || visitRow?.visitedAt || activityAt || null;
      const nextCompletedAt = completed ? current?.completedAt || completedAt || new Date() : null;

      if (current && current.completed === completed && current.visited === visited) continue;
      plan.upsertContentProgress.push({
        studentId,
        contentId: content.id,
        data: { completed, completedAt: nextCompletedAt, visited, visitedAt: visited ? visitedAt : null },
      });
    }
  }
  report.progressRowsSynced = plan.upsertContentProgress.length;

  return { plan, report, finalContents: [...contentById.values()], finalContainers };
}

/**
 * The invariants the migration must leave behind — checked on the planned
 * state here, and again on the real rows inside the transaction before commit.
 */
function checkInvariants(contents, containers = []) {
  const problems = [];
  const orders = new Map();
  const quizIds = new Set();
  const assignmentIds = new Set();
  for (const c of contents) {
    const parents = PARENT_FIELDS.filter((f) => c[f]).length;
    if (parents !== 1) problems.push({ id: c.id, problem: `has ${parents} parents` });
    if (c.type === "QUIZ" && (!c.quizId || c.assignmentId)) problems.push({ id: c.id, problem: "QUIZ without exactly a quizId" });
    if (c.type === "ASSIGNMENT" && (!c.assignmentId || c.quizId)) problems.push({ id: c.id, problem: "ASSIGNMENT without exactly an assignmentId" });
    if (c.type !== "QUIZ" && c.type !== "ASSIGNMENT" && (c.quizId || c.assignmentId)) problems.push({ id: c.id, problem: `${c.type} carries a quiz/assignment link` });
    if (c.quizId) {
      if (quizIds.has(c.quizId)) problems.push({ id: c.id, problem: "quiz wrapped twice" });
      quizIds.add(c.quizId);
    }
    if (c.assignmentId) {
      if (assignmentIds.has(c.assignmentId)) problems.push({ id: c.id, problem: "assignment wrapped twice" });
      assignmentIds.add(c.assignmentId);
    }
    const key = `${parentKeyOf(c)}#${c.order}`;
    if (orders.has(key)) problems.push({ id: c.id, problem: `duplicate order with ${orders.get(key)}` });
    orders.set(key, c.id);
  }
  // A parent's child containers share its sequence with its Content rows.
  const CONTAINER_PARENT = { module: "courseId", lesson: "moduleId", topic: "lessonId", subTopic: "topicId", concept: "subTopicId" };
  for (const row of containers) {
    const field = CONTAINER_PARENT[row.kind];
    const key = `${field}:${row[field]}#${row.order}`;
    if (orders.has(key)) problems.push({ id: row.id, problem: `duplicate order with ${orders.get(key)}` });
    orders.set(key, row.id);
  }
  return problems;
}

module.exports = {
  PRACTICE_QUIZ_TITLE,
  standaloneReason,
  attachmentFromBlock,
  planContentSequenceMigration,
  checkInvariants,
  parentKeyOf,
};
