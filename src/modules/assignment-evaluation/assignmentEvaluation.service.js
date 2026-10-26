const crypto = require("crypto");

const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const {
    createEvaluatorRegistry,
    SynonymDictionary,
    validateQuestion,
    RubricError,
    defaultSynonyms,
} = require("./engine");
const { generateFeedback } = require("./engine/feedback/feedbackGenerator");
const { collectSubmissionText } = require("./submissionText.service");
const queue = require("./evaluationQueue");

/**
 * Assignment auto-evaluation: a rule-based evaluator proposes marks for a
 * student's written or PDF answer against the instructor's marking scheme.
 * The instructor is the final authority:
 *
 *   submitted ─> evaluating (job) ─> ready / needs-review ─> published
 *                     └─> failed            (instructor approves or sets marks)
 *
 *  - Automated results are proposals. Only an instructor decision (approve or
 *    override) is published, i.e. written to AssignmentSubmission.grade and
 *    marked isPublished. There is no automatic publishing.
 *  - Every result records the marking-scheme version and the submission
 *    version (submittedAt) it was computed from. A result whose inputs changed
 *    while it ran is discarded; a newer job is already queued.
 *  - A graded submission is never re-marked by an automatic job. The
 *    instructor must reopen it explicitly, and the student keeps the
 *    published grade until a new decision replaces it.
 *  - Decisions lock the submission row and carry the evaluation version the
 *    instructor was looking at, so concurrent or replayed requests fail with
 *    409 instead of overwriting each other.
 *  - Every evaluation is kept (AssignmentEvaluation) and every action is
 *    logged (AssignmentEvaluationAudit) with who and when.
 */

const registry = createEvaluatorRegistry({
    embeddings: {
        provider: process.env.EMBEDDING_PROVIDER || "none",
        url: process.env.EMBEDDING_URL,
        model: process.env.EMBEDDING_MODEL || "default",
    },
});

const TX_OPTIONS = { maxWait: 10000, timeout: 30000 };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n) => String(round2(n));
const onStep = (value, step) => Math.abs(value / step - Math.round(value / step)) < 1e-6;

const notFound = (what) => new ApiError(404, `${what} not found.`);
const badRequest = (message) => new ApiError(400, message);
const conflict = (message, code) => new ApiError(409, message, code);

// ─── Marking scheme ────────────────────────────────────────────────────────

const rubricInclude = { criteria: { orderBy: { position: "asc" } } };

function toEngineQuestion(rubric, assignment = {}) {
    return {
        id: rubric.assignmentId || assignment.id || null,
        prompt: assignment.title || "",
        idealAnswer: rubric.idealAnswer,
        maxMarks: rubric.maxMarks,
        markStep: rubric.markStep,
        keywords: rubric.keywords || [],
        synonyms: Array.isArray(rubric.synonyms) ? rubric.synonyms : [],
        misconceptions: rubric.misconceptions || [],
        criteria: (rubric.criteria || []).map((c, i) => ({
            id: c.id || `criterion-${i + 1}`,
            description: c.description,
            marks: c.marks,
            keywords: c.keywords || [],
            phrases: c.phrases || [],
            contradictions: c.contradictions || [],
            minKeywords: c.minKeywords ?? null,
        })),
    };
}

/** Throws 400 with the evaluator's own message when the scheme can't be marked consistently. */
function assertValidRubric(data) {
    try {
        validateQuestion(toEngineQuestion(data));
    } catch (error) {
        if (error instanceof RubricError) throw badRequest(error.message);
        throw error;
    }
}

const getRubric = async (assignmentId) => {
    const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, title: true, marks: true, rubric: { include: rubricInclude } },
    });
    if (!assignment) throw notFound("Assignment");
    return { assignmentMarks: assignment.marks, rubric: assignment.rubric };
};

/**
 * Saves the marking scheme. Its total is the assignment's marks: saving sets
 * Assignment.marks to it in the same transaction, so the two cannot diverge
 * (the response says when the marks changed). Each save is a new version;
 * ungraded submissions are queued again so their suggestions match it.
 */
