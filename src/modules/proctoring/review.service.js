const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const { AUDIT_EVENTS, recordAuditEvent } = require("../audit/audit.service");
const notificationService = require("../notifications/notification.service");
const { APPEAL_WINDOW_MS, OPEN_STATUSES, canStillAppeal } = require("./attemptStanding");
const evidence = require("./evidence.service");
const { DEFAULT_POLICY, calculateRisk, isViolationEvent } = require("./rules");

/**
 * What happens after an exam needs a person: the review list, the decision, appeals and reminders.
 * Nothing here decides anything by itself. A terminated attempt can only be upheld or retaken, so
 * it can never become a pass. A flagged attempt keeps its score until someone says otherwise.
 */

const REVIEW_DUE_MS = 7 * 24 * 60 * 60 * 1000;
const REMINDER_BATCH = 100;
const DECISIONS = { TERMINATED: ["UPHOLD", "RETAKE"], FLAGGED: ["ACCEPT", "VOID", "RETAKE"] };

const allowedDecisions = (attempt) => DECISIONS[attempt.status === "TERMINATED" ? "TERMINATED" : "FLAGGED"];

const isStaffFor = (user, attempt) => user.role === "ADMIN" || (user.role === "INSTRUCTOR" && attempt.quiz?.course?.creatorId === user.id);

const reviewLink = (attemptId) => `/instructor/proctoring/${attemptId}`;

async function loadForStaff(user, attemptId, include = {}) {
  const attempt = await prisma.proctoredAttempt.findUnique({
    where: { id: attemptId },
    include: { quiz: { select: { id: true, title: true, quizTag: true, passingScore: true, courseId: true, course: { select: { id: true, title: true, creatorId: true } } } }, ...include },
  });
  if (!attempt) throw new ApiError(404, "Exam attempt not found.", "ATTEMPT_NOT_FOUND");
  if (!isStaffFor(user, attempt)) throw new ApiError(403, "You cannot review this attempt.", "REVIEW_FORBIDDEN");
  return attempt;
}

const STATE_FILTERS = { PENDING: { reviewState: "PENDING" }, DECIDED: { reviewState: "DECIDED" }, ALL: { reviewState: { not: "NONE" } } };

