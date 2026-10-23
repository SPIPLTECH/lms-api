const crypto = require("crypto");
const { Prisma } = require("@prisma/client");

const prisma = require("../../config/database");

/**
 * Durable evaluation queue, kept in the AssignmentEvaluationJob table (one
 * row per submission) so a restart loses nothing:
 *
 *   QUEUED ──claim──> PROCESSING ──done──> DONE
 *     ^                    │  └──error──> QUEUED (retry, with a delay) ... FAILED
 *     └──── rerun ─────────┘
 *
 *  - enqueue() is one INSERT ... ON CONFLICT, so concurrent requests for the
 *    same submission collapse into one job. A request that arrives while the
 *    job runs sets `rerun`, and the job runs once more afterwards.
 *  - claimNext() takes one due job with FOR UPDATE SKIP LOCKED, so two
 *    workers (or two API instances) never run the same job. A PROCESSING job
 *    whose lock is older than STALE_LOCK_MINUTES belonged to a process that
 *    died and is taken over.
 *  - `attempts` is bumped by every claim and doubles as a fencing token: a
 *    worker whose job was taken over can no longer finish it.
 *
 * The queue only schedules work. Whether a result may become current (stale
 * submission or marking scheme, approved marks) is decided by the service
 * inside its own transaction.
 */

const MAX_ATTEMPTS = Math.max(1, Number(process.env.EVALUATION_MAX_ATTEMPTS || 3));
const STALE_LOCK_MINUTES = Math.max(1, Number(process.env.EVALUATION_STALE_LOCK_MINUTES || 10));
const POLL_MS = Math.max(5000, Number(process.env.EVALUATION_POLL_MS || 30000));
const RETRY_DELAY_SECONDS = 30;

const ACTIVE_STATUSES = ["QUEUED", "PROCESSING"];
const isActive = (job) => Boolean(job && ACTIVE_STATUSES.includes(job.status));

// EVALUATION_WORKER=off: jobs are still recorded, but nothing in this process
// runs them (tests drive drain() themselves; another instance may run them).
const autoRun = (process.env.EVALUATION_WORKER || "on").toLowerCase() !== "off";

let runner = null;

/** The service registers how a job is run and how a final failure is recorded. */
function setRunner(value) {
    runner = value;
}

// An existing row: a running job is marked to run again; any other is queued
// afresh. A pending "reopen" (allowFinalized) is never lost by a later request.
const ON_CONFLICT = Prisma.sql`
    ON CONFLICT ("submissionId") DO UPDATE SET
        "status" = CASE WHEN "AssignmentEvaluationJob"."status" = 'PROCESSING' THEN 'PROCESSING' ELSE 'QUEUED' END,
        "rerun" = ("AssignmentEvaluationJob"."status" = 'PROCESSING'),
        "attempts" = CASE WHEN "AssignmentEvaluationJob"."status" = 'PROCESSING' THEN "AssignmentEvaluationJob"."attempts" ELSE 0 END,
        "runAfter" = CASE WHEN "AssignmentEvaluationJob"."status" = 'PROCESSING' THEN "AssignmentEvaluationJob"."runAfter" ELSE now() END,
        "allowFinalized" = CASE
            WHEN "AssignmentEvaluationJob"."status" IN ('QUEUED', 'PROCESSING')
                THEN "AssignmentEvaluationJob"."allowFinalized" OR EXCLUDED."allowFinalized"
            ELSE EXCLUDED."allowFinalized" END,
        "reason" = EXCLUDED."reason",
        "requestedById" = EXCLUDED."requestedById",
        "lastError" = NULL,
        "updatedAt" = now()`;

/** Queues a submission. `db` is prisma or a transaction client. */
async function enqueue(db, submissionId, { reason, requestedById = null, allowFinalized = false }) {
    await db.$executeRaw`
        INSERT INTO "AssignmentEvaluationJob"
            ("id", "submissionId", "status", "reason", "allowFinalized", "requestedById", "runAfter", "createdAt", "updatedAt")
        VALUES (${crypto.randomUUID()}, ${submissionId}, 'QUEUED', ${reason}, ${allowFinalized}, ${requestedById}, now(), now(), now())
        ${ON_CONFLICT}`;
}

/**
 * Queues, in one statement, every submission of an assignment that has no
 * grade yet, plus any whose job is already pending (a reopened one keeps its
 * reopen). Graded submissions are left alone. Returns how many were queued.
 */
async function enqueueForAssignment(db, assignmentId, { reason, requestedById = null }) {
    return db.$executeRaw`
        INSERT INTO "AssignmentEvaluationJob"
            ("id", "submissionId", "status", "reason", "allowFinalized", "requestedById", "runAfter", "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, s."id", 'QUEUED', ${reason}, false, ${requestedById}, now(), now(), now()
        FROM "AssignmentSubmission" s
        LEFT JOIN "AssignmentEvaluationJob" j ON j."submissionId" = s."id"
        WHERE s."assignmentId" = ${assignmentId}
          AND (s."grade" IS NULL OR j."status" IN ('QUEUED', 'PROCESSING'))
        ${ON_CONFLICT}`;
}