const saveRubric = async (assignmentId, data, userId = null) => {
    assertValidRubric(data);
    const fields = {
        enabled: data.enabled,
        idealAnswer: data.idealAnswer,
        maxMarks: data.maxMarks,
        markStep: data.markStep,
        keywords: data.keywords,
        synonyms: data.synonyms,
        misconceptions: data.misconceptions,
        autoPublish: false,
    };
    const criteria = data.criteria.map((c, position) => ({
        position,
        description: c.description,
        marks: c.marks,
        keywords: c.keywords,
        phrases: c.phrases,
        contradictions: c.contradictions,
        minKeywords: c.minKeywords ?? null,
    }));

    let saved;
    try {
        saved = await prisma.$transaction(async (tx) => {
            const assignment = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { marks: true } });
            if (!assignment) throw notFound("Assignment");
            const marksChangedFrom = assignment.marks === data.maxMarks ? undefined : assignment.marks;
            if (marksChangedFrom !== undefined) {
                await tx.assignment.update({ where: { id: assignmentId }, data: { marks: data.maxMarks } });
            }

            const existing = await tx.assignmentRubric.findUnique({ where: { assignmentId }, select: { id: true } });
            let rubricId;
            if (existing) {
                // Updating the row first locks it, so two saves cannot interleave
                // their criteria; the increment gives each save its own version.
                await tx.assignmentRubric.update({ where: { id: existing.id }, data: { ...fields, version: { increment: 1 } } });
                await tx.assignmentRubricCriterion.deleteMany({ where: { rubricId: existing.id } });
                if (criteria.length) {
                    await tx.assignmentRubricCriterion.createMany({ data: criteria.map((c) => ({ ...c, rubricId: existing.id })) });
                }
                rubricId = existing.id;
            } else {
                const created = await tx.assignmentRubric.create({
                    data: { ...fields, assignmentId, version: 1, criteria: { create: criteria } },
                    select: { id: true },
                });
                rubricId = created.id;
            }
            const rubric = await tx.assignmentRubric.findUnique({ where: { id: rubricId }, include: rubricInclude });
            return { rubric, marksChangedFrom };
        }, TX_OPTIONS);
    } catch (error) {
        if (error.code === "P2002") throw conflict("The marking scheme was saved by someone else at the same time. Reload and try again.", "VERSION_CONFLICT");
        throw error;
    }

    const requeued = saved.rubric.enabled
        ? await queue.enqueueForAssignment(prisma, assignmentId, { reason: "RUBRIC_CHANGED", requestedById: userId })
        : 0;
    if (requeued) queue.kick();
    return {
        ...saved.rubric,
        assignmentMarks: data.maxMarks,
        marksChangedFrom: saved.marksChangedFrom === undefined ? null : saved.marksChangedFrom,
        requeued,
    };
};

/** Removes the scheme. Past evaluations stay in each submission's history. */
const deleteRubric = async (assignmentId) => {
    await prisma.$transaction([
        prisma.assignmentEvaluationJob.deleteMany({ where: { status: "QUEUED", submission: { assignmentId } } }),
        prisma.assignmentRubric.deleteMany({ where: { assignmentId } }),
    ]);
};

/** The shared synonym dictionary, plus a fingerprint recorded with each result. */
async function loadDictionary() {
    const groups = await prisma.evaluationSynonymGroup.findMany({ orderBy: { createdAt: "asc" }, select: { terms: true } });
    const terms = groups.map((g) => g.terms);
    return {
        dictionary: new SynonymDictionary(terms),
        meta: { groups: terms.length, hash: crypto.createHash("sha256").update(JSON.stringify(terms)).digest("hex").slice(0, 16) },
    };
}

/** Evaluates a sample answer against a draft scheme. Nothing is saved. */
const previewRubric = async (assignmentId, rubric, answerText) => {
    assertValidRubric(rubric);
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId }, select: { id: true, title: true } });
    if (!assignment) throw notFound("Assignment");
    const { dictionary } = await loadDictionary();
    return registry.get().evaluateAnswer({
        question: toEngineQuestion(rubric, assignment),
        answerText,
        dictionary,
    });
};

// ─── Grade text shown in the existing LMS screens ──────────────────────────

/** The LMS grade is free text (max 20 characters): "4.5/5". */
const gradeText = (marks, max) => `${fmt(marks)}/${fmt(max)}`;