/** GET /reviews. An instructor's own courses, or everything for an admin. */
async function listReviews(user, { state = "PENDING", courseId, page = 1, limit = 25 } = {}) {
  const where = {
    ...(STATE_FILTERS[state] ?? STATE_FILTERS.PENDING),
    ...(courseId ? { courseId } : {}),
    ...(user.role === "ADMIN" ? {} : { quiz: { course: { creatorId: user.id } } }),
  };
  const [total, rows] = await Promise.all([
    prisma.proctoredAttempt.count({ where }),
    prisma.proctoredAttempt.findMany({
      where,
      orderBy: [{ reviewDueAt: "asc" }, { endedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        status: true,
        reviewState: true,
        reviewReason: true,
        reviewDueAt: true,
        reviewRound: true,
        decision: true,
        decidedAt: true,
        endedAt: true,
        warningCount: true,
        policy: true,
        isFlagged: true,
        flags: true,
        microphoneStatus: true,
        quiz: { select: { title: true, quizTag: true, course: { select: { title: true } } } },
        student: { select: { user: { select: { name: true, email: true } } } },
        quizAttempt: { select: { percentage: true, passed: true } },
      },
    }),
  ]);
  const now = Date.now();
  return {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    items: rows.map((row) => ({
      attemptId: row.id,
      status: row.status,
      reviewState: row.reviewState,
      reviewReason: row.reviewReason,
      reviewDueAt: row.reviewDueAt,
      overdue: row.reviewState === "PENDING" && row.reviewDueAt ? row.reviewDueAt.getTime() < now : false,
      isAppeal: row.reviewState === "PENDING" && row.reviewRound > 0,
      decision: row.decision,
      decidedAt: row.decidedAt,
      endedAt: row.endedAt,
      warningCount: Math.min(row.warningCount ?? 0, row.policy?.maxWarnings ?? DEFAULT_POLICY.maxWarnings),
      maxWarnings: row.policy?.maxWarnings ?? DEFAULT_POLICY.maxWarnings,
      flagReasons: (Array.isArray(row.flags) ? row.flags : []).map((flag) => flag.reason),
      microphoneStatus: row.microphoneStatus,
      quizTitle: row.quiz.title,
      quizTag: row.quiz.quizTag,
      courseTitle: row.quiz.course?.title ?? null,
      studentName: row.student?.user?.name ?? null,
      studentEmail: row.student?.user?.email ?? null,
      percentage: row.quizAttempt?.percentage ?? null,
      passed: row.quizAttempt?.passed ?? false,
    })),
  };
}

/** The AI's findings for staff: what it saw, in a form a reviewer can read. Never a face template. */
function analysisSummary(analysis) {
  if (!analysis) return null;
  return {
    status: analysis.status,
    errorCode: analysis.errorCode ?? null,
    facesDetected: analysis.facesDetected ?? null,
    classification: analysis.classification ?? null,
    faceScores: (analysis.faces ?? []).map((face) => face.score),
    objects: (analysis.objects?.items ?? []).map((item) => ({ label: item.label, score: item.score })),
    identity: analysis.identity ? { status: analysis.identity.status, similarity: analysis.identity.similarity ?? null, threshold: analysis.identity.threshold ?? null } : null,
    headPose: analysis.headPose ? { orientation: analysis.headPose.orientation, direction: analysis.headPose.direction, yawDeg: analysis.headPose.yawDeg } : null,
  };
}

/** GET /reviews/:attemptId: everything a reviewer needs on one page. */
async function getReview(user, attemptId) {
  const attempt = await loadForStaff(user, attemptId, {
    student: { select: { user: { select: { id: true, name: true, email: true } } } },
    quizAttempt: { select: { score: true, totalMarks: true, percentage: true, passed: true, attemptNumber: true } },
    events: { orderBy: { serverTimestamp: "asc" } },
    evidence: { orderBy: { receivedAt: "asc" }, select: { id: true, frameId: true, type: true, category: true, storageState: true, receivedAt: true, clientCapturedAt: true, late: true, retainUntil: true, reviewHold: true, analysis: true } },
    reviewRequests: { orderBy: { round: "asc" } },
    retakeGrant: { select: { usedAt: true } },
  });
  const consent = attempt.consentId
    ? await prisma.proctoringConsent.findUnique({ where: { id: attempt.consentId }, select: { wordingVersion: true, wordingHash: true, identityMatching: true, acceptedAt: true } })
    : null;
  const policy = { ...DEFAULT_POLICY, ...(attempt.policy || {}) };
  const clampedWarnings = Math.min(attempt.warningCount ?? 0, policy.maxWarnings);
  const violationCount = attempt.events.filter((event) => isViolationEvent(event.eventType)).length;
  return {
    attempt: {
      id: attempt.id,
      status: attempt.status,
      endReason: attempt.endReason,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      endedAt: attempt.endedAt,
      terminatedAt: attempt.terminatedAt,
      terminationRule: attempt.terminationRule,
      terminationReason: attempt.terminationReason,
      identityCheck: attempt.identityCheck,
      identityNotes: attempt.identityNotes,
      identityFailures: attempt.identityFailures,
      identityMatching: attempt.identityMatching,
      microphoneStatus: attempt.microphoneStatus,
      warningCount: clampedWarnings,
      maxWarnings: policy.maxWarnings,
      violationCount,
      isFlagged: attempt.isFlagged,
      flags: Array.isArray(attempt.flags) ? attempt.flags : [],
      framesReceived: attempt.framesReceived,
      framesAnalysed: attempt.framesAnalysed,
      framesSkipped: attempt.framesSkipped,
      longestGapSeconds: attempt.longestGapSeconds,
      reviewState: attempt.reviewState,
      reviewReason: attempt.reviewReason,
      reviewDueAt: attempt.reviewDueAt,
      reviewRound: attempt.reviewRound,
      decision: attempt.decision,
      decidedAt: attempt.decidedAt,
      decisionNote: attempt.decisionNote,
      retakeUsed: Boolean(attempt.retakeGrant?.usedAt),
    },
    allowedDecisions: attempt.reviewState === "PENDING" ? allowedDecisions(attempt) : [],
    student: attempt.student?.user ?? null,
    quiz: { id: attempt.quiz.id, title: attempt.quiz.title, quizTag: attempt.quiz.quizTag, passingScore: attempt.quiz.passingScore, courseTitle: attempt.quiz.course?.title ?? null },
    score: attempt.quizAttempt,
    consent,
    risk: calculateRisk(attempt.events, clampedWarnings, policy),
    events: attempt.events.map((event) => ({ id: event.id, eventType: event.eventType, severity: event.severity, warningIssued: event.warningIssued, timestamp: event.serverTimestamp, metadata: event.metadata })),
    evidence: attempt.evidence.map(({ analysis, ...row }) => ({ ...row, analysis: analysisSummary(analysis) })),
    appeals: attempt.reviewRequests.map((request) => ({ id: request.id, round: request.round, reason: request.reason, createdAt: request.createdAt, dueAt: request.dueAt, decidedAt: request.decidedAt })),
  };
}

/** The attempt's pass, as it should now stand, for the row it lives in and the student's latest. */
async function applyPassState(tx, attempt, passed) {
  if (!attempt.quizAttempt) return;
  await tx.quizAttempt.update({ where: { id: attempt.quizAttempt.id }, data: { passed } });
  const latest = await tx.quizAttempt.findFirst({
    where: { studentId: attempt.studentId, quizId: attempt.quizId },
    orderBy: { attemptNumber: "desc" },
    select: { id: true },
  });
  if (latest?.id === attempt.quizAttempt.id) {
    await tx.quizSubmission.updateMany({ where: { studentId: attempt.studentId, quizId: attempt.quizId }, data: { passed } });
  }
}

/** Keeps QuizProgress and the course's progress in step. Slow, and it must not undo a decision if it fails. */
async function refreshProgress(attempt) {
  if (!attempt.studentId) return;
  try {
    const anyPass = await prisma.quizAttempt.findFirst({ where: { studentId: attempt.studentId, quizId: attempt.quizId, passed: true }, select: { id: true } });
    const where = { studentId_quizId: { studentId: attempt.studentId, quizId: attempt.quizId } };
    if (anyPass) {
      await prisma.quizProgress.upsert({ where, create: { studentId: attempt.studentId, quizId: attempt.quizId, completed: true, completedAt: new Date() }, update: { completed: true } });
    } else {
      await prisma.quizProgress.updateMany({ where: { studentId: attempt.studentId, quizId: attempt.quizId }, data: { completed: false, completedAt: null } });
    }
    const { recomputeCourseProgress } = require("../../utils/progressRollup");
    await recomputeCourseProgress(attempt.studentId, attempt.courseId);
  } catch (error) {
    console.error("[proctoring-review] progress refresh failed after a decision:", error?.message);
  }
}

const DECISION_WORDS = { UPHOLD: "upheld the ending of", RETAKE: "allowed you to retake", ACCEPT: "accepted", VOID: "voided" };

/** POST /reviews/:attemptId/decision. Only one decision can ever win: the update is conditional. */
async function decide(user, attemptId, { decision, note = null }) {
  const attempt = await loadForStaff(user, attemptId, { quizAttempt: { select: { id: true, percentage: true } } });
  if (attempt.reviewState !== "PENDING") throw new ApiError(409, "This attempt has no open review.", "REVIEW_NOT_OPEN");
  if (!allowedDecisions(attempt).includes(decision)) {
    throw new ApiError(400, `This attempt can only be ${allowedDecisions(attempt).join(" or ")}.`, "DECISION_NOT_ALLOWED");
  }

  const now = new Date();
  // A person can still appeal for 30 days after this, so the images must last that long.
  const appealCover = new Date(now.getTime() + APPEAL_WINDOW_MS);
  // Only an Accept can leave a pass in place. A terminated attempt never has one.
  const passed = decision === "ACCEPT" && attempt.status !== "TERMINATED" && (attempt.quizAttempt?.percentage ?? 0) >= attempt.quiz.passingScore;

  await prisma.$transaction(
    async (tx) => {
      const { count } = await tx.proctoredAttempt.updateMany({
        where: { id: attemptId, reviewState: "PENDING" },
        data: { reviewState: "DECIDED", decision, decisionNote: note, decidedById: user.id, decidedAt: now, reviewRound: { increment: 1 }, reviewDueAt: null },
      });
      if (count === 0) throw new ApiError(409, "Someone else has just decided this review.", "REVIEW_NOT_OPEN");

      await applyPassState(tx, attempt, passed);

      if (decision === "RETAKE") {
        if (!attempt.studentId) throw new ApiError(409, "This student's account no longer exists.", "STUDENT_GONE");
        await tx.proctoringRetakeGrant.upsert({
          where: { sourceAttemptId: attemptId },
          create: { quizId: attempt.quizId, studentId: attempt.studentId, sourceAttemptId: attemptId, grantedById: user.id },
          update: {},
        });
      } else {
        await tx.proctoringRetakeGrant.deleteMany({ where: { sourceAttemptId: attemptId, usedAt: null } });
      }

      await tx.proctoringEvidence.updateMany({ where: { attemptId }, data: { reviewHold: false } });
      await tx.proctoringEvidence.updateMany({ where: { attemptId, retainUntil: { lt: appealCover } }, data: { retainUntil: appealCover } });
      await tx.proctoringReviewRequest.updateMany({ where: { attemptId, decidedAt: null }, data: { decidedAt: now } });
      await recordAuditEvent(
        { userId: user.id, sessionId: user.sessionId, deviceId: user.deviceId, eventType: AUDIT_EVENTS.PROCTORING_DECISION, reasonCode: decision, metadata: { attemptId, quizId: attempt.quizId, round: attempt.reviewRound, passed } },
        { client: tx }
      );
    },
    { timeout: 15000 }
  );

  await refreshProgress(attempt);
  await notificationService
    .createNotification(attempt.userId, {
      title: "Your exam has been reviewed",
      message: `Your instructor has ${DECISION_WORDS[decision]} your attempt at "${attempt.quiz.title}".`,
      type: "PROCTORING_DECISION",
      link: `/student/proctored/${attempt.quizId}`,
      eventId: `proctoring_decision_${attemptId}_${attempt.reviewRound}`,
      actorId: user.id,
    })
    .catch((error) => console.warn("[proctoring-review] could not notify the student:", error?.message));

  return { attemptId, decision, decidedAt: now, passed };
}

/** POST /attempts/:id/review-requests: one per decision, within 30 days. Reopens the review. */
async function createAppeal(user, attemptId, { reason }) {
  const attempt = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quiz: { select: { title: true, course: { select: { creatorId: true } } } } } });
  if (!attempt) throw new ApiError(404, "Exam attempt not found.", "ATTEMPT_NOT_FOUND");
  if (attempt.userId !== user.id) throw new ApiError(403, "This exam attempt belongs to another student.", "ATTEMPT_FORBIDDEN");

  if (attempt.reviewRound > 0) {
    const existing = await prisma.proctoringReviewRequest.findUnique({ where: { attemptId_round: { attemptId, round: attempt.reviewRound } }, select: { id: true } });
    if (existing) throw new ApiError(409, "You have already asked for this decision to be reviewed.", "APPEAL_ALREADY_MADE");
  }
  if (attempt.reviewState !== "DECIDED" || !attempt.decision || attempt.decision === "ACCEPT") {
    throw new ApiError(409, "There is no decision to ask about on this attempt.", "NOTHING_TO_APPEAL");
  }
  if (!canStillAppeal(attempt)) throw new ApiError(409, "The 30 days to ask for a review of this decision have passed.", "APPEAL_WINDOW_CLOSED");

  const now = new Date();
  const dueAt = new Date(now.getTime() + REVIEW_DUE_MS);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.proctoringReviewRequest.create({ data: { attemptId, round: attempt.reviewRound, reason, dueAt } });
      await tx.proctoredAttempt.update({ where: { id: attemptId }, data: { reviewState: "PENDING", reviewDueAt: dueAt, reminderSentAt: null, escalatedAt: null } });
      await evidence.holdAttemptEvidence(attemptId, tx, now);
      await recordAuditEvent(
        { userId: user.id, sessionId: user.sessionId, deviceId: user.deviceId, eventType: AUDIT_EVENTS.PROCTORING_REVIEW_REQUESTED, metadata: { attemptId, round: attempt.reviewRound } },
        { client: tx }
      );
    });
  } catch (error) {
    if (error.code === "P2002") throw new ApiError(409, "You have already asked for this decision to be reviewed.", "APPEAL_ALREADY_MADE");
    throw error;
  }

  await notifyReviewWaiting({ ...attempt, reviewRound: attempt.reviewRound }, attempt.quiz, "A student has asked for a decision to be reviewed");
  return { attemptId, round: attempt.reviewRound, dueAt };
}