/** Drops jobs that have not started (e.g. the marking scheme was removed). */
async function cancelQueued(db, submissionIds) {
    if (!submissionIds.length) return 0;
    const { count } = await db.assignmentEvaluationJob.deleteMany({
        where: { submissionId: { in: submissionIds }, status: "QUEUED" },
    });
    return count;
}

async function claimNext() {
    const rows = await prisma.$queryRaw`
        UPDATE "AssignmentEvaluationJob"
        SET "status" = 'PROCESSING', "lockedAt" = now(), "attempts" = "attempts" + 1, "rerun" = false, "updatedAt" = now()
        WHERE "id" = (
            SELECT "id" FROM "AssignmentEvaluationJob"
            WHERE ("status" = 'QUEUED' AND "runAfter" <= now())
               OR ("status" = 'PROCESSING' AND "lockedAt" < now() - (${STALE_LOCK_MINUTES}::int * interval '1 minute'))
            ORDER BY "runAfter"
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *`;
    return rows[0] || null;
}

/** Done; or queued again when a request arrived while it ran. */
async function completeJob(job) {
    await prisma.$executeRaw`
        UPDATE "AssignmentEvaluationJob" SET
            "status" = CASE WHEN "rerun" THEN 'QUEUED' ELSE 'DONE' END,
            "attempts" = CASE WHEN "rerun" THEN 0 ELSE "attempts" END,
            "allowFinalized" = CASE WHEN "rerun" THEN "allowFinalized" ELSE false END,
            "runAfter" = now(), "rerun" = false, "lockedAt" = NULL, "lastError" = NULL, "updatedAt" = now()
        WHERE "id" = ${job.id} AND "status" = 'PROCESSING' AND "attempts" = ${job.attempts}`;
}

/** Retries later, or gives up after MAX_ATTEMPTS. Returns the new status (null if the job was taken over). */
async function retryOrFail(job, error) {
    const final = job.attempts >= MAX_ATTEMPTS;
    const delay = RETRY_DELAY_SECONDS * job.attempts;
    const message = String(error && error.message ? error.message : error).slice(0, 1000);
    const rows = await prisma.$queryRaw`
        UPDATE "AssignmentEvaluationJob" SET
            "status" = CASE WHEN "rerun" THEN 'QUEUED' WHEN ${final}::boolean THEN 'FAILED' ELSE 'QUEUED' END,
            "attempts" = CASE WHEN "rerun" THEN 0 ELSE "attempts" END,
            "runAfter" = CASE WHEN "rerun" THEN now() ELSE now() + (${delay}::int * interval '1 second') END,
            "rerun" = false, "lockedAt" = NULL, "lastError" = ${message}, "updatedAt" = now()
        WHERE "id" = ${job.id} AND "status" = 'PROCESSING' AND "attempts" = ${job.attempts}
        RETURNING "status"`;
    return rows[0] ? rows[0].status : null;
}

async function processJob(job) {
    if (!runner) throw new Error("No evaluation runner registered");
    try {
        // A job that keeps killing its process is not tried forever.
        if (job.attempts > MAX_ATTEMPTS) throw new Error(`stopped after ${MAX_ATTEMPTS} attempts`);
        await runner.run(job);
        await completeJob(job);
        return "done";
    } catch (error) {
        const status = await retryOrFail(job, error);
        if (status === "FAILED") {
            await runner.onFailed(job, error).catch((e) =>
                console.error(`[assignment-evaluation] could not record the failure of ${job.submissionId}:`, e.message));
        }
        console.error(`[assignment-evaluation] job for ${job.submissionId} failed (attempt ${job.attempts}):`, error.message);
        return status === "FAILED" ? "failed" : "retry";
    }
}

let draining = null;
let again = false;
let lastLoggedError = null;

/** Runs due jobs one at a time (OCR is CPU-bound) until none are left. */
function drain() {
    if (draining) {
        again = true;
        return draining;
    }
    draining = (async () => {
        do {
            again = false;
            let job;
            while ((job = await claimNext())) await processJob(job);
        } while (again);
        lastLoggedError = null;
    })()
        .catch((error) => {
            if (error.message !== lastLoggedError) {
                lastLoggedError = error.message;
                const missing = /AssignmentEvaluationJob/.test(error.message) && /does not exist/.test(error.message);
                console.error(
                    missing
                        ? "[assignment-evaluation] the AssignmentEvaluationJob table is missing; apply scripts/assignment-evaluation-2-review-workflow.sql."
                        : `[assignment-evaluation] queue: ${error.message}`
                );
            }
        })
        .finally(() => {
            draining = null;
        });
    return draining;
}

/** Starts work right away instead of waiting for the next poll. */
function kick() {
    if (autoRun) setImmediate(drain);
}

let timer = null;

/** Called once by server.js: picks up queued and orphaned jobs, then polls. */
function startWorker() {
    if (!autoRun || timer) return;
    timer = setInterval(drain, POLL_MS);
    timer.unref();
    drain();
}

function stopWorker() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = {
    enqueue,
    enqueueForAssignment,
    cancelQueued,
    claimNext,
    processJob,
    drain,
    kick,
    startWorker,
    stopWorker,
    setRunner,
    isActive,
    ACTIVE_STATUSES,
    MAX_ATTEMPTS,
    STALE_LOCK_MINUTES,
};