/** Plain-text feedback for AssignmentSubmission.feedback (max 2000 characters). */
function feedbackText(feedback, instructorComment) {
    const lines = [];
    if (instructorComment) lines.push(`Instructor: ${instructorComment}`);
    if (feedback && feedback.summary) lines.push(feedback.summary);
    const list = (title, items, render) => {
        if (items && items.length) lines.push(`${title}: ${items.map(render).join("; ")}`);
    };
    if (feedback) {
        list("Covered", feedback.matched, (m) => m.description);
        list("Partly covered", feedback.partial, (p) => p.description + (p.missing && p.missing.length ? ` (also mention ${p.missing.slice(0, 4).join(", ")})` : ""));
        list("Not found", feedback.missing, (m) => m.description);
        list("Check", feedback.errors, (e) => e.message);
    }
    const text = lines.join("\n");
    return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

/** Writes a published decision into the LMS grade fields the student sees. */
async function publishToSubmission(tx, submissionId, evaluation) {
    await tx.assignmentSubmission.update({
        where: { id: submissionId },
        data: {
            grade: gradeText(evaluation.marksAwarded, evaluation.maxMarks),
            feedback: feedbackText(evaluation.feedback, evaluation.instructorComment),
            status: "Graded",
        },
    });
}

// ─── Storage helpers ───────────────────────────────────────────────────────

/** Locks the submission row for the rest of the transaction; null if it is gone. */
async function lockSubmission(tx, submissionId) {
    const rows = await tx.$queryRaw`
        SELECT "id", "assignmentId", "submittedAt", "grade"
        FROM "AssignmentSubmission" WHERE "id" = ${submissionId} FOR UPDATE`;
    return rows[0] || null;
}

function audit(tx, submissionId, action, { actorId = null, evaluationId = null, details = {} } = {}) {
    return tx.assignmentEvaluationAudit.create({ data: { submissionId, action, actorId, evaluationId, details } });
}

/** Stores a new version as current (and as the published one when it is). */
async function saveEvaluation(tx, submissionId, data) {
    const last = await tx.assignmentEvaluation.findFirst({
        where: { submissionId },
        orderBy: { version: "desc" },
        select: { version: true },
    });
    await tx.assignmentEvaluation.updateMany({ where: { submissionId, isCurrent: true }, data: { isCurrent: false } });
    if (data.isPublished) {
        await tx.assignmentEvaluation.updateMany({ where: { submissionId, isPublished: true }, data: { isPublished: false } });
    }
    return tx.assignmentEvaluation.create({
        data: { ...data, submissionId, version: (last ? last.version : 0) + 1, isCurrent: true },
    });
}

const failedResult = (message) => ({ failed: true, error: message });
const EMPTY_FEEDBACK = { summary: "", matched: [], partial: [], missing: [], errors: [], notes: [] };

// ─── Automated evaluation ──────────────────────────────────────────────────

/**
 * Runs the evaluator on a submission and stores the result as a proposal.
 * Outcomes: "saved", "disabled" (no enabled scheme), "finalized" (already
 * graded and not reopened), "stale" (the submission or the scheme changed
 * while it ran), "missing". Never publishes anything.
 */
const evaluateSubmission = async (submissionId, { job = null } = {}) => {
    const submission = await prisma.assignmentSubmission.findUnique({
        where: { id: submissionId },
        include: { assignment: { select: { id: true, title: true, marks: true, rubric: { include: rubricInclude } } } },
    });
    if (!submission) return { outcome: "missing" };
    const rubric = submission.assignment.rubric;
    if (!rubric || !rubric.enabled) return { outcome: "disabled" };
    const allowFinalized = Boolean(job && job.allowFinalized);
    if (submission.grade && !allowFinalized) return { outcome: "finalized" };

    const question = toEngineQuestion(rubric, submission.assignment);
    const { dictionary, meta: dictionaryMeta } = await loadDictionary();
    const { text, meta, reviewReasons: inputReasons } = await collectSubmissionText(submission);
    const evaluator = registry.get();

    let data;
    try {
        if (submission.assignment.marks !== rubric.maxMarks) {
            throw new Error(`the marking scheme is worth ${rubric.maxMarks} marks but the assignment is worth ${submission.assignment.marks ?? "no"} marks; save the marking scheme again`);
        }
        const result = await evaluator.evaluateAnswer({ question, answerText: text, dictionary });
        const { feedback, ...rest } = result;
        data = {
            source: "AUTO",
            engineName: result.engine.name,
            engineVersion: result.engine.version,
            marksAwarded: result.marksAwarded,
            maxMarks: result.maxMarks,
            // Marks resting on text that may be wrong cannot be high-confidence.
            confidence: inputReasons.length ? Math.min(result.confidence, 0.5) : result.confidence,
            needsReview: result.needsReview || inputReasons.length > 0,
            reviewReasons: [...inputReasons, ...result.reviewReasons],
            result: rest,
            feedback,
        };
    } catch (error) {
        console.error(`[assignment-evaluation] submission ${submissionId}:`, error.message);
        data = {
            source: "AUTO",
            engineName: evaluator.name,
            engineVersion: evaluator.version,
            marksAwarded: 0,
            maxMarks: rubric.maxMarks,
            confidence: 0,
            needsReview: true,
            reviewReasons: [`Automatic evaluation failed: ${error.message}`],
            result: failedResult(error.message),
            feedback: EMPTY_FEEDBACK,
        };
    }

    // Everything needed to reproduce this result: the exact scheme, the
    // dictionary fingerprint, the engine, and which version of the work.
    const inputMeta = {
        ...meta,
        submittedAt: submission.submittedAt.toISOString(),
        rubric: { version: rubric.version, question },
        dictionary: dictionaryMeta,
        engine: { name: evaluator.name, version: evaluator.version },
        request: job ? { reason: job.reason, requestedById: job.requestedById || null } : null,
    };

    return prisma.$transaction(async (tx) => {
        const locked = await lockSubmission(tx, submissionId);
        if (!locked) return { outcome: "missing" };
        const current = await tx.assignmentRubric.findUnique({
            where: { assignmentId: locked.assignmentId },
            select: { version: true, enabled: true },
        });
        const stale = locked.submittedAt.getTime() !== submission.submittedAt.getTime()
            || !current || !current.enabled || current.version !== rubric.version;
        if (stale) {
            await audit(tx, submissionId, "STALE_RESULT_DISCARDED", {
                details: { rubricVersion: rubric.version, submittedAt: inputMeta.submittedAt, reason: job ? job.reason : null },
            });
            return { outcome: "stale" };
        }
        if (locked.grade && !allowFinalized) {
            await audit(tx, submissionId, "SKIPPED_GRADED", { details: { reason: job ? job.reason : null } });
            return { outcome: "finalized" };
        }
        const saved = await saveEvaluation(tx, submissionId, {
            ...data,
            inputText: text,
            inputMeta,
            rubricVersion: rubric.version,
            submissionSubmittedAt: submission.submittedAt,
        });
        await audit(tx, submissionId, data.result.failed ? "EVALUATION_FAILED" : "EVALUATED", {
            evaluationId: saved.id,
            details: {
                version: saved.version,
                marksAwarded: saved.marksAwarded,
                maxMarks: saved.maxMarks,
                needsReview: saved.needsReview,
                rubricVersion: rubric.version,
                reason: job ? job.reason : null,
            },
        });
        return { outcome: "saved", evaluation: saved };
    }, TX_OPTIONS);
};

/** After the last retry: records a failed result the instructor can see and act on. */
async function recordJobFailure(job, error) {
    const submission = await prisma.assignmentSubmission.findUnique({
        where: { id: job.submissionId },
        select: { id: true, submittedAt: true, grade: true, assignment: { select: { rubric: { select: { enabled: true, version: true, maxMarks: true } } } } },
    });
    const rubric = submission && submission.assignment.rubric;
    if (!rubric || !rubric.enabled || (submission.grade && !job.allowFinalized)) return;
    const message = `Automatic evaluation failed after ${job.attempts} attempt(s): ${error.message}`;
    await prisma.$transaction(async (tx) => {
        const locked = await lockSubmission(tx, job.submissionId);
        if (!locked || locked.submittedAt.getTime() !== submission.submittedAt.getTime()) return;
        const saved = await saveEvaluation(tx, job.submissionId, {
            source: "AUTO",
            engineName: registry.get().name,
            engineVersion: registry.get().version,
            marksAwarded: 0,
            maxMarks: rubric.maxMarks,
            confidence: 0,
            needsReview: true,
            reviewReasons: [message],
            result: failedResult(message),
            feedback: EMPTY_FEEDBACK,
            inputText: "",
            inputMeta: { request: { reason: job.reason, requestedById: job.requestedById || null } },
            rubricVersion: rubric.version,
            submissionSubmittedAt: submission.submittedAt,
        });
        await audit(tx, job.submissionId, "EVALUATION_FAILED", { evaluationId: saved.id, details: { attempts: job.attempts, error: error.message } });
    }, TX_OPTIONS);
}

queue.setRunner({
    run: (job) => evaluateSubmission(job.submissionId, { job }),
    onFailed: recordJobFailure,
});

/**
 * Called after a student submits or resubmits. A resubmission replaces the
 * work (and the existing code clears its grade), so earlier results no longer
 * describe what the student handed in: they are unpublished. With an enabled
 * scheme the submission is queued; the job row is committed before the
 * student gets a response, so a restart cannot lose it.
 */
const onSubmitted = async (submissionId) => {
    const submission = await prisma.assignmentSubmission.findUnique({
        where: { id: submissionId },
        select: { submittedAt: true, assignment: { select: { rubric: { select: { enabled: true } } } } },
    });
    if (!submission) return;
    const enabled = Boolean(submission.assignment.rubric && submission.assignment.rubric.enabled);
    if (!enabled) {
        await prisma.assignmentEvaluation.updateMany({ where: { submissionId, isPublished: true }, data: { isPublished: false } });
        return;
    }
    await prisma.$transaction(async (tx) => {
        await tx.assignmentEvaluation.updateMany({ where: { submissionId, isPublished: true }, data: { isPublished: false } });
        await queue.enqueue(tx, submissionId, { reason: "SUBMITTED" });
        await audit(tx, submissionId, "SUBMITTED", { details: { submittedAt: submission.submittedAt.toISOString() } });
    }, TX_OPTIONS);
    queue.kick();
};

/**
 * Called after an instructor saves a grade by hand. A hand grade that differs
 * from the published evaluation replaces it, so the evaluation's breakdown is
 * no longer shown to the student. Checked under the row lock, against the
 * grade actually stored, so a concurrent approval is never undone.
 */
const onHandGraded = async (submissionId, actorId = null) => {
    const evaluated = await prisma.assignmentEvaluation.count({ where: { submissionId } });
    if (!evaluated) return;
    await prisma.$transaction(async (tx) => {
        const locked = await lockSubmission(tx, submissionId);
        if (!locked) return;
        const published = await tx.assignmentEvaluation.findFirst({
            where: { submissionId, isPublished: true },
            select: { id: true, marksAwarded: true, maxMarks: true },
        });
        const replaced = published && locked.grade !== gradeText(published.marksAwarded, published.maxMarks);
        if (replaced) {
            await tx.assignmentEvaluation.update({ where: { id: published.id }, data: { isPublished: false } });
        }
        await audit(tx, submissionId, "HAND_GRADED", {
            actorId,
            evaluationId: replaced ? published.id : null,
            details: { grade: locked.grade, unpublishedEvaluation: Boolean(replaced) },
        });
    }, TX_OPTIONS);
};

// ─── Instructor decisions ──────────────────────────────────────────────────

/** Locks the submission and loads everything a decision is checked against. */
async function loadDecisionContext(tx, assignmentId, submissionId) {
    const locked = await lockSubmission(tx, submissionId);
    if (!locked || locked.assignmentId !== assignmentId) throw notFound("Submission");
    const current = await tx.assignmentEvaluation.findFirst({ where: { submissionId, isCurrent: true } });
    const rubric = await tx.assignmentRubric.findUnique({ where: { assignmentId }, select: { version: true, markStep: true, enabled: true } });
    const job = await tx.assignmentEvaluationJob.findUnique({ where: { submissionId } });
    const assignment = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { marks: true } });
    return { locked, current, rubric, job, assignment };
}