/** Tells the course's instructor something is waiting. Best effort, and never holds up an exam ending. */
async function notifyReviewWaiting(attempt, quiz, title = "A proctored attempt needs your review") {
  try {
    const creatorId = quiz?.course?.creatorId;
    if (!creatorId) return;
    await notificationService.createNotification(creatorId, {
      title,
      message: `An attempt at "${quiz.title}" is waiting for your decision.`,
      type: "PROCTORING_REVIEW",
      link: reviewLink(attempt.id),
      eventId: `proctoring_review_${attempt.id}_${attempt.reviewRound ?? 0}`,
    });
  } catch (error) {
    console.warn("[proctoring-review] could not notify the instructor:", error?.message);
  }
}

/**
 * After 7 days undecided: reminds the instructor and tells the admins, once each. It only ever
 * tells people. Nothing is decided here, however long a review waits.
 */
async function reviewReminderSweep(now = new Date()) {
  const overdue = await prisma.proctoredAttempt.findMany({
    where: { reviewState: "PENDING", reviewDueAt: { lt: now }, reminderSentAt: null },
    select: { id: true, reviewRound: true, quiz: { select: { title: true, course: { select: { creatorId: true } } } } },
    take: REMINDER_BATCH,
  });
  if (overdue.length === 0) return { reminded: 0 };
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });

  for (const attempt of overdue) {
    const creatorId = attempt.quiz.course?.creatorId;
    const round = attempt.reviewRound;
    try {
      if (creatorId) {
        await notificationService.createNotification(creatorId, {
          title: "A proctored review is overdue",
          message: `An attempt at "${attempt.quiz.title}" has waited more than 7 days for your decision.`,
          type: "PROCTORING_REVIEW",
          link: reviewLink(attempt.id),
          eventId: `proctoring_reminder_${attempt.id}_${round}`,
        });
      }
      for (const admin of admins) {
        await notificationService.createNotification(admin.id, {
          title: "A proctored review is overdue",
          message: `An attempt at "${attempt.quiz.title}" has waited more than 7 days for its instructor's decision.`,
          type: "PROCTORING_REVIEW",
          link: `/admin/proctoring/${attempt.id}`,
          eventId: `proctoring_escalation_${attempt.id}_${round}`,
        });
      }
      await prisma.proctoredAttempt.update({ where: { id: attempt.id }, data: { reminderSentAt: now, escalatedAt: now } });
    } catch (error) {
      // Still unmarked, so the next sweep tries again. eventId stops anyone being told twice.
      console.warn("[proctoring-review] could not send a reminder:", error?.message);
    }
  }
  return { reminded: overdue.length };
}

