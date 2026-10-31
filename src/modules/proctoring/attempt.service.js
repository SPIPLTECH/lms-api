const crypto = require("crypto");

const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const { authError } = require("../../utils/authErrors");
const { effectiveMaxAttempts, buildAttemptAllowance } = require("../../utils/attemptAllowance");
const { captureIntervalSeconds, isIdentityMatchingEnabled, isProctoringAvailable } = require("../../config/proctoring");
const { AUDIT_EVENTS, recordAuditEvent } = require("../audit/audit.service");
const { isPlaybackHeldElsewhere } = require("../playback/playback.service");
const { expireLeasesWhere } = require("../sessions/session.service");
const quizService = require("../quizzes/quiz.service");
const { OPEN_STATUSES } = require("./attemptStanding");
const { isAiHealthy } = require("./ai/health");
const { assertAllowedBrowser, isAllowedBrowser } = require("./browserPolicy");
const { consentWording } = require("./consent.config");
const { holdAttemptEvidence, isEvidenceStoreReady } = require("./evidence.service");
const registry = require("./monitorRegistry");
const { isTokenSecretConfigured, signMonitorToken } = require("./monitorToken");

/**
 * Server-side state of a proctored exam: reserve, ready, start, save, close.
 *
 * Scoring stays in quiz.service. A QuizAttempt is written only when an exam closes,
 * so a readiness check that is abandoned uses no attempt. Every state change is a
 * conditional update, so a double click, a second tab and the sweep cannot close an
 * attempt twice.
 */

const SAVE_GRACE_MS = 15 * 1000;
const PREPARING_MAX_AGE_MS = 30 * 60 * 1000;
const REVIEW_DUE_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 100;
const SWEEP_CONCURRENCY = 5;

const STATUS_BY_END_REASON = { SUBMITTED: "SUBMITTED", TIME_EXPIRED: "EXPIRED", TERMINATED: "TERMINATED" };

/** Monitoring must work before an exam can begin. Never checked once one is under way. */
const isMonitoringAvailable = async () =>
  isProctoringAvailable() && isTokenSecretConfigured() && isEvidenceStoreReady() && (await isAiHealthy());

async function assertMonitoringAvailable() {
  if (!(await isMonitoringAvailable())) {
    throw new ApiError(503, "Exam monitoring is unavailable right now. Please try again later. No attempt was used.", "PROCTORING_UNAVAILABLE");
  }
}

async function studentIdOf(user) {
  const profile = await prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!profile) throw new ApiError(403, "Forbidden: Student profile required");
  return profile.id;
}

async function loadProctoredQuiz(studentId, quizId) {
  await quizService.assertStudentQuizAccess(studentId, quizId);
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { id: true, title: true, courseId: true, quizTag: true, attempts: true, timeLimit: true, passingScore: true, proctoringEnabled: true, _count: { select: { quizQuestions: true } } },
  });
  if (!quiz.proctoringEnabled) throw new ApiError(400, "This quiz is not proctored.", "QUIZ_NOT_PROCTORED");
  return quiz;
}

const findOpenAttempt = (quizId, userId) =>
  prisma.proctoredAttempt.findFirst({ where: { quizId, userId, status: { in: OPEN_STATUSES } } });

/**
 * Whether a new attempt may begin. Attempts are counted from the QuizAttempt log;
 * each approved retake adds one. A terminated attempt with no retake approved blocks
 * everything, whatever allowance remains.
 */
async function startStanding(quiz, studentId) {
  const [used, terminated, grants] = await Promise.all([
    prisma.quizAttempt.count({ where: { studentId, quizId: quiz.id } }),
    prisma.proctoredAttempt.findMany({ where: { studentId, quizId: quiz.id, status: "TERMINATED" }, select: { id: true } }),
    prisma.proctoringRetakeGrant.findMany({ where: { studentId, quizId: quiz.id }, select: { sourceAttemptId: true } }),
  ]);
  const max = effectiveMaxAttempts(quiz);
  const allowance = buildAttemptAllowance(max > 0 ? max + grants.length : 0, used);
  const granted = new Set(grants.map((grant) => grant.sourceAttemptId));
  if (terminated.some((attempt) => !granted.has(attempt.id))) {
    return { allowance, refusal: "RETAKE_APPROVAL_REQUIRED" };
  }
  return { allowance, refusal: allowance.canAttempt ? null : "NO_ATTEMPTS_LEFT" };
}