/** The decision must be about the evaluation the instructor was looking at. */
function assertExpectedVersion(current, expectedVersion) {
    const actual = current ? current.version : null;
    if (actual !== (expectedVersion ?? null)) {
        throw conflict("This evaluation changed after you opened it. Reload it and decide again.", "VERSION_CONFLICT");
    }
}

function assertNotRunning(job) {
    if (queue.isActive(job)) {
        throw conflict("This submission is being evaluated. Wait for the result, then decide.", "EVALUATION_RUNNING");
    }
}

/** Approves the current automated proposal and publishes it to the student. */
const accept = async (assignmentId, submissionId, userId, { expectedVersion, comment } = {}) => {
    await prisma.$transaction(async (tx) => {
        const { locked, current, rubric, job, assignment } = await loadDecisionContext(tx, assignmentId, submissionId);
        if (!current) throw conflict("This submission has not been evaluated yet.", "NOT_EVALUATED");
        assertExpectedVersion(current, expectedVersion);
        assertNotRunning(job);
        if (current.source !== "AUTO") {
            throw conflict("These marks were already decided by an instructor. Use Change marks to alter them.", "ALREADY_DECIDED");
        }
        if (current.result && current.result.failed) {
            throw conflict("Automatic evaluation failed for this submission. Enter marks instead.", "EVALUATION_FAILED");
        }
        if (!rubric || current.rubricVersion !== rubric.version) {
            throw conflict("The marking scheme changed after this suggestion was made. Re-evaluate it first.", "OUTDATED");
        }
        if (!current.submissionSubmittedAt || current.submissionSubmittedAt.getTime() !== locked.submittedAt.getTime()) {
            throw conflict("The student resubmitted after this suggestion was made. Re-evaluate it first.", "OUTDATED");
        }
        if (assignment.marks !== current.maxMarks) {
            throw conflict(`The assignment is worth ${assignment.marks ?? "no"} marks, not ${current.maxMarks}. Re-evaluate it first.`, "OUTDATED");
        }
        const now = new Date();
        const saved = await saveEvaluation(tx, submissionId, {
            source: "INSTRUCTOR",
            engineName: current.engineName,
            engineVersion: current.engineVersion,
            marksAwarded: current.marksAwarded,
            maxMarks: current.maxMarks,
            confidence: current.confidence,
            needsReview: false,
            reviewReasons: [],
            result: current.result,
            feedback: current.feedback,
            inputText: current.inputText,
            inputMeta: current.inputMeta,
            overrideReason: "Approved the suggested marks",
            instructorComment: comment || null,
            createdById: userId,
            rubricVersion: current.rubricVersion,
            submissionSubmittedAt: current.submissionSubmittedAt,
            isPublished: true,
            publishedAt: now,
        });
        await publishToSubmission(tx, submissionId, saved);
        await audit(tx, submissionId, "APPROVED", {
            actorId: userId,
            evaluationId: saved.id,
            details: { fromVersion: current.version, version: saved.version, marksAwarded: saved.marksAwarded, maxMarks: saved.maxMarks },
        });
    }, TX_OPTIONS);
    return getEvaluation(assignmentId, submissionId);
};