/** DELETE /attempts/:id/evidence: an admin removing an attempt's images. The record of the attempt stays. */
async function deleteAttemptEvidence(user, attemptId, { reason }) {
  const attempt = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, select: { id: true, status: true, reviewState: true, quizId: true } });
  if (!attempt) throw new ApiError(404, "Exam attempt not found.", "ATTEMPT_NOT_FOUND");
  if (OPEN_STATUSES.includes(attempt.status) || attempt.reviewState === "PENDING") {
    throw new ApiError(409, "These images cannot be deleted while the exam or its review is still open.", "REVIEW_STILL_OPEN");
  }
  await evidence.drain();
  const rows = await prisma.proctoringEvidence.findMany({ where: { attemptId }, select: { id: true, storageState: true, objectKey: true, tempPath: true } });
  // Audited first: a deletion nobody recorded would be worse than one that stopped halfway.
  await recordAuditEvent(
    { userId: user.id, sessionId: user.sessionId, deviceId: user.deviceId, eventType: AUDIT_EVENTS.PROCTORING_EVIDENCE_DELETED, metadata: { attemptId, quizId: attempt.quizId, count: rows.length, reason } },
    { client: prisma }
  );
  for (const row of rows) await evidence.deleteEvidence(row);
  return { attemptId, deleted: rows.length };
}

module.exports = { createAppeal, decide, deleteAttemptEvidence, getReview, listReviews, notifyReviewWaiting, reviewReminderSweep };
