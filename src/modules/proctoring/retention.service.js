const fs = require("fs");
const path = require("path");

const prisma = require("../../config/database");
const { AUDIT_EVENTS, recordAuditEvent } = require("../audit/audit.service");
const evidence = require("./evidence.service");
const { OPEN_STATUSES } = require("./attemptStanding");

/**
 * Retention, by the date on each kept frame rather than by what can be found out at sweep
 * time, so it fixes what ProctorGuard's sweep could not do: hold events that nothing could
 * create, and flagged evidence that was never deleted at all.
 *
 *   Violation and unanalysed frames: 90 days, or until review closes, whichever is later.
 *   Clean attempts' one-a-minute frames and identity photo: 7 days.
 *   Detection frames: temp disk only. Gone when the attempt closes, and this sweep clears
 *   any left behind (a restart, say), within an hour of the close.
 *
 * Attempts, answers, events and audit rows are kept. Only images go.
 */

const BATCH = 200;

async function sweepExpiredEvidence(now) {
  const expired = await prisma.proctoringEvidence.findMany({
    where: { retainUntil: { lt: now }, reviewHold: false },
    select: { id: true, attemptId: true, storageState: true, objectKey: true, tempPath: true, category: true },
    take: BATCH,
  });
  let deleted = 0;
  let errors = 0;
  for (const row of expired) {
    try {
      await evidence.deleteEvidence(row);
      deleted += 1;
    } catch (error) {
      // The row stays, so the next sweep tries again.
      errors += 1;
      console.warn("[proctoring-retention] could not delete an image:", error?.message);
    }
  }
  return { deleted, errors };
}

/** Temp folders of attempts that have closed or no longer exist, keeping anything still waiting to be stored. */
async function sweepTempFolders() {
  const entries = await fs.promises.readdir(evidence.tempRoot(), { withFileTypes: true }).catch(() => []);
  const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (ids.length === 0) return 0;
  const open = await prisma.proctoredAttempt.findMany({ where: { id: { in: ids }, status: { in: OPEN_STATUSES } }, select: { id: true } });
  const waiting = await prisma.proctoringEvidence.findMany({ where: { attemptId: { in: ids }, tempPath: { not: null } }, distinct: ["attemptId"], select: { attemptId: true } });
  const keep = new Set([...open.map((row) => row.id), ...waiting.map((row) => row.attemptId)]);
  let removed = 0;
  for (const id of ids) {
    if (keep.has(id)) continue;
    await fs.promises.rm(path.join(evidence.tempRoot(), id), { recursive: true, force: true }).catch(() => {});
    removed += 1;
  }
  return removed;
}

/** One pass of everything. Never overlaps itself; the job runs it every 15 minutes. */
async function retentionSweep(now = new Date()) {
  await evidence.flush();
  const { deleted, errors } = await sweepExpiredEvidence(now);
  const retried = await evidence.retryUnstored();
  const tempFolders = await sweepTempFolders();
  // The close removes these in its transaction; this catches anything else.
  const { count: templates } = await prisma.proctoringIdentityBaseline.deleteMany({ where: { attempt: { status: { notIn: OPEN_STATUSES } } } });
  if (deleted > 0 || tempFolders > 0 || templates > 0) {
    await recordAuditEvent({ eventType: AUDIT_EVENTS.PROCTORING_RETENTION_SWEEP, metadata: { deleted, errors, tempFolders, templates, retried } });
  }
  return { deleted, errors, retried, tempFolders, templates };
}

module.exports = { retentionSweep };