/**
 * Instructor sets the marks, per criterion (keeps the breakdown and the
 * feedback consistent with the new marks) or as one total, and publishes
 * them. Checked against the assignment's marks and the mark step; requires a
 * reason; the previous version stays in the history.
 */
const override = async (assignmentId, submissionId, userId, { expectedVersion = null, criteria, marksAwarded, reason, comment }) => {
    await prisma.$transaction(async (tx) => {
        const { locked, current, rubric, job, assignment } = await loadDecisionContext(tx, assignmentId, submissionId);
        assertExpectedVersion(current, expectedVersion);
        assertNotRunning(job);
        const maxMarks = assignment.marks;
        if (!(maxMarks > 0)) throw conflict("This assignment has no marks set. Save a marking scheme first.", "NO_MAX_MARKS");
        const markStep = rubric ? rubric.markStep : 0.5;

        const previous = current && current.result && !current.result.failed ? current.result : { criteria: [] };
        let resultCriteria = Array.isArray(previous.criteria) ? previous.criteria : [];
        const perCriterion = Boolean(criteria && criteria.length);
        let total;
        let feedback;
        if (perCriterion) {
            if (!resultCriteria.length) throw badRequest("There is no criterion breakdown to change. Set the total instead.");
            if (current.maxMarks !== maxMarks) {
                throw conflict(`This breakdown was made for ${current.maxMarks} marks but the assignment is worth ${maxMarks}. Set the total instead.`, "OUTDATED");
            }
            const given = new Map(criteria.map((c) => [String(c.criterionId), c.awarded]));
            for (const id of given.keys()) {
                if (!resultCriteria.some((c) => String(c.criterionId) === id)) throw badRequest(`Unknown criterion ${id}.`);
            }
            resultCriteria = resultCriteria.map((c) => {
                if (!given.has(String(c.criterionId))) return c;
                const awarded = given.get(String(c.criterionId));
                if (awarded < 0 || awarded > c.maxMarks) throw badRequest(`"${c.description}" must be between 0 and ${c.maxMarks}.`);
                if (!onStep(awarded, markStep)) throw badRequest(`Marks must be in steps of ${markStep}.`);
                const status = awarded >= c.maxMarks ? "met" : awarded > 0 ? "partial" : "missing";
                // The instructor's judgement replaces the evaluator's flags for this point.
                return { ...c, awarded, status, overridden: true, flags: [], contradictions: [] };
            });
            total = round2(resultCriteria.reduce((sum, c) => sum + c.awarded, 0));
            feedback = generateFeedback({
                criteria: resultCriteria,
                marksAwarded: total,
                maxMarks,
                misconceptions: previous.misconceptions || [],
                flags: (previous.flags || []).filter((f) => f !== "keyword-list"),
            });
        } else {
            total = marksAwarded;
            // A total alone does not say which points earned the marks, so no
            // breakdown or point-by-point feedback is published with it.
            feedback = { ...EMPTY_FEEDBACK, summary: `Your instructor set your marks to ${fmt(total)}/${fmt(maxMarks)}.` };
        }
        if (typeof total !== "number" || total < 0 || total > maxMarks) throw badRequest(`Marks must be between 0 and ${maxMarks}.`);
        if (!onStep(total, markStep)) throw badRequest(`Marks must be in steps of ${markStep}.`);

        const now = new Date();
        const { failed, error, ...previousRest } = previous;
        const saved = await saveEvaluation(tx, submissionId, {
            source: "INSTRUCTOR",
            engineName: "instructor",
            engineVersion: "n/a",
            marksAwarded: total,
            maxMarks,
            confidence: null,
            needsReview: false,
            reviewReasons: [],
            result: { ...previousRest, criteria: resultCriteria, marksAwarded: total, maxMarks, totalOverride: !perCriterion },
            feedback,
            inputText: current ? current.inputText : "",
            inputMeta: current ? current.inputMeta : {},
            overrideReason: reason,
            instructorComment: comment || null,
            createdById: userId,
            rubricVersion: current ? current.rubricVersion : rubric ? rubric.version : null,
            submissionSubmittedAt: locked.submittedAt,
            isPublished: true,
            publishedAt: now,
        });
        await publishToSubmission(tx, submissionId, saved);
        await audit(tx, submissionId, "OVERRIDDEN", {
            actorId: userId,
            evaluationId: saved.id,
            details: {
                fromVersion: current ? current.version : null,
                version: saved.version,
                marksAwarded: total,
                maxMarks,
                mode: perCriterion ? "criteria" : "total",
                reason,
            },
        });
    }, TX_OPTIONS);
    return getEvaluation(assignmentId, submissionId);
};

