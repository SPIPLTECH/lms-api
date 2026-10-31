const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const audit = require("../audit/audit.service");
const { createConfiguredStore } = require("./evidenceStore");

/**
 * Frames that are kept. A kept frame is one row, written in a batch across all attempts, and
 * one encrypted object in the store, copied in the background. The frame stays on disk until
 * that succeeds, so a store outage loses nothing. Clean detection frames never come here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const VIOLATION_RETENTION_MS = 90 * DAY_MS;
const CLEAN_RETENTION_MS = 7 * DAY_MS;
const FLUSH_DELAY_MS = 1000;
const BATCH_SIZE = 100;
const COPY_CONCURRENCY = 4;
const COPY_RETRIES = 3;
const LOCAL_GRACE_MS = 5 * 60 * 1000;
const LONG_TERM = new Set(["VIOLATION", "UNANALYSED"]);

let store = null;
const pendingRows = [];
const pendingUpgrades = [];
const copyWaiting = [];
let copying = 0;
const storedIds = [];
const failedIds = [];
let flushTimer = null;
const idleResolvers = [];

const tempRoot = () => process.env.PROCTORING_TEMP_DIR || path.join(os.tmpdir(), "lms-proctoring");

const attemptTempDir = (attemptId) => path.join(tempRoot(), attemptId);

const getStore = () => {
  if (!store) store = createConfiguredStore();
  return store;
};

/** Swaps the store and returns the one it replaced. */
function setStoreForTests(replacement) {
  const previous = getStore();
  store = replacement;
  return previous;
}

/** Whether images can be kept. An exam must not begin without this. */
function isEvidenceStoreReady() {
  try {
    getStore();
    return true;
  } catch {
    return false;
  }
}

const removeFile = async (file) => {
  if (!file) return;
  await fs.promises.rm(file, { force: true }).catch(() => {});
};

const retention = (monitor, category, now) => {
  const hold = Boolean(monitor.holdEvidence);
  return {
    reviewHold: hold,
    retainUntil: new Date(now.getTime() + (hold || LONG_TERM.has(category) ? VIOLATION_RETENTION_MS : CLEAN_RETENTION_MS)),
  };
};

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch((error) => console.warn("[proctoring-evidence] flush failed:", error?.message));
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

/** Marks a frame as kept. It reaches the database in the next batch. */
function keepFrame(monitor, frame, category, now = new Date()) {
  if (!frame.path) return;
  if (frame.evidenceId) {
    // Already kept as something milder: it is now part of a violation.
    if (LONG_TERM.has(category) && !LONG_TERM.has(frame.category)) {
      frame.category = category;
      pendingUpgrades.push(frame.evidenceId);
      scheduleFlush();
    }
    return;
  }
  frame.evidenceId = crypto.randomUUID();
  frame.category = category;
  frame.kept = true;
  pendingRows.push({
    row: {
      id: frame.evidenceId,
      attemptId: monitor.id,
      frameId: frame.id,
      type: frame.type,
      category,
      storageState: "LOCAL",
      objectKey: `${monitor.id}/${frame.evidenceId}.bin`,
      tempPath: frame.path,
      mimeType: frame.mimeType,
      fileSize: frame.size,
      ...(frame.result ? { analysis: frame.result } : {}),
      receivedAt: frame.receivedAt,
      clientCapturedAt: frame.clientCapturedAt ?? null,
      late: Boolean(frame.late),
      ...retention(monitor, category, now),
    },
  });
  scheduleFlush();
}

function pumpCopies() {
  while (copying < COPY_CONCURRENCY && copyWaiting.length > 0) {
    const row = copyWaiting.shift();
    copying += 1;
    copyOne(row)
      .catch((error) => console.warn("[proctoring-evidence] copy failed:", error?.message))
      .finally(() => {
        copying -= 1;
        pumpCopies();
        if (storedIds.length > 0 || failedIds.length > 0) scheduleFlush();
        settleIfIdle();
      });
  }
}

