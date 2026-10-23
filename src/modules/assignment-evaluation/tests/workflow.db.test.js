'use strict';

// End-to-end evaluation workflow against a real PostgreSQL schema: queue,
// staleness, retries and recovery, instructor approval and overrides,
// concurrency, student visibility and HTTP authorization.
//
// Runs only when EVALUATION_DB_TESTS=1 and TEST_DATABASE_URL names a schema
// ending in "_test" (e.g. ...?schema=lms_evaluation_test), created with the
// project schema plus scripts/assignment-evaluation-2-review-workflow.sql.
// It never touches the application schema. Every row it creates is deleted.

process.env.EVALUATION_WORKER = 'off';

const test = require('node:test');
const assert = require('node:assert/strict');

const schemaName = (() => {
  try { return new URL(process.env.TEST_DATABASE_URL || '').searchParams.get('schema') || ''; } catch { return ''; }
})();
const enabled = process.env.EVALUATION_DB_TESTS === '1' && /_test$/.test(schemaName);
const skip = enabled ? false : 'database tests: set EVALUATION_DB_TESTS=1 and TEST_DATABASE_URL=...?schema=<name>_test';

test('assignment evaluation workflow (database)', { skip, timeout: 15 * 60 * 1000 }, async (t) => {
  const fs = require('fs');
  const path = require('path');
  const http = require('http');
  const jwt = require('jsonwebtoken');

  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'evaluation-db-test-secret';

  const prisma = require('../../../config/database');
  const service = require('../assignmentEvaluation.service');
  const queue = require('../evaluationQueue');
  const { rubricSchema } = require('../assignmentEvaluation.validation');
  const { createEvaluatorRegistry, SynonymDictionary } = require('../engine');
  const assignmentService = require('../../assignments/assignment.service');
  const progress = require('../../progress/progress.service');
  const sessionService = require('../../sessions/session.service');
  const { typedPdf } = require('./makePdf');

  const [{ s: currentSchema }] = await prisma.$queryRaw`SELECT current_schema() AS s`;
  assert.equal(currentSchema, schemaName, 'must run in the test schema only');

  // The learning-sequence gate is not under test here.
  const originalGate = progress.assertSequenceItemAccessible;
  progress.assertSequenceItemAccessible = async () => {};

  const tag = `ev${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const created = { users: [], synonymGroups: [], files: [] };
  const server = http.createServer(require('../../../app'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    progress.assertSequenceItemAccessible = originalGate;
    await new Promise((resolve) => server.close(resolve));
    for (const f of created.files) fs.rmSync(f, { force: true });
    await prisma.evaluationSynonymGroup.deleteMany({ where: { id: { in: created.synonymGroups } } });
    // Courses, assignments, submissions, evaluations, jobs and audits cascade.
    await prisma.user.deleteMany({ where: { id: { in: created.users.map((u) => u.id) } } });
    await prisma.$disconnect();
  });

  const makeUser = async (role, name) => {
    const user = await prisma.user.create({
      data: { name: `${name} ${tag}`, email: `${name}-${tag}@example.test`, password: `not-a-real-hash-${name}-${tag}`, role },
    });
    created.users.push(user);
    if (role === 'STUDENT') user.profile = await prisma.studentProfile.create({ data: { userId: user.id } });
    // A real session, as sign-in creates one: verifyToken checks the token's
    // `sid` against it and the device key on every request.
    const { session, deviceKey } = await sessionService.createSession({
      userId: user.id,
      authMethod: sessionService.AUTH_METHODS.PASSWORD,
    });
    user.deviceKey = deviceKey;
    user.token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, sid: session.id },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '1h' },
    );
    return user;
  };

  const api = async (user, method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        Authorization: `Bearer ${user.token}`,
        'X-Device-Key': user.deviceKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const owner = await makeUser('INSTRUCTOR', 'owner');
  const otherInstructor = await makeUser('INSTRUCTOR', 'other');
  const admin = await makeUser('ADMIN', 'admin');
  const asha = await makeUser('STUDENT', 'asha');
  const ravi = await makeUser('STUDENT', 'ravi');
  const meera = await makeUser('STUDENT', 'meera');

  const course = await prisma.course.create({ data: { title: `Evaluation test ${tag}`, creatorId: owner.id } });
  const otherCourse = await prisma.course.create({ data: { title: `Other ${tag}`, creatorId: otherInstructor.id } });
  const assignment = await prisma.assignment.create({ data: { title: 'Photosynthesis', courseId: course.id, marks: 10, isPublished: true } });
  const otherAssignment = await prisma.assignment.create({ data: { title: 'Elsewhere', courseId: otherCourse.id, marks: 4, isPublished: true } });

  const RUBRIC = rubricSchema.validate({
    idealAnswer: 'Chlorophyll absorbs light energy. Plants release oxygen.',
    maxMarks: 4,
    markStep: 0.5,
    misconceptions: ['plants get their food from the soil'],
    criteria: [
      { description: 'Chlorophyll absorbs light', marks: 2, keywords: ['chlorophyll', 'absorb', 'light'] },
      { description: 'Oxygen is released', marks: 2, keywords: ['oxygen', 'release'] },
    ],
  }).value;
  const CORRECT = 'Chlorophyll in the leaf absorbs light energy, and the plant releases oxygen as a product.';
  const PARTIAL = 'Chlorophyll absorbs light.';

  const submit = (student, data) => assignmentService.submitAssignment(assignment.id, student.profile.id, data);
  const submissionOf = (student, a = assignment) => prisma.assignmentSubmission.findUnique({
    where: { studentId_assignmentId: { studentId: student.profile.id, assignmentId: a.id } },
  });
  const current = (submissionId) => prisma.assignmentEvaluation.findFirst({ where: { submissionId, isCurrent: true } });
  const versions = (submissionId) => prisma.assignmentEvaluation.count({ where: { submissionId } });
  const actions = async (submissionId) => (await prisma.assignmentEvaluationAudit.findMany({
    where: { submissionId }, orderBy: { createdAt: 'asc' }, select: { action: true },
  })).map((a) => a.action);
  const rejectsWith = (promise, status, code) => assert.rejects(promise, (err) => {
    assert.equal(err.statusCode, status, err.message);
    if (code) assert.equal(err.code, code);
    return true;
  });
  const studentGet = async (student) => (await api(student, 'GET', `/assignments/${assignment.id}`)).body.data;

  await t.test('saving a scheme sets the assignment\'s marks, versions the scheme, and blocks diverging edits', async () => {
    const saved = await service.saveRubric(assignment.id, RUBRIC, owner.id);
    assert.equal(saved.version, 1);
    assert.equal(saved.marksChangedFrom, 10);
    assert.equal((await prisma.assignment.findUnique({ where: { id: assignment.id } })).marks, 4);
    assert.equal((await service.saveRubric(assignment.id, RUBRIC, owner.id)).version, 2);

    await rejectsWith(assignmentService.updateAssignment(assignment.id, { marks: 5 }), 409, 'MARKS_FROM_RUBRIC');
    await rejectsWith(assignmentService.updateAssignment(assignment.id, { marks: null }), 409, 'MARKS_FROM_RUBRIC');
    await assignmentService.updateAssignment(assignment.id, { marks: 4, title: 'Photosynthesis' });

    const http400 = await api(owner, 'PUT', `/assignments/${assignment.id}/rubric`, { ...RUBRIC, maxMarks: 3.5 });
    assert.equal(http400.status, 400);
    const httpAuto = await api(owner, 'PUT', `/assignments/${assignment.id}/rubric`, { ...RUBRIC, autoPublish: true });
    assert.equal(httpAuto.status, 400);
    const httpBadTotal = await api(owner, 'PUT', `/assignments/${assignment.id}/rubric`, { ...RUBRIC, maxMarks: 5 });
    assert.equal(httpBadTotal.status, 400, 'criteria (4) must add up to the total');
  });

  await t.test('a submission is queued durably and evaluated into an unpublished proposal', async () => {
    await submit(asha, { textAnswer: CORRECT });
    const sub = await submissionOf(asha);
    const job = await prisma.assignmentEvaluationJob.findUnique({ where: { submissionId: sub.id } });
    assert.equal(job.status, 'QUEUED', 'the job is stored before the student gets a response');

    await queue.drain();
    const proposal = await current(sub.id);
    assert.equal(proposal.source, 'AUTO');
    assert.equal(proposal.isPublished, false);
    assert.equal(proposal.marksAwarded, 4);
    assert.equal(proposal.rubricVersion, 2);
    assert.equal(proposal.submissionSubmittedAt.getTime(), sub.submittedAt.getTime());
    assert.equal((await submissionOf(asha)).grade, null, 'automated marks are never published by themselves');
    assert.equal((await prisma.assignmentEvaluationJob.findUnique({ where: { submissionId: sub.id } })).status, 'DONE');
    assert.equal((await service.getEvaluation(assignment.id, sub.id)).status, 'ready');
    assert.deepEqual(await actions(sub.id), ['SUBMITTED', 'EVALUATED']);
  });

  await t.test('the same submission and scheme version reproduce the same result', async () => {
    const sub = await submissionOf(asha);
    const proposal = await current(sub.id);
    const groups = await prisma.evaluationSynonymGroup.findMany({ orderBy: { createdAt: 'asc' } });
    const again = await createEvaluatorRegistry().get().evaluateAnswer({
      question: proposal.inputMeta.rubric.question,
      answerText: proposal.inputText,
      dictionary: new SynonymDictionary(groups.map((g) => g.terms)),
    });
    assert.equal(again.marksAwarded, proposal.marksAwarded);
    assert.deepEqual(again.criteria.map((c) => c.awarded), proposal.result.criteria.map((c) => c.awarded));
  });

  await t.test('a student never sees unpublished marks, and cannot reach evaluation endpoints', async () => {
    const view = await studentGet(asha);
    assert.equal(view.grade, null);
    assert.equal(view.evaluation, null);
    const sub = await submissionOf(asha);
    for (const [method, url, body] of [
      ['GET', `/assignments/${assignment.id}/submissions/${sub.id}/evaluation`],
      ['GET', `/assignments/${assignment.id}/rubric`],
      ['POST', `/assignments/${assignment.id}/submissions/${sub.id}/evaluation/accept`, { expectedVersion: 1 }],
      ['POST', `/assignments/${assignment.id}/submissions/${sub.id}/evaluation/override`, { expectedVersion: 1, marksAwarded: 4, reason: 'Trying it' }],
      ['POST', `/assignments/${assignment.id}/submissions/${sub.id}/evaluation/re-evaluate`, {}],
      ['POST', `/assignments/${assignment.id}/evaluate-all`],
    ]) {
      assert.equal((await api(asha, method, url, body)).status, 403, `${method} ${url}`);
    }
    assert.equal((await api(asha, 'GET', `/assignments/${assignment.id}/submissions`)).status, 403);
  });

  await t.test('only the owning instructor or an admin can review, and only this assignment\'s submissions', async () => {
    const sub = await submissionOf(asha);
    const url = `/assignments/${assignment.id}/submissions/${sub.id}/evaluation`;
    assert.equal((await api(otherInstructor, 'GET', url)).status, 403);
    assert.equal((await api(otherInstructor, 'POST', `${url}/accept`, { expectedVersion: 1 })).status, 403);
    assert.equal((await api(owner, 'GET', url)).status, 200);
    assert.equal((await api(admin, 'GET', url)).status, 200);
    // IDOR: the owner of another assignment cannot reach this submission through it.
    const viaOther = await api(otherInstructor, 'GET', `/assignments/${otherAssignment.id}/submissions/${sub.id}/evaluation`);
    assert.equal(viaOther.status, 404);
    // Missing version: refused by validation before anything happens.
    assert.equal((await api(owner, 'POST', `${url}/accept`, {})).status, 400);
  });

  await t.test('duplicate requests collapse into one job and one new result', async () => {
    await submit(ravi, { textAnswer: PARTIAL });
    await queue.drain();
    const sub = await submissionOf(ravi);
    const before = await versions(sub.id);
    await Promise.all(Array.from({ length: 5 }, () => service.reEvaluate(assignment.id, sub.id, owner.id, {})));
    assert.equal(await prisma.assignmentEvaluationJob.count({ where: { submissionId: sub.id } }), 1);
    await queue.drain();
    assert.equal(await versions(sub.id), before + 1);
  });

  await t.test('a request that arrives while the job runs makes it run once more', async () => {
    const sub = await submissionOf(ravi);
    await service.reEvaluate(assignment.id, sub.id, owner.id, {});
    const job = await queue.claimNext();
    assert.equal(job.submissionId, sub.id);
    await service.reEvaluate(assignment.id, sub.id, owner.id, {});
    const mid = await prisma.assignmentEvaluationJob.findUnique({ where: { submissionId: sub.id } });
    assert.equal(mid.status, 'PROCESSING');
    assert.equal(mid.rerun, true);
    await queue.processJob(job);
    assert.equal((await prisma.assignmentEvaluationJob.findUnique({ where: { submissionId: sub.id } })).status, 'QUEUED');
    await queue.drain();
    assert.equal((await prisma.assignmentEvaluationJob.findUnique({ where: { submissionId: sub.id } })).status, 'DONE');
  });

  /** Runs `change` after the evaluation has read its inputs, before it commits. */
  const evaluateWhile = async (submissionId, change) => {
    const delegate = prisma.evaluationSynonymGroup;
    const original = delegate.findMany;
    delegate.findMany = async (...args) => {
      delegate.findMany = original;
      await change();
      return original.apply(delegate, args);
    };
    try {
      return await service.evaluateSubmission(submissionId);
    } finally {
      delegate.findMany = original;
    }
  };

  await t.test('a result is discarded when the student resubmits while it runs', async () => {
    const sub = await submissionOf(ravi);
    const before = await versions(sub.id);
    const outcome = await evaluateWhile(sub.id, () => prisma.assignmentSubmission.update({
      where: { id: sub.id }, data: { submittedAt: new Date(Date.now() + 1000) },
    }));
    assert.equal(outcome.outcome, 'stale');
    assert.equal(await versions(sub.id), before);
    assert.ok((await actions(sub.id)).includes('STALE_RESULT_DISCARDED'));
  });

  await t.test('a result is discarded when the marking scheme changes while it runs', async () => {
    const sub = await submissionOf(ravi);
    const before = await versions(sub.id);
    const outcome = await evaluateWhile(sub.id, () => prisma.assignmentRubric.update({
      where: { assignmentId: assignment.id }, data: { version: { increment: 1 } },
    }));
    assert.equal(outcome.outcome, 'stale');
    assert.equal(await versions(sub.id), before);
    // The current proposal is from an older scheme version now: it cannot be approved.
    const latest = await current(sub.id);
    assert.equal((await service.getEvaluation(assignment.id, sub.id)).status, 'outdated');
    await rejectsWith(service.accept(assignment.id, sub.id, owner.id, { expectedVersion: latest.version }), 409, 'OUTDATED');
    // Saving the scheme queues ungraded work again; the new proposal is approvable.
    const saved = await service.saveRubric(assignment.id, RUBRIC, owner.id);
    assert.ok(saved.requeued >= 1);
    await queue.drain();
    assert.equal((await current(sub.id)).rubricVersion, saved.version);
  });

  await t.test('jobs orphaned by a restart are recovered', async () => {
    const sub = await submissionOf(ravi);
    const before = await versions(sub.id);
    // A job a crashed process was running 20 minutes ago.
    await prisma.$executeRaw`
      UPDATE "AssignmentEvaluationJob" SET "status" = 'PROCESSING', "attempts" = 1,
        "lockedAt" = now() - interval '20 minutes' WHERE "submissionId" = ${sub.id}`;
    await queue.drain();
    assert.equal((await prisma.assignmentEvaluationJob.findUnique({ where: { submissionId: sub.id } })).status, 'DONE');
    assert.equal(await versions(sub.id), before + 1);

    // A job queued just before a restart (no worker ran it yet).
    await prisma.$executeRaw`UPDATE "AssignmentEvaluationJob" SET "status" = 'QUEUED', "attempts" = 0 WHERE "submissionId" = ${sub.id}`;
    await queue.drain();
    assert.equal(await versions(sub.id), before + 2);
  });

  await t.test('transient failures are retried, then recorded as failed without publishing anything', async () => {
    const sub = await submissionOf(ravi);
    const realRunner = { run: (job) => service.evaluateSubmission(job.submissionId, { job }), onFailed: service.recordJobFailure };
    let calls = 0;
    queue.setRunner({ run: async () => { calls += 1; throw new Error('database connection lost'); }, onFailed: service.recordJobFailure });
    try {
      await service.reEvaluate(assignment.id, sub.id, owner.id, {});
      for (let attempt = 1; attempt <= queue.MAX_ATTEMPTS; attempt += 1) {
        await queue.drain();
        const job = await prisma.assignmentEvaluationJob.findUnique({ where: { submissionId: sub.id } });
        if (attempt < queue.MAX_ATTEMPTS) {
          assert.equal(job.status, 'QUEUED', `attempt ${attempt} is retried`);
          assert.match(job.lastError, /connection lost/);
          await prisma.$executeRaw`UPDATE "AssignmentEvaluationJob" SET "runAfter" = now() WHERE "id" = ${job.id}`;
        } else {
          assert.equal(job.status, 'FAILED');
        }
      }
      assert.equal(calls, queue.MAX_ATTEMPTS);
      const failed = await current(sub.id);
      assert.equal(failed.result.failed, true);
      assert.equal((await service.getEvaluation(assignment.id, sub.id)).status, 'failed');
      assert.equal((await submissionOf(ravi)).grade, null);
      await rejectsWith(service.accept(assignment.id, sub.id, owner.id, { expectedVersion: failed.version }), 409, 'EVALUATION_FAILED');
    } finally {
      queue.setRunner(realRunner);
    }
    await service.reEvaluate(assignment.id, sub.id, owner.id, {});
    await queue.drain();
    assert.equal((await current(sub.id)).result.failed, undefined);
  });

  await t.test('approval publishes the reviewed proposal; replays and stale views are refused', async () => {
    const sub = await submissionOf(asha);
    const proposal = await current(sub.id);
    await rejectsWith(service.accept(assignment.id, sub.id, owner.id, { expectedVersion: proposal.version - 1 }), 409, 'VERSION_CONFLICT');

    const res = await api(owner, 'POST', `/assignments/${assignment.id}/submissions/${sub.id}/evaluation/accept`,
      { expectedVersion: proposal.version, comment: 'Clear answer' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'published');

    const graded = await submissionOf(asha);
    assert.equal(graded.grade, '4/4');
    assert.equal(graded.status, 'Graded');
    const published = await prisma.assignmentEvaluation.findMany({ where: { submissionId: sub.id, isPublished: true } });
    assert.equal(published.length, 1);
    assert.equal(published[0].source, 'INSTRUCTOR');
    assert.equal(published[0].createdById, owner.id, "the publisher is recorded");

    const replay = await api(owner, 'POST', `/assignments/${assignment.id}/submissions/${sub.id}/evaluation/accept`,
      { expectedVersion: proposal.version });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.code, 'VERSION_CONFLICT');
    assert.ok((await actions(sub.id)).includes('APPROVED'));
  });

  await t.test('after approval the student sees exactly the approved result, without internal notes', async () => {
    const view = await studentGet(asha);
    assert.equal(view.grade, '4/4');
    assert.equal(view.evaluation.marksAwarded, 4);
    assert.equal(view.evaluation.maxMarks, 4);
    assert.equal(view.evaluation.markedBy, 'instructor');
    assert.equal(view.evaluation.instructorComment, 'Clear answer');
    assert.equal(view.evaluation.criteria.reduce((s, c) => s + c.awarded, 0), 4);
    const raw = JSON.stringify(view.evaluation);
    for (const internal of ['reviewReasons', 'overrideReason', 'inputText', 'inputMeta', 'confidence', 'idealAnswer', 'keywordCoverage', 'similarity']) {
      assert.equal(raw.includes(internal), false, `${internal} must not reach the student`);
    }
    // Per point: only what the student needs, never the evaluator's evidence.
    for (const c of view.evaluation.criteria) {
      assert.deepEqual(Object.keys(c).sort(), ['awarded', 'description', 'maxMarks', 'status']);
    }
    // Another student never sees this result.
    const other = await studentGet(meera);
    assert.equal(other.grade, null);
    assert.equal(other.evaluation, null);
    assert.equal(other.submission, null);
  });

  await t.test('automatic re-evaluation never touches a graded submission; reopening is explicit', async () => {
    const sub = await submissionOf(asha);
    const before = await versions(sub.id);
    await rejectsWith(service.reEvaluate(assignment.id, sub.id, owner.id, {}), 409, 'FINALIZED');
    const all = await service.evaluateAll(assignment.id, owner.id);
    assert.ok(all.skippedGraded >= 1);
    await queue.drain();
    assert.equal(await versions(sub.id), before, 'evaluate-all skipped the graded submission');

    // A stray automatic job (e.g. queued before the approval) is skipped too.
    await queue.enqueue(prisma, sub.id, { reason: 'EVALUATE_ALL' });
    await queue.drain();
    assert.equal(await versions(sub.id), before);

    // Explicit reopen: a new proposal; the student keeps the published grade.
    await service.reEvaluate(assignment.id, sub.id, owner.id, { reopen: true });
    await queue.drain();
    const reopened = await service.getEvaluation(assignment.id, sub.id);
    assert.equal(reopened.current.source, 'AUTO');
    assert.equal(reopened.current.isPublished, false);
    assert.equal(reopened.published.marksAwarded, 4);
    assert.ok(['ready', 'needs-review'].includes(reopened.status));
    assert.equal((await submissionOf(asha)).grade, '4/4');
    assert.equal((await studentGet(asha)).evaluation.marksAwarded, 4);
    assert.ok((await actions(sub.id)).includes('REOPENED'));

    await service.accept(assignment.id, sub.id, owner.id, { expectedVersion: reopened.current.version });
    assert.equal(await prisma.assignmentEvaluation.count({ where: { submissionId: sub.id, isPublished: true } }), 1);
  });

  await t.test('overrides are validated and keep breakdown, total and feedback consistent', async () => {
    await submit(meera, { textAnswer: PARTIAL });
    await queue.drain();
    const sub = await submissionOf(meera);
    const proposal = await current(sub.id);
    const [c1, c2] = proposal.result.criteria;
    const o = (body) => service.override(assignment.id, sub.id, owner.id, { expectedVersion: proposal.version, reason: 'Checked by hand', ...body });

    await rejectsWith(o({ criteria: [{ criterionId: c1.criterionId, awarded: 2.5 }] }), 400);
    await rejectsWith(o({ criteria: [{ criterionId: c1.criterionId, awarded: 0.3 }] }), 400);
    await rejectsWith(o({ criteria: [{ criterionId: 'not-a-criterion', awarded: 1 }] }), 400);
    await rejectsWith(o({ marksAwarded: 4.5 }), 400);
    await rejectsWith(o({ marksAwarded: 1.25 }), 400);
    assert.equal(await versions(sub.id), proposal.version, 'rejected overrides write nothing');

    const result = await o({ criteria: [{ criterionId: c2.criterionId, awarded: 1 }], comment: 'Oxygen was implied' });
    assert.equal(result.status, 'published');
    const view = await studentGet(meera);
    const sum = view.evaluation.criteria.reduce((s, c) => s + c.awarded, 0);
    assert.equal(view.evaluation.marksAwarded, sum);
    assert.equal(view.grade, `${sum}/4`);
    assert.match(view.evaluation.feedback.summary, new RegExp(`${sum}/4`));
    assert.ok((await actions(sub.id)).includes('OVERRIDDEN'));

    // A total alone publishes no point-by-point breakdown that would not add up.
    const latest = await current(sub.id);
    await service.override(assignment.id, sub.id, owner.id, { expectedVersion: latest.version, marksAwarded: 3.5, reason: 'Second look' });
    const totalView = await studentGet(meera);
    assert.equal(totalView.grade, '3.5/4');
    assert.deepEqual(totalView.evaluation.criteria, []);
  });

  await t.test('concurrent decisions on the same version: exactly one wins', async () => {
    const sub = await submissionOf(ravi);
    await prisma.assignmentSubmission.update({ where: { id: sub.id }, data: { grade: null, status: 'Submitted' } });
    await service.reEvaluate(assignment.id, sub.id, owner.id, {});
    await queue.drain();
    const proposal = await current(sub.id);

    const settled = await Promise.allSettled([
      service.accept(assignment.id, sub.id, owner.id, { expectedVersion: proposal.version }),
      service.override(assignment.id, sub.id, owner.id, { expectedVersion: proposal.version, marksAwarded: 1, reason: 'Concurrent' }),
      service.accept(assignment.id, sub.id, admin.id, { expectedVersion: proposal.version }),
    ]);
    assert.equal(settled.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of settled.filter((x) => x.status === 'rejected')) assert.equal(r.reason.statusCode, 409);
    assert.equal(await prisma.assignmentEvaluation.count({ where: { submissionId: sub.id, isPublished: true } }), 1);

    // Approval racing a re-evaluation. Either the approval wins (the queued
    // job, if any, then finds a graded submission and leaves it alone), or the
    // job was queued first and the approval is refused while it runs. Never
    // an approved grade replaced by a later automated result.
    await prisma.assignmentSubmission.update({ where: { id: sub.id }, data: { grade: null, status: 'Submitted' } });
    await prisma.assignmentEvaluation.updateMany({ where: { submissionId: sub.id }, data: { isPublished: false } });
    await service.reEvaluate(assignment.id, sub.id, owner.id, {});
    await queue.drain();
    const next = await current(sub.id);
    const race = await Promise.allSettled([
      service.accept(assignment.id, sub.id, owner.id, { expectedVersion: next.version }),
      service.reEvaluate(assignment.id, sub.id, owner.id, {}),
    ]);
    const [approval, reevaluation] = race;
    assert.ok(approval.status === 'fulfilled' || reevaluation.status === 'fulfilled');
    if (approval.status === 'rejected') assert.equal(approval.reason.code, 'EVALUATION_RUNNING');
    if (reevaluation.status === 'rejected') assert.equal(reevaluation.reason.code, 'FINALIZED');
    await queue.drain();
    const after = await submissionOf(ravi);
    const publishedRows = await prisma.assignmentEvaluation.findMany({ where: { submissionId: sub.id, isPublished: true } });
    if (approval.status === 'fulfilled') {
      assert.equal(publishedRows.length, 1);
      assert.equal(after.grade, `${publishedRows[0].marksAwarded}/4`);
      const latest = await current(sub.id);
      assert.equal(latest.id, publishedRows[0].id, 'no automated result became current over the approval');
    } else {
      assert.equal(publishedRows.length, 0);
      assert.equal(after.grade, null);
    }
  });

  await t.test('a hand grade replaces the published evaluation for the student', async () => {
    const sub = await submissionOf(asha);
    await assignmentService.gradeAssignmentSubmission(assignment.id, sub.id, { grade: 'A', feedback: 'Excellent' }, owner.id);
    const view = await studentGet(asha);
    assert.equal(view.grade, 'A');
    assert.equal(view.evaluation, null);
    assert.equal(await prisma.assignmentEvaluation.count({ where: { submissionId: sub.id, isPublished: true } }), 0);
    assert.equal((await service.getEvaluation(assignment.id, sub.id)).status, 'graded-by-hand');
    assert.ok((await actions(sub.id)).includes('HAND_GRADED'));
  });

  await t.test('a resubmission unpublishes old results and is evaluated again', async () => {
    await submit(asha, { textAnswer: PARTIAL });
    const sub = await submissionOf(asha);
    assert.equal(sub.grade, null);
    assert.equal((await prisma.assignmentEvaluationJob.findUnique({ where: { submissionId: sub.id } })).status, 'QUEUED');
    await queue.drain();
    const proposal = await current(sub.id);
    assert.equal(proposal.submissionSubmittedAt.getTime(), sub.submittedAt.getTime());
    assert.equal((await studentGet(asha)).evaluation, null);
    const history = (await service.getEvaluation(assignment.id, sub.id)).history;
    assert.ok(history.length >= 4, 'earlier versions stay in the history');
  });

  await t.test('PDF answers: typed PDF is read; unreadable and untrusted files go to review', async () => {
    const dir = path.join(__dirname, '../../../../uploads/attachments');
    fs.mkdirSync(dir, { recursive: true });
    const good = path.join(dir, `${tag}-answer.pdf`);
    const broken = path.join(dir, `${tag}-broken.pdf`);
    fs.writeFileSync(good, await typedPdf([['Chlorophyll absorbs light energy.', 'The plant releases oxygen.']]));
    fs.writeFileSync(broken, Buffer.from('%PDF-1.4 this is not really a pdf'));
    created.files.push(good, broken);
    const pdfStudent = await makeUser('STUDENT', 'pdf');
    const urlFor = (file) => `http://localhost:5000/uploads/attachments/${path.basename(file)}`;

    await submit(pdfStudent, { fileUrl: urlFor(good), fileName: 'answer.pdf', fileType: 'application/pdf' });
    await queue.drain();
    const fromPdf = await current((await submissionOf(pdfStudent)).id);
    assert.equal(fromPdf.inputMeta.pdf.method, 'TEXT');
    assert.equal(fromPdf.marksAwarded, 4);

    await submit(pdfStudent, { fileUrl: urlFor(broken), fileName: 'broken.pdf' });
    await queue.drain();
    const unreadable = await current((await submissionOf(pdfStudent)).id);
    assert.equal(unreadable.needsReview, true);
    assert.ok(unreadable.reviewReasons.some((r) => /could not be read/.test(r)));
    assert.ok(unreadable.confidence <= 0.5);

    await submit(pdfStudent, { fileUrl: 'https://attacker.example/steal.pdf', fileName: 'steal.pdf', textAnswer: PARTIAL });
    await queue.drain();
    const untrusted = await current((await submissionOf(pdfStudent)).id);
    assert.ok(untrusted.reviewReasons.some((r) => /not stored in this LMS's file storage/.test(r)));
    assert.match(untrusted.inputText, /Chlorophyll absorbs light/);
  });

  await t.test('a shared synonym group is removed only by its author or an admin', async () => {
    const group = await service.addSynonymGroup({ terms: [`alpha${tag}`, `beta${tag}`] }, owner.id);
    created.synonymGroups.push(group.id);
    const byOther = await api(otherInstructor, 'DELETE', `/assignment-evaluation/synonyms/${group.id}`);
    assert.equal(byOther.status, 403);
    const byOwner = await api(owner, 'DELETE', `/assignment-evaluation/synonyms/${group.id}`);
    assert.equal(byOwner.status, 200);
    const second = await service.addSynonymGroup({ terms: [`gamma${tag}`, `delta${tag}`] }, owner.id);
    created.synonymGroups.push(second.id);
    assert.equal((await api(admin, 'DELETE', `/assignment-evaluation/synonyms/${second.id}`)).status, 200);
  });

  await t.test('an instructor and their students can be deleted together (cascades through evaluations)', async () => {
    // Background: an earlier draft had a second ON DELETE SET NULL key to
    // "User" on AssignmentEvaluation (publishedById). On some data that made
    // this kind of delete fail with an FK violation; whether it fails depends
    // on physical row order, so this test cannot reproduce it reliably. It
    // checks that the delete works with the schema as it is.
    const teacher = await makeUser('INSTRUCTOR', 'leaver');
    const pupil = await makeUser('STUDENT', 'pupil');
    const pupil2 = await makeUser('STUDENT', 'pupil2');
    const c = await prisma.course.create({ data: { title: `Leaver ${tag}`, creatorId: teacher.id } });
    const a = await prisma.assignment.create({ data: { title: 'Leaver assignment', courseId: c.id, marks: 4, isPublished: true } });
    await service.saveRubric(a.id, RUBRIC, teacher.id);
    await assignmentService.submitAssignment(a.id, pupil.profile.id, { textAnswer: CORRECT });
    await assignmentService.submitAssignment(a.id, pupil2.profile.id, { textAnswer: PARTIAL });
    await queue.drain();
    // The shape that failed: an approved version that is no longer current
    // (reopened and re-evaluated), and an overridden one.
    const sub = await submissionOf(pupil, a);
    await service.accept(a.id, sub.id, teacher.id, { expectedVersion: (await current(sub.id)).version });
    await service.reEvaluate(a.id, sub.id, teacher.id, { reopen: true });
    await queue.drain();
    const sub2 = await submissionOf(pupil2, a);
    await service.override(a.id, sub2.id, teacher.id, { expectedVersion: (await current(sub2.id)).version, marksAwarded: 3, reason: 'Second point implied' });
    assert.equal(await prisma.assignmentEvaluation.count({ where: { submission: { assignmentId: a.id }, createdById: teacher.id } }), 2);

    // Instructor and students in one statement: each published version is
    // reached through the course cascade, the student cascade and createdById.
    await prisma.user.deleteMany({ where: { id: { in: [teacher.id, pupil.id, pupil2.id] } } });
    assert.equal(await prisma.assignmentSubmission.count({ where: { assignmentId: a.id } }), 0, 'the course and its submissions cascade');
    assert.equal(await prisma.assignmentEvaluation.count({ where: { submissionId: { in: [sub.id, sub2.id] } } }), 0);
  });

  await t.test('the instructor submissions table carries evaluation status, not draft marks for students', async () => {
    const res = await api(owner, 'GET', `/assignments/${assignment.id}/submissions`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.assignment.autoEvaluation.enabled, true);
    const statuses = res.body.data.submissions.map((s) => s.evaluation && s.evaluation.status);
    assert.ok(statuses.every((s) => typeof s === 'string'), JSON.stringify(statuses));
    assert.equal('autoPublish' in res.body.data.assignment.autoEvaluation, false);
  });
});