/**
 * Queues a fresh evaluation of one submission. A graded submission needs an
 * explicit reopen: the new result is only a proposal, and the student keeps
 * the published grade until the instructor approves a new one.
 */
const reEvaluate = async (assignmentId, submissionId, userId, { reopen = false } = {}) => {
    const s = await prisma.assignmentSubmission.findFirst({
        where: { id: submissionId, assignmentId },
        select: { id: true, grade: true, assignment: { select: { rubric: { select: { enabled: true } } } } },
    });
    if (!s) throw notFound("Submission");
    if (!s.assignment.rubric || !s.assignment.rubric.enabled) {
        throw conflict("Turn on auto-evaluation for this assignment first.", "DISABLED");
    }
    if (s.grade && !reopen) {
        throw conflict(
            "This submission already has a published grade. Re-evaluating creates a new suggestion for you to approve; the student keeps the current grade until then.",
            "FINALIZED"
        );
    }
    const reopening = Boolean(s.grade);
    await prisma.$transaction(async (tx) => {
        await queue.enqueue(tx, submissionId, {
            reason: reopening ? "REOPEN" : "REEVALUATE",
            requestedById: userId,
            allowFinalized: reopening,
        });
        await audit(tx, submissionId, reopening ? "REOPENED" : "REEVALUATION_REQUESTED", { actorId: userId, details: { grade: s.grade } });
    }, TX_OPTIONS);
    queue.kick();
    return getEvaluation(assignmentId, submissionId);
};

/** Queues every ungraded submission, e.g. after the scheme changed. Graded ones are left alone. */
const evaluateAll = async (assignmentId, userId) => {
    const rubric = await prisma.assignmentRubric.findUnique({ where: { assignmentId }, select: { enabled: true } });
    if (!rubric || !rubric.enabled) throw conflict("Turn on auto-evaluation for this assignment first.", "DISABLED");
    const queued = await queue.enqueueForAssignment(prisma, assignmentId, { reason: "EVALUATE_ALL", requestedById: userId });
    const total = await prisma.assignmentSubmission.count({ where: { assignmentId } });
    if (queued) queue.kick();
    return { queued, skippedGraded: Math.max(0, total - queued) };
};