const REFUSALS = {
  RETAKE_APPROVAL_REQUIRED: "This exam was ended by proctoring. Your instructor must approve a retake before you can start again.",
  NO_ATTEMPTS_LEFT: "You have used all the attempts allowed for this quiz.",
};

const isOverdue = (attempt, now = new Date()) =>
  attempt.status === "IN_PROGRESS" && now.getTime() > attempt.deadlineAt.getTime() + SAVE_GRACE_MS;

const isOnThisDevice = (attempt, user) => attempt.deviceId === user.deviceId;

function assertOnThisDevice(attempt, user) {
  if (!isOnThisDevice(attempt, user)) {
    throw new ApiError(409, "This exam is open on another device. Resume it here to continue.", "ATTEMPT_ACTIVE_ON_ANOTHER_DEVICE");
  }
}

const ended = () => new ApiError(409, "This exam has ended.", "ATTEMPT_ENDED");

async function ownAttempt(user, attemptId, include = undefined) {
  const attempt = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, ...(include && { include }) });
  if (!attempt) throw new ApiError(404, "Exam attempt not found.", "ATTEMPT_NOT_FOUND");
  if (attempt.userId !== user.id) throw new ApiError(403, "This exam attempt belongs to another student.", "ATTEMPT_FORBIDDEN");
  return attempt;
}

/** What the exam page needs about an attempt. Never confidence scores or AI notes. */
const toView = (attempt, user, now = new Date()) => ({
  attemptId: attempt.id,
  quizId: attempt.quizId,
  courseId: attempt.courseId,
  status: attempt.status,
  serverNow: now,
  startedAt: attempt.startedAt,
  deadlineAt: attempt.deadlineAt,
  durationMinutes: attempt.durationMinutes,
  identityMatching: attempt.identityMatching,
  identityCheck: attempt.identityCheck,
  identityRecheckRequired: attempt.identityRecheckPending,
  microphoneStatus: attempt.microphoneStatus,
  cameraReady: Boolean(attempt.cameraSeenAt),
  captureIntervalSeconds: attempt.policy?.captureIntervalSeconds ?? captureIntervalSeconds(),
  activeElsewhere: !isOnThisDevice(attempt, user),
  endReason: attempt.endReason,
  endedAt: attempt.endedAt,
});

const withToken = (attempt, user) => ({ ...toView(attempt, user), monitoringToken: signMonitorToken(attempt) });