async function copyOne(row) {
  let lastError;
  for (let attempt = 0; attempt < COPY_RETRIES; attempt += 1) {
    try {
      const bytes = await fs.promises.readFile(row.tempPath);
      await getStore().put(row.objectKey, bytes);
      storedIds.push({ id: row.id, tempPath: row.tempPath });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  failedIds.push(row.id);
  console.warn("[proctoring-evidence] could not store a frame; it stays on disk and will be retried:", lastError?.message);
}

/** Writes everything waiting. One statement per kind, across all attempts. */
async function flush() {
  if (pendingRows.length > 0) {
    const batch = pendingRows.splice(0, BATCH_SIZE);
    try {
      await prisma.proctoringEvidence.createMany({ data: batch.map((item) => item.row), skipDuplicates: true });
      for (const item of batch) copyWaiting.push(item.row);
      pumpCopies();
    } catch (error) {
      pendingRows.unshift(...batch);
      throw error;
    }
    if (pendingRows.length > 0) scheduleFlush();
  }
  if (pendingUpgrades.length > 0) {
    const ids = pendingUpgrades.splice(0);
    await prisma.proctoringEvidence.updateMany({ where: { id: { in: ids } }, data: { category: "VIOLATION", retainUntil: new Date(Date.now() + VIOLATION_RETENTION_MS) } });
  }
  if (storedIds.length > 0) {
    const done = storedIds.splice(0);
    await prisma.proctoringEvidence.updateMany({ where: { id: { in: done.map((item) => item.id) } }, data: { storageState: "STORED", tempPath: null } });
    await Promise.all(done.map((item) => removeFile(item.tempPath)));
  }
  if (failedIds.length > 0) {
    const ids = failedIds.splice(0);
    await prisma.proctoringEvidence.updateMany({ where: { id: { in: ids }, storageState: { not: "STORED" } }, data: { storageState: "FAILED", copyAttempts: { increment: COPY_RETRIES } } });
  }
  settleIfIdle();
}

const isIdle = () => pendingRows.length === 0 && pendingUpgrades.length === 0 && copyWaiting.length === 0 && copying === 0 && storedIds.length === 0 && failedIds.length === 0;

function settleIfIdle() {
  if (!isIdle()) return;
  idleResolvers.splice(0).forEach((resolve) => resolve());
}

/** Everything kept so far is written and stored. */
async function drain() {
  for (;;) {
    await flush();
    if (isIdle()) return;
    if (copying > 0 || copyWaiting.length > 0) await new Promise((resolve) => idleResolvers.push(resolve) && setTimeout(resolve, 50));
  }
}

/** The attempt is flagged or under review: everything it has kept stays until review closes. */
async function holdAttemptEvidence(attemptId, client = prisma, now = new Date()) {
  await client.proctoringEvidence.updateMany({ where: { attemptId }, data: { reviewHold: true, retainUntil: new Date(now.getTime() + VIOLATION_RETENTION_MS) } });
}

/** Removes one kept image altogether. */
async function deleteEvidence(row) {
  if (row.storageState === "STORED" && row.objectKey) await getStore().delete(row.objectKey);
  await removeFile(row.tempPath);
  await prisma.proctoringEvidence.delete({ where: { id: row.id } }).catch(() => {});
}

/** Retries frames that failed, or that a restart left unstored. A recent LOCAL frame may still be on its way. */
async function retryUnstored() {
  const rows = await prisma.proctoringEvidence.findMany({
    where: { tempPath: { not: null }, OR: [{ storageState: "FAILED" }, { storageState: "LOCAL", receivedAt: { lt: new Date(Date.now() - LOCAL_GRACE_MS) } }] },
    select: { id: true, objectKey: true, tempPath: true },
    take: 200,
  });
  const already = new Set(copyWaiting.map((row) => row.id));
  for (const row of rows) if (!already.has(row.id)) copyWaiting.push(row);
  pumpCopies();
  return rows.length;
}

/** GET /evidence/:evidenceId/file. Staff views are audited before any byte is sent. */
async function readEvidenceFile(user, evidenceId) {
  const row = await prisma.proctoringEvidence.findUnique({
    where: { id: evidenceId },
    include: { attempt: { select: { id: true, userId: true, quiz: { select: { course: { select: { creatorId: true } } } } } } },
  });
  if (!row) throw new ApiError(404, "Evidence not found.", "EVIDENCE_NOT_FOUND");

  const isOwnStudent = user.role === "STUDENT" && row.attempt.userId === user.id;
  const isCourseInstructor = user.role === "INSTRUCTOR" && row.attempt.quiz.course?.creatorId === user.id;
  const isAdmin = user.role === "ADMIN";
  if (!isOwnStudent && !isCourseInstructor && !isAdmin) throw new ApiError(403, "You cannot view this image.", "EVIDENCE_FORBIDDEN");

  if (row.retainUntil && row.retainUntil.getTime() < Date.now() && !row.reviewHold) {
    throw new ApiError(410, "This image has passed its retention date.", "EVIDENCE_EXPIRED");
  }

  if (!isOwnStudent) {
    // Inside no transaction, but with a client, so a failed audit write fails the view.
    try {
      await audit.recordAuditEvent(
        { userId: user.id, sessionId: user.sessionId, deviceId: user.deviceId, eventType: audit.AUDIT_EVENTS.PROCTORING_EVIDENCE_VIEWED, metadata: { evidenceId, attemptId: row.attemptId, role: user.role } },
        { client: prisma }
      );
    } catch (error) {
      console.error("[proctoring-evidence] could not audit a staff view, so no image was sent:", error?.message);
      throw new ApiError(503, "This image cannot be shown right now. Please try again.", "EVIDENCE_AUDIT_FAILED");
    }
  }

  const bytes = row.storageState === "STORED" ? await getStore().get(row.objectKey) : await fs.promises.readFile(row.tempPath);
  return { bytes, mimeType: row.mimeType };
}

module.exports = {
  attemptTempDir,
  deleteEvidence,
  drain,
  flush,
  holdAttemptEvidence,
  isEvidenceStoreReady,
  keepFrame,
  readEvidenceFile,
  removeFile,
  retryUnstored,
  setStoreForTests,
  tempRoot,
};