// ─── Views ─────────────────────────────────────────────────────────────────

/**
 * Status of a submission's evaluation as the instructor sees it:
 *   pending | evaluating | ready | needs-review | outdated | failed
 *   | published | graded-by-hand   (null: auto-evaluation not in use)
 */
function evaluationStatus({ current, published, submission, rubric, job }) {
    if (queue.isActive(job)) return "evaluating";
    if (!current) {
        if (job && job.status === "FAILED") return "failed";
        if (!rubric || !rubric.enabled) return null;
        return submission.grade ? "graded-by-hand" : "pending";
    }
    if (current.isPublished) return "published";
    if (current.source === "AUTO") {
        // Graded by hand since this proposal was made (no published evaluation).
        if (submission.grade && !published) return "graded-by-hand";
        if (current.result && current.result.failed) return "failed";
        if (rubric && current.rubricVersion !== rubric.version) return "outdated";
        return current.needsReview ? "needs-review" : "ready";
    }
    // An instructor decision that is no longer published: graded by hand since.
    return submission.grade ? "graded-by-hand" : "pending";
}

const publishedSummary = (e) => (e
    ? {
        id: e.id,
        version: e.version,
        marksAwarded: e.marksAwarded,
        maxMarks: e.maxMarks,
        publishedAt: e.publishedAt,
        // A published version is created by the instructor who published it.
        publishedBy: e.createdBy || null,
    }
    : null);

const jobSummary = (job) => (job
    ? { status: job.status, reason: job.reason, attempts: job.attempts, lastError: job.lastError, updatedAt: job.updatedAt }
    : null);

/** One submission's evaluation for the instructor: current proposal, published result, job, history, audit. */
const getEvaluation = async (assignmentId, submissionId) => {
    const s = await prisma.assignmentSubmission.findFirst({
        where: { id: submissionId, assignmentId },
        include: {
            evaluations: {
                orderBy: { version: "desc" },
                include: {
                    createdBy: { select: { id: true, name: true } },
                },
            },
            evaluationJob: true,
            evaluationAudits: {
                orderBy: { createdAt: "desc" },
                take: 50,
                include: { actor: { select: { id: true, name: true } } },
            },
            assignment: { select: { id: true, marks: true, rubric: { select: { enabled: true, version: true, markStep: true } } } },
        },
    });
    if (!s) throw notFound("Submission");
    const current = s.evaluations.find((e) => e.isCurrent) || null;
    const published = s.evaluations.find((e) => e.isPublished) || null;
    const rubric = s.assignment.rubric;
    return {
        submissionId: s.id,
        submittedAt: s.submittedAt,
        status: evaluationStatus({ current, published, submission: s, rubric, job: s.evaluationJob }),
        grade: s.grade,
        assignmentMarks: s.assignment.marks,
        rubricVersion: rubric ? rubric.version : null,
        markStep: rubric ? rubric.markStep : null,
        current,
        published: publishedSummary(published),
        job: jobSummary(s.evaluationJob),
        // The history list needs no evaluated text or evidence for every version.
        history: s.evaluations.map((e) => ({
            id: e.id,
            version: e.version,
            source: e.source,
            marksAwarded: e.marksAwarded,
            maxMarks: e.maxMarks,
            needsReview: e.needsReview,
            failed: Boolean(e.result && e.result.failed),
            overrideReason: e.overrideReason,
            rubricVersion: e.rubricVersion,
            isCurrent: e.isCurrent,
            isPublished: e.isPublished,
            createdAt: e.createdAt,
            createdBy: e.createdBy,
        })),
        audit: s.evaluationAudits.map((a) => ({
            id: a.id,
            action: a.action,
            actor: a.actor,
            details: a.details,
            createdAt: a.createdAt,
        })),
    };
};

/** Evaluation summaries for the instructor's submissions table, by submission id. */
const summariesForSubmissions = async (assignmentId, submissions) => {
    const ids = submissions.map((s) => s.id);
    const [rubric, evaluations, jobs] = await Promise.all([
        prisma.assignmentRubric.findUnique({ where: { assignmentId }, select: { enabled: true, version: true, markStep: true } }),
        ids.length
            ? prisma.assignmentEvaluation.findMany({
                where: { submissionId: { in: ids }, OR: [{ isCurrent: true }, { isPublished: true }] },
                select: {
                    submissionId: true, source: true, marksAwarded: true, maxMarks: true, confidence: true,
                    needsReview: true, result: true, rubricVersion: true, isCurrent: true, isPublished: true,
                },
            })
            : [],
        ids.length ? prisma.assignmentEvaluationJob.findMany({ where: { submissionId: { in: ids } } }) : [],
    ]);
    const currents = new Map(evaluations.filter((e) => e.isCurrent).map((e) => [e.submissionId, e]));
    const publisheds = new Map(evaluations.filter((e) => e.isPublished).map((e) => [e.submissionId, e]));
    const jobsBySubmission = new Map(jobs.map((j) => [j.submissionId, j]));
    const map = new Map();
    for (const s of submissions) {
        const current = currents.get(s.id) || null;
        const published = publisheds.get(s.id) || null;
        const status = evaluationStatus({ current, published, submission: s, rubric, job: jobsBySubmission.get(s.id) });
        map.set(s.id, status
            ? {
                status,
                marksAwarded: current ? current.marksAwarded : null,
                maxMarks: current ? current.maxMarks : null,
                confidence: current && current.source === "AUTO" ? current.confidence : null,
                publishedMarks: published ? published.marksAwarded : null,
            }
            : null);
    }
    return {
        rubricEnabled: Boolean(rubric && rubric.enabled),
        markStep: rubric ? rubric.markStep : null,
        summaries: map,
    };
};