/** GET /quizzes/:quizId/status */
async function getStatus(user, quizId, headers) {
  const studentId = await studentIdOf(user);
  const quiz = await loadProctoredQuiz(studentId, quizId);
  const [open, standing, last] = await Promise.all([
    findOpenAttempt(quizId, user.id),
    startStanding(quiz, studentId),
    prisma.proctoredAttempt.findFirst({
      where: { quizId, userId: user.id, status: { notIn: [...OPEN_STATUSES, "ABANDONED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, endedAt: true },
    }),
  ]);
  const identityMatching = isIdentityMatchingEnabled();
  const { wordingVersion, text } = consentWording(identityMatching);
  const reason = !(await isMonitoringAvailable()) ? "PROCTORING_UNAVAILABLE" : standing.refusal;
  return {
    quizId,
    courseId: quiz.courseId,
    title: quiz.title,
    quizTag: quiz.quizTag,
    durationMinutes: quiz.timeLimit,
    passingScore: quiz.passingScore,
    questionCount: quiz._count.quizQuestions,
    ...standing.allowance,
    canStart: !open && !reason,
    reason: open ? null : reason,
    deviceAllowed: isAllowedBrowser(headers),
    identityMatching,
    consent: { wordingVersion, text },
    attempt: open ? toView(open, user) : null,
    lastAttempt: last,
  };
}

/** Moves an open attempt to this device and issues a new token, which stops the previous one. */
async function takeOver(attempt, user) {
  if (!OPEN_STATUSES.includes(attempt.status)) throw ended();
  if (isOverdue(attempt)) {
    await finalizeAttempt(attempt.id, { endReason: "TIME_EXPIRED" });
    throw new ApiError(409, "Time ran out for this exam.", "TIME_EXPIRED");
  }

  const moved = !isOnThisDevice(attempt, user);
  const preparing = attempt.status === "PREPARING";
  if (moved && preparing) await prisma.proctoringIdentityBaseline.deleteMany({ where: { attemptId: attempt.id } });
  try {
    const updated = await prisma.proctoredAttempt.update({
      where: { id: attempt.id, status: { in: OPEN_STATUSES } },
      data: {
        tokenVersion: { increment: 1 },
        deviceId: user.deviceId,
        ...(moved && preparing && { identityCheck: "PENDING", identityFailures: 0, cameraSeenAt: null }),
        ...(moved && !preparing && { identityRecheckPending: true }),
      },
    });
    registry.patch(attempt.id, {
      tokenVersion: updated.tokenVersion,
      identityRecheckPending: updated.identityRecheckPending,
      identityCheck: updated.identityCheck,
      identityFailures: updated.identityFailures,
      cameraSeenAt: updated.cameraSeenAt,
      ...(moved && preparing && { baseline: null }),
    });
    return withToken(updated, user);
  } catch (error) {
    if (error.code === "P2025") throw ended();
    throw error;
  }
}

/** POST /quizzes/:quizId/attempts: records consent and reserves the attempt. */
async function createAttempt(user, quizId, { consent } = {}, headers = {}) {
  const studentId = await studentIdOf(user);
  const quiz = await loadProctoredQuiz(studentId, quizId);
  await assertMonitoringAvailable();
  assertAllowedBrowser(headers);

  const identityMatching = isIdentityMatchingEnabled();
  const wording = consentWording(identityMatching);
  if (consent?.accepted !== true || consent.wordingVersion !== wording.wordingVersion) {
    throw new ApiError(400, "Please read and accept the current exam monitoring notice.", "CONSENT_REQUIRED");
  }

  if (await isPlaybackHeldElsewhere(user)) throw authError("PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");

  const open = await findOpenAttempt(quizId, user.id);
  if (open) return takeOver(open, user);

  const { refusal } = await startStanding(quiz, studentId);
  if (refusal) throw new ApiError(403, REFUSALS[refusal], refusal);

  let attempt;
  try {
    attempt = await prisma.$transaction(async (tx) => {
      // Shared, so students starting together do not queue behind each other, while
      // an instructor's edit (which locks the row) waits and then sees the attempt.
      await tx.$queryRaw`SELECT "id" FROM "Quiz" WHERE "id" = ${quizId} FOR SHARE`;
      const created = await tx.proctoredAttempt.create({
        data: {
          quizId,
          courseId: quiz.courseId,
          studentId,
          userId: user.id,
          status: "PREPARING",
          policy: { captureIntervalSeconds: captureIntervalSeconds() },
          durationMinutes: quiz.timeLimit,
          identityMatching,
          deviceId: user.deviceId,
        },
      });
      const consentRow = await tx.proctoringConsent.create({
        data: { userId: user.id, quizId, attemptId: created.id, wordingVersion: wording.wordingVersion, wordingHash: wording.wordingHash, identityMatching },
      });
      await tx.proctoringRetakeGrant.updateMany({ where: { quizId, studentId, usedAt: null }, data: { usedAt: new Date() } });
      return tx.proctoredAttempt.update({ where: { id: created.id }, data: { consentId: consentRow.id } });
    }, { timeout: 15000 });
  } catch (error) {
    // Another request from this student won the partial unique index.
    if (error.code !== "P2002") throw error;
    const winner = await findOpenAttempt(quizId, user.id);
    if (!winner) throw error;
    return takeOver(winner, user);
  }

  await recordAuditEvent({
    userId: user.id,
    sessionId: user.sessionId,
    deviceId: user.deviceId,
    eventType: AUDIT_EVENTS.PROCTORING_CONSENT_RECORDED,
    metadata: { quizId, attemptId: attempt.id, wordingVersion: wording.wordingVersion },
  });
  return withToken(attempt, user);
}

/** POST /attempts/:id/resume */
async function resumeAttempt(user, attemptId, headers = {}) {
  const attempt = await ownAttempt(user, attemptId);
  assertAllowedBrowser(headers);
  return takeOver(attempt, user);
}

/** POST /attempts/:id/start: the clock starts here, once, from the server's time. */
async function startAttempt(user, attemptId) {
  const attempt = await ownAttempt(user, attemptId);
  if (attempt.status === "IN_PROGRESS") {
    assertOnThisDevice(attempt, user);
    return withToken(attempt, user);
  }
  if (attempt.status !== "PREPARING") throw ended();
  assertOnThisDevice(attempt, user);
  await assertMonitoringAvailable();

  const reasons = [
    ...(attempt.consentId ? [] : ["CONSENT_MISSING"]),
    ...(attempt.identityCheck === "FACE_CHECK_PASSED" ? [] : ["IDENTITY_CHECK_NOT_PASSED"]),
    ...(attempt.cameraSeenAt ? [] : ["CAMERA_NOT_SEEN"]),
  ];
  if (reasons.length > 0) {
    throw new ApiError(409, "The readiness checks have not all passed.", "NOT_READY", reasons);
  }
  if (await isPlaybackHeldElsewhere(user)) throw authError("PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");

  const now = new Date();
  const { count } = await prisma.proctoredAttempt.updateMany({
    where: { id: attempt.id, status: "PREPARING" },
    data: {
      status: "IN_PROGRESS",
      startedAt: now,
      deadlineAt: new Date(now.getTime() + attempt.durationMinutes * 60 * 1000),
      // A microphone never reported counts as refused: the exam starts, with a badge for the instructor.
      ...(attempt.microphoneStatus === "UNKNOWN" && { microphoneStatus: "REFUSED" }),
    },
  });
  const current = await prisma.proctoredAttempt.findUnique({ where: { id: attempt.id } });
  registry.patch(attempt.id, {
    status: current.status,
    startedAt: current.startedAt,
    deadlineAt: current.deadlineAt,
    microphoneStatus: current.microphoneStatus,
    lastSnapshotAt: current.startedAt,
  });
  if (count > 0) {
    // A video left playing on this device stops at its next heartbeat.
    await expireLeasesWhere({ userId: user.id }, "PROCTORED_EXAM_STARTED", prisma, now);
    await recordAuditEvent({
      userId: user.id,
      sessionId: user.sessionId,
      deviceId: user.deviceId,
      eventType: AUDIT_EVENTS.PROCTORING_ATTEMPT_STARTED,
      metadata: { quizId: attempt.quizId, attemptId: attempt.id, microphoneStatus: current.microphoneStatus },
    });
  }
  return withToken(current, user);
}

/** GET /attempts/:id: questions only while the exam is running on this device. */
async function getAttempt(user, attemptId) {
  let attempt = await ownAttempt(user, attemptId, { answers: { select: { questionId: true, answer: true, revision: true, state: true } } });
  if (isOverdue(attempt)) {
    await finalizeAttempt(attempt.id, { endReason: "TIME_EXPIRED" });
    attempt = await ownAttempt(user, attemptId, { answers: { select: { questionId: true, answer: true, revision: true, state: true } } });
  }
  const view = toView(attempt, user);
  if (attempt.status !== "IN_PROGRESS" || view.activeElsewhere || attempt.identityRecheckPending) return view;

  const quiz = await quizService.getQuizById(attempt.quizId, "STUDENT", attempt.studentId, { proctoredExam: true });
  return {
    ...view,
    quiz: { id: quiz.id, title: quiz.title, quizTag: quiz.quizTag, passingScore: quiz.passingScore, hintsUnlocked: quiz.hintsUnlocked },
    questions: quiz.questions,
    answers: attempt.answers,
  };
}

/** PUT /attempts/:id/answers/:questionId. One indexed upsert; an older revision never overwrites a newer one. */
async function saveAnswer(user, attemptId, questionId, { answer, clientRevision, state }) {
  const [attempt, link] = await Promise.all([
    ownAttempt(user, attemptId),
    prisma.quizQuestion.findFirst({ where: { questionId, quiz: { proctoredAttempts: { some: { id: attemptId } } } }, select: { id: true } }),
  ]);
  if (attempt.status !== "IN_PROGRESS") throw ended();
  if (isOverdue(attempt)) {
    await finalizeAttempt(attempt.id, { endReason: "TIME_EXPIRED" });
    throw new ApiError(409, "Time ran out, so this answer was not saved. Your earlier answers were submitted.", "TIME_EXPIRED");
  }
  assertOnThisDevice(attempt, user);
  if (attempt.identityRecheckPending) {
    throw new ApiError(409, "Repeat the identity check to continue on this device.", "IDENTITY_RECHECK_REQUIRED");
  }
  if (!link) throw new ApiError(400, "This question is not part of this exam.", "QUESTION_NOT_IN_QUIZ");

  const now = new Date();
  // Prisma keeps these columns in UTC. Raw SQL has to say so, or the database
  // session's own timezone shifts savedAt and a termination cutoff misreads it.
  const rows = await prisma.$queryRaw`
    INSERT INTO "ProctoredAnswer" ("id", "attemptId", "questionId", "answer", "revision", "state", "savedAt")
    VALUES (${crypto.randomUUID()}, ${attemptId}, ${questionId}, ${JSON.stringify(answer ?? null)}::jsonb, ${clientRevision}, ${state ? JSON.stringify(state) : null}::jsonb, ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    ON CONFLICT ("attemptId", "questionId") DO UPDATE
      SET "answer" = EXCLUDED."answer", "revision" = EXCLUDED."revision", "state" = EXCLUDED."state", "savedAt" = EXCLUDED."savedAt"
      WHERE "ProctoredAnswer"."revision" < EXCLUDED."revision"
    RETURNING "revision"`;
  return { stale: rows.length === 0, revision: clientRevision, savedAt: now, serverNow: now };
}

/** POST /attempts/:id/submit. Repeats return the same outcome. */
async function submitAttempt(user, attemptId) {
  const attempt = await ownAttempt(user, attemptId);
  if (attempt.status === "PREPARING") throw new ApiError(409, "This exam has not started.", "ATTEMPT_NOT_STARTED");
  if (attempt.status === "IN_PROGRESS") {
    assertOnThisDevice(attempt, user);
    await finalizeAttempt(attempt.id, { endReason: isOverdue(attempt) ? "TIME_EXPIRED" : "SUBMITTED" });
  }
  return toView(await ownAttempt(user, attemptId), user);
}

const END_REASON_LABEL = { SUBMITTED: "STUDENT", TIME_EXPIRED: "TIME", TERMINATED: "PROCTORING" };

// What a student reads about each event: plain words, and never anything from the AI's analysis.
const EVENT_EXPLANATIONS = {
  TAB_HIDDEN: "You left the exam tab or minimised the window.",
  WINDOW_BLUR: "The exam window lost focus.",
  FULLSCREEN_EXIT: "You left fullscreen.",
  COPY_ATTEMPT: "A copy was blocked.",
  PASTE_ATTEMPT: "A paste was blocked.",
  CUT_ATTEMPT: "A cut was blocked.",
  CONTEXT_MENU: "The right-click menu was blocked.",
  SCREENSHOT_ATTEMPT: "A screenshot shortcut was blocked.",
  SCREEN_SHARE_ATTEMPT: "A screen share was blocked.",
  CAMERA_DENIED: "The camera was not available.",
  CAMERA_INTERRUPTED: "The camera stopped.",
  DISCONNECT: "The connection dropped.",
  MONITORING_GAP: "Monitoring was interrupted.",
  VOICE_ACTIVITY_DETECTED: "Speech was noticed near your microphone. No audio was recorded.",
  FACE_NOT_DETECTED: "Your face was not visible to the camera.",
  MULTIPLE_FACES_DETECTED: "Another person was seen in your camera view.",
  HEAD_POSE_AWAY: "You appeared to be looking away from the screen.",
  PROHIBITED_OBJECT_DETECTED: "A mobile phone or other prohibited item was seen.",
  IDENTITY_MISMATCH_DETECTED: "The person on camera did not appear to match your identity photo.",
  AUTO_TERMINATION_ENFORCED: "The exam was ended by proctoring.",
};
const EVIDENCE_NEARBY_MS = 10 * 1000;

function studentOutcome(attempt) {
  if (attempt.status === "TERMINATED") return "ENDED_BY_PROCTORING";
  if (attempt.reviewState === "PENDING") return "UNDER_REVIEW";
  return "SCORED";
}

/** Attaches a kept frame to an event: the one it names, else the nearest in time. */
function evidenceFor(event, kept) {
  const byFrame = new Map(kept.map((row) => [row.frameId, row]));
  const named = (event.metadata?.evidenceIds ?? []).map((frameId) => byFrame.get(frameId)).find(Boolean);
  if (named) return named;
  const at = event.serverTimestamp.getTime();
  let nearest = null;
  for (const row of kept) {
    const distance = Math.abs(row.receivedAt.getTime() - at);
    if (distance <= EVIDENCE_NEARBY_MS && (!nearest || distance < Math.abs(nearest.receivedAt.getTime() - at))) nearest = row;
  }
  return nearest;
}

/** GET /attempts/:id/result: the exam-ended view. A student's own, with nothing from the AI's analysis. */
async function getAttemptResult(user, attemptId) {
  const attempt = await ownAttempt(user, attemptId, {
    quizAttempt: true,
    answers: { select: { questionId: true, answer: true } },
    quiz: { select: { title: true, passingScore: true, quizTag: true, quizQuestions: { orderBy: { order: "asc" }, select: { questionId: true, marks: true, question: { select: { question: true, marks: true } } } } } },
    events: { orderBy: { serverTimestamp: "asc" }, select: { id: true, eventType: true, severity: true, warningIssued: true, serverTimestamp: true, metadata: true } },
    evidence: { where: { category: { not: "IDENTITY" } }, select: { id: true, frameId: true, receivedAt: true } },
  });
  if (OPEN_STATUSES.includes(attempt.status)) throw new ApiError(409, "This exam has not ended.", "ATTEMPT_NOT_ENDED");

  let warningNumber = 0;
  const violations = [];
  for (const event of attempt.events) {
    if (event.warningIssued) warningNumber += 1;
    const explanation = EVENT_EXPLANATIONS[event.eventType];
    if (!explanation) continue;
    const kept = evidenceFor(event, attempt.evidence);
    violations.push({
      id: event.id,
      eventType: event.eventType,
      severity: event.severity,
      explanation,
      timestamp: event.serverTimestamp,
      warningNumber: event.warningIssued ? warningNumber : null,
      evidenceId: kept?.id ?? null,
      evidenceCapturedAt: kept?.receivedAt ?? null,
    });
  }

  const saved = new Map(attempt.answers.map((row) => [row.questionId, row.answer]));
  const scored = attempt.quizAttempt;
  return {
    attemptId: attempt.id,
    quizId: attempt.quizId,
    courseId: attempt.courseId,
    status: attempt.status,
    outcome: studentOutcome(attempt),
    endedBy: END_REASON_LABEL[attempt.endReason] ?? null,
    reason: attempt.status === "TERMINATED" ? attempt.terminationReason : null,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    quiz: { title: attempt.quiz.title, quizTag: attempt.quiz.quizTag, passingScore: attempt.quiz.passingScore },
    score: scored?.score ?? null,
    totalMarks: scored?.totalMarks ?? null,
    percentage: scored?.percentage ?? null,
    passed: scored?.passed ?? false,
    quizAttemptId: scored?.id ?? null,
    warningCount: attempt.warningCount,
    identityCheck: attempt.identityCheck,
    identityMatching: attempt.identityMatching,
    microphoneStatus: attempt.microphoneStatus,
    telemetry: { framesReceived: attempt.framesReceived, framesAnalysed: attempt.framesAnalysed, longestGapSeconds: attempt.longestGapSeconds },
    violations,
    answers: attempt.quiz.quizQuestions.map((row) => {
      const answer = saved.get(row.questionId);
      return { questionId: row.questionId, questionText: row.question.question, marks: row.marks ?? row.question.marks ?? 1, answer: answer ?? null, saved: answer !== undefined && answer !== null };
    }),
  };
}

class AlreadyClosed extends Error {}

/**
 * Closes a running attempt and scores what was saved, once, whoever gets here first.
 * For a termination only answers saved up to that moment count, and the attempt is
 * never a pass. The face template goes in the same transaction.
 */
async function finalizeAttempt(attemptId, { endReason, rule = null, terminationReason = null, terminatedAt = null }) {
  const status = STATUS_BY_END_REASON[endReason];
  const attempt = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { answers: true } });
  if (!attempt || attempt.status !== "IN_PROGRESS") return attempt;

  const now = new Date();
  const terminated = status === "TERMINATED";
  const cutoff = terminated ? terminatedAt ?? now : null;
  const counted = attempt.answers.filter((row) => !cutoff || row.savedAt <= cutoff);
  const lastMoment = Math.min(now.getTime(), attempt.deadlineAt.getTime());
  const needsReview = terminated || attempt.isFlagged;

  try {
    await quizService.submitQuiz(
      attempt.studentId,
      attempt.quizId,
      counted.map((row) => ({ questionId: row.questionId, answer: row.answer })),
      Math.max(0, Math.round((lastMoment - attempt.startedAt.getTime()) / 1000)),
      counted.filter((row) => row.state).map((row) => ({ ...row.state, questionId: row.questionId })),
      {
        forceFailed: terminated,
        onTransactionStart: async (tx) => {
          const { count } = await tx.proctoredAttempt.updateMany({
            where: { id: attemptId, status: "IN_PROGRESS" },
            data: {
              status,
              endReason,
              endedAt: now,
              ...(terminated && { terminatedAt: cutoff, terminationRule: rule, terminationReason }),
              ...(needsReview && {
                reviewState: "PENDING",
                reviewReason: terminated ? "TERMINATED" : "FLAGGED",
                reviewDueAt: new Date(now.getTime() + REVIEW_DUE_MS),
              }),
            },
          });
          if (count === 0) throw new AlreadyClosed();
          await tx.proctoringIdentityBaseline.deleteMany({ where: { attemptId } });
          if (needsReview) await holdAttemptEvidence(attemptId, tx, now);
        },
        onAttemptCreated: (tx, quizAttempt) =>
          tx.proctoredAttempt.update({ where: { id: attemptId }, data: { quizAttemptId: quizAttempt.id } }),
      }
    );
  } catch (error) {
    if (error instanceof AlreadyClosed) return prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
    throw error;
  }

  await registry.notifyEnded(attemptId, status);
  await recordAuditEvent({
    userId: attempt.userId,
    eventType: terminated ? AUDIT_EVENTS.PROCTORING_ATTEMPT_TERMINATED : AUDIT_EVENTS.PROCTORING_ATTEMPT_ENDED,
    reasonCode: endReason,
    metadata: { quizId: attempt.quizId, attemptId, ...(rule && { rule }) },
  });
  return prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
}

/**
 * Closes exams past their deadline and abandons readiness checks left open. Safe to
 * run on several instances at once: every close is conditional. Batches are capped,
 * so a large exam ending together never floods the database.
 */
async function sweepAttempts(now = new Date()) {
  const overdue = await prisma.proctoredAttempt.findMany({
    where: { status: "IN_PROGRESS", deadlineAt: { lt: new Date(now.getTime() - SAVE_GRACE_MS) } },
    select: { id: true },
    take: SWEEP_BATCH,
  });
  let expired = 0;
  for (let i = 0; i < overdue.length; i += SWEEP_CONCURRENCY) {
    const results = await Promise.allSettled(
      overdue.slice(i, i + SWEEP_CONCURRENCY).map(({ id }) => finalizeAttempt(id, { endReason: "TIME_EXPIRED" }))
    );
    for (const result of results) {
      if (result.status === "fulfilled") expired += 1;
      else console.warn("[proctoring-sweep] could not close an attempt:", result.reason?.message);
    }
  }

  const stale = await prisma.proctoredAttempt.findMany({
    where: { status: "PREPARING", createdAt: { lt: new Date(now.getTime() - PREPARING_MAX_AGE_MS) } },
    select: { id: true },
    take: SWEEP_BATCH,
  });
  let abandoned = 0;
  if (stale.length > 0) {
    const ids = stale.map(({ id }) => id);
    ({ count: abandoned } = await prisma.proctoredAttempt.updateMany({
      where: { id: { in: ids }, status: "PREPARING" },
      data: { status: "ABANDONED", endReason: "ABANDONED", endedAt: now },
    }));
    await prisma.proctoringIdentityBaseline.deleteMany({ where: { attemptId: { in: ids } } });
    await Promise.all(ids.map((id) => registry.notifyEnded(id, "ABANDONED")));
  }
  return { expired, abandoned };
}

module.exports = {
  createAttempt,
  finalizeAttempt,
  getAttempt,
  getAttemptResult,
  getStatus,
  resumeAttempt,
  saveAnswer,
  startAttempt,
  submitAttempt,
  sweepAttempts,
};