/**
 * What a student may see: the breakdown behind their grade, only from the
 * published (instructor-approved) evaluation and only while the stored grade
 * is that evaluation's. Proposals, review reasons, internal notes and the
 * evaluator's evidence are never included.
 */
const studentView = async (submission) => {
    if (!submission || !submission.grade) return null;
    const published = await prisma.assignmentEvaluation.findFirst({ where: { submissionId: submission.id, isPublished: true } });
    if (!published || submission.grade !== gradeText(published.marksAwarded, published.maxMarks)) return null;
    const result = published.result || {};
    const criteria = !result.totalOverride && Array.isArray(result.criteria) ? result.criteria : [];
    const feedback = published.feedback || {};
    return {
        marksAwarded: published.marksAwarded,
        maxMarks: published.maxMarks,
        markedBy: "instructor",
        approvedAt: published.publishedAt,
        criteria: criteria.map((c) => ({ description: c.description, awarded: c.awarded, maxMarks: c.maxMarks, status: c.status })),
        feedback: {
            summary: feedback.summary || "",
            matched: feedback.matched || [],
            partial: feedback.partial || [],
            missing: feedback.missing || [],
            errors: feedback.errors || [],
            notes: feedback.notes || [],
        },
        instructorComment: published.instructorComment,
    };
};

// ─── Shared synonym dictionary ─────────────────────────────────────────────

const listSynonyms = () => prisma.evaluationSynonymGroup.findMany({
    orderBy: { createdAt: "asc" },
    include: { createdBy: { select: { name: true } } },
});

const addSynonymGroup = async ({ terms, note }, userId) => {
    const unique = [...new Map(terms.map((t) => [SynonymDictionary.termKey(t), t.trim()])).entries()]
        .filter(([key]) => key)
        .map(([, t]) => t);
    if (unique.length < 2) throw badRequest("A synonym group needs at least two different terms.");
    const taken = new Set((await listSynonyms()).flatMap((g) => g.terms.map((t) => SynonymDictionary.termKey(t))));
    const clashes = unique.filter((t) => taken.has(SynonymDictionary.termKey(t)));
    if (clashes.length) throw conflict(`Already in another group: ${clashes.join(", ")}.`, "SYNONYM_CLASH");
    return prisma.evaluationSynonymGroup.create({ data: { terms: unique, note: note || null, createdById: userId } });
};

/** Only the instructor who added a group, or an admin, may remove it: every assignment uses it. */
const removeSynonymGroup = async (id, user) => {
    const group = await prisma.evaluationSynonymGroup.findUnique({ where: { id }, select: { createdById: true } });
    if (!group) throw notFound("Synonym group");
    if (user.role !== "ADMIN" && group.createdById !== user.id) {
        throw new ApiError(403, "Only the instructor who added this group, or an admin, can remove it.");
    }
    await prisma.evaluationSynonymGroup.delete({ where: { id } });
};

/** Adds the starter science groups that don't clash with existing terms. */
const addStarterSynonyms = async (userId) => {
    const taken = new Set((await listSynonyms()).flatMap((g) => g.terms.map((t) => SynonymDictionary.termKey(t))));
    const fresh = defaultSynonyms.filter((group) => group.every((t) => !taken.has(SynonymDictionary.termKey(t))));
    if (fresh.length) {
        await prisma.evaluationSynonymGroup.createMany({
            data: fresh.map((terms) => ({ terms, note: "Starter dictionary", createdById: userId })),
        });
    }
    return { added: fresh.length };
};

/**
 * Called before an assignment's marks are edited. With a marking scheme the
 * scheme's total is the assignment's marks, so they are changed there.
 */
const assertMarksEditable = async (assignmentId, marks) => {
    const rubric = await prisma.assignmentRubric.findUnique({ where: { assignmentId }, select: { maxMarks: true } });
    if (rubric && marks !== rubric.maxMarks) {
        throw conflict(
            `This assignment's marks come from its auto-evaluation marking scheme (${fmt(rubric.maxMarks)}). Change the total in the marking scheme instead.`,
            "MARKS_FROM_RUBRIC"
        );
    }
};

module.exports = {
    getRubric,
    saveRubric,
    deleteRubric,
    previewRubric,
    evaluateSubmission,
    recordJobFailure,
    onSubmitted,
    onHandGraded,
    getEvaluation,
    accept,
    override,
    reEvaluate,
    evaluateAll,
    summariesForSubmissions,
    studentView,
    listSynonyms,
    addSynonymGroup,
    removeSynonymGroup,
    addStarterSynonyms,
    assertMarksEditable,
};
