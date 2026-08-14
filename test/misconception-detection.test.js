const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = require("../src/config/database");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const { MISCONCEPTION_CONFIG } = require("../src/modules/learner-model/misconception.config");

test("Misconception Detection Engine Test Suite", async (t) => {
  let studentProfile;
  let callingUser;

  t.before(async () => {
    studentProfile = await prisma.studentProfile.findFirst({
      include: { user: true },
    });
    if (studentProfile) {
      callingUser = { id: studentProfile.userId, role: "STUDENT" };
    }
  });

  await t.test("TEST 1: Single incorrect response after CLOSED misconception is weak evidence (not immediately OPEN)", async () => {
    if (!studentProfile) return;

    const testKc = `test_kc_closed_single_err_${Date.now()}`;
    const hypothesis = `closed_hypothesis_${Date.now()}`;

    // 1. Establish an OPEN misconception with repeated errors
    await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: testKc, score: 0.1, isCorrect: false, hintsUsed: 2, misconceptionHypothesis: hypothesis } });
    await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: testKc, score: 0.1, isCorrect: false, hintsUsed: 2, misconceptionHypothesis: hypothesis } });

    // 2. Recover with 3 clean correct answers until CLOSED
    await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: testKc, score: 1.0, isCorrect: true, hintsUsed: 0, misconceptionHypothesis: hypothesis } });
    await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: testKc, score: 1.0, isCorrect: true, hintsUsed: 0, misconceptionHypothesis: hypothesis } });
    const closedRes = await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: testKc, score: 1.0, isCorrect: true, hintsUsed: 0, misconceptionHypothesis: hypothesis } });

    assert.equal(closedRes.recordedMisconception.status, "CLOSED");

    // 3. Submit ONE single incorrect response
    const singleErrRes = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: testKc,
        score: 0.20,
        isCorrect: false,
        hintsUsed: 2,
        responseTimeMs: 12000,
        misconceptionHypothesis: hypothesis,
      },
    });

    // Expect weak evidence: severity increases slightly (e.g. 0.05 -> 0.22), but status remains CLOSED (< 0.35)
    assert.ok(singleErrRes.recordedMisconception !== null);
    assert.ok(singleErrRes.recordedMisconception.severity < MISCONCEPTION_CONFIG.OPEN_THRESHOLD);
    assert.equal(singleErrRes.recordedMisconception.status, "CLOSED");
  });

  await t.test("TEST 2 & 3: Two repeated incorrect responses accumulate stronger evidence and eventually open gap", async () => {
    if (!studentProfile) return;

    const testKc = `test_kc_accumulation_${Date.now()}`;
    const hypothesis = `accumulation_hypothesis_${Date.now()}`;

    // Attempt 1: Single mistake (weak evidence, severity ~0.17 < 0.35, status: CLOSED)
    const res1 = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: testKc,
        score: 0.2,
        isCorrect: false,
        hintsUsed: 2,
        misconceptionHypothesis: hypothesis,
      },
    });

    assert.ok(res1.recordedMisconception !== null);
    assert.equal(res1.recordedMisconception.status, "CLOSED");
    assert.ok(res1.recordedMisconception.severity < MISCONCEPTION_CONFIG.OPEN_THRESHOLD);

    // Attempt 2: 2nd consecutive error (evidence accumulates: ~0.17 + 0.32 = 0.49 >= 0.35 -> OPEN)
    const res2 = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: testKc,
        score: 0.15,
        isCorrect: false,
        hintsUsed: 2,
        misconceptionHypothesis: hypothesis,
      },
    });

    assert.ok(res2.recordedMisconception !== null);
    assert.equal(res2.recordedMisconception.status, "OPEN");
    assert.ok(res2.recordedMisconception.severity >= MISCONCEPTION_CONFIG.OPEN_THRESHOLD);

    // Attempt 3: 3rd consecutive error (escalates to high confidence ~0.95)
    const res3 = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: testKc,
        score: 0.1,
        isCorrect: false,
        hintsUsed: 3,
        misconceptionHypothesis: hypothesis,
      },
    });

    assert.ok(res3.recordedMisconception.severity > res2.recordedMisconception.severity);
    assert.equal(res3.recordedMisconception.status, "OPEN");
  });

  await t.test("TEST 4 & 5: Strong correct response decreases probability; multiple clean successes eventually CLOSE gap", async () => {
    if (!studentProfile) return;

    const testKc = `test_kc_recovery_lifecycle_${Date.now()}`;
    const hypothesis = `lifecycle_hypothesis_${Date.now()}`;

    // Setup an OPEN gap with repeated errors
    await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: testKc, score: 0.1, isCorrect: false, hintsUsed: 2, misconceptionHypothesis: hypothesis } });
    const openRes = await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: testKc, score: 0.1, isCorrect: false, hintsUsed: 2, misconceptionHypothesis: hypothesis } });

    assert.equal(openRes.recordedMisconception.status, "OPEN");
    const openSeverity = openRes.recordedMisconception.severity;

    // 1. Single strong correct response reduces probability
    const rec1 = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: testKc,
        score: 0.95,
        isCorrect: true,
        hintsUsed: 0,
        misconceptionHypothesis: hypothesis,
      },
    });

    assert.ok(rec1.recordedMisconception.severity < openSeverity);

    // 2. Multiple strong correct responses systematically close gap
    const rec2 = await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: testKc, score: 0.95, isCorrect: true, hintsUsed: 0, misconceptionHypothesis: hypothesis } });
    const rec3 = await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: testKc, score: 0.95, isCorrect: true, hintsUsed: 0, misconceptionHypothesis: hypothesis } });

    assert.ok(rec3.recordedMisconception.severity <= rec2.recordedMisconception.severity);
    assert.equal(rec3.recordedMisconception.status, "CLOSED");
    assert.ok(rec3.recordedMisconception.closedAt !== null);
  });

  await t.test("TEST 6: Incorrect response without a misconception hypothesis does NOT create a specific misconception", async () => {
    if (!studentProfile) return;

    const testKc = `test_kc_no_hypothesis_${Date.now()}`;
    const res = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: testKc,
        score: 0.2,
        isCorrect: false,
        hintsUsed: 1,
        // misconceptionHypothesis omitted
      },
    });

    assert.equal(res.recordedMisconception, null);

    const gap = await prisma.knowledgeGap.findFirst({
      where: { studentId: studentProfile.id, concept: `${testKc}_misconception` },
    });
    assert.equal(gap, null);
  });

  await t.test("TEST 7: Incorrect response for KC A must not modify unrelated KC B", async () => {
    if (!studentProfile) return;

    const kcA = `test_kc_isolation_A_${Date.now()}`;
    const kcB = `test_kc_isolation_B_${Date.now()}`;
    const hypoA = `hypo_A_${Date.now()}`;
    const hypoB = `hypo_B_${Date.now()}`;

    await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: kcA,
        score: 0.1,
        isCorrect: false,
        hintsUsed: 2,
        misconceptionHypothesis: hypoA,
      },
    });

    const gapB = await prisma.knowledgeGap.findFirst({
      where: { studentId: studentProfile.id, concept: hypoB },
    });

    assert.equal(gapB, null);
  });

  await t.test("TEST 8: Misconception probability always remains bounded between 0 and 1", async () => {
    if (!studentProfile) return;

    const testKc = `test_kc_bounds_${Date.now()}`;
    const hypothesis = `bounds_hypothesis_${Date.now()}`;

    // Spam 10 incorrect attempts
    let lastRes;
    for (let i = 0; i < 10; i++) {
      lastRes = await learnerModelService.recordEvidence({
        callingUser,
        data: {
          studentId: studentProfile.id,
          kc: testKc,
          score: 0.0,
          isCorrect: false,
          hintsUsed: 3,
          misconceptionHypothesis: hypothesis,
        },
      });
    }

    assert.ok(lastRes.recordedMisconception.severity <= 1.0);
    assert.ok(lastRes.recordedMisconception.severity >= 0.0);
    assert.equal(lastRes.recordedMisconception.severity, MISCONCEPTION_CONFIG.MAX_PROBABILITY);

    // Spam 10 correct attempts
    for (let i = 0; i < 10; i++) {
      lastRes = await learnerModelService.recordEvidence({
        callingUser,
        data: {
          studentId: studentProfile.id,
          kc: testKc,
          score: 1.0,
          isCorrect: true,
          hintsUsed: 0,
          misconceptionHypothesis: hypothesis,
        },
      });
    }

    assert.ok(lastRes.recordedMisconception.severity >= 0.0);
    assert.ok(lastRes.recordedMisconception.severity <= 1.0);
    assert.equal(lastRes.recordedMisconception.severity, MISCONCEPTION_CONFIG.MIN_PROBABILITY);
  });

  await t.test("TEST 9 & 10: BKT and learner-model state tracking remain fully operational", async () => {
    if (!studentProfile) return;

    const testKc = `test_kc_bkt_operational_${Date.now()}`;
    const res = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: testKc,
        score: 0.9,
        isCorrect: true,
        hintsUsed: 0,
      },
    });

    assert.ok(res.bktUpdate !== undefined);
    assert.ok(res.updatedKCState.masteryProbability > 0.2);
    assert.equal(res.updatedKCState.attemptsCount, 1);
  });

  await t.test("Tier 2 Misconception Recovery Decay & Isolation Suite", async (t2) => {
    if (!studentProfile) return;

    const studentAId = studentProfile.id;
    const testKc = `test_kc_tier2_recovery_${Date.now()}`;
    const tier2Concept = `tier2_concept_${Date.now()}`;

    // 1. Create a Tier 2 KnowledgeGap with severity 0.95 and status OPEN for Student A
    const gap = await prisma.knowledgeGap.create({
      data: {
        studentId: studentAId,
        concept: tier2Concept,
        kc: testKc,
        type: tier2Concept,
        severity: 0.95,
        status: "OPEN",
        detectedAt: new Date(),
      },
    });

    // TEST 1: First clean correct answer (hypothesis is null) decays 0.95 -> 0.65, status remains OPEN
    const res1 = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentAId,
        kc: testKc,
        score: 1.0,
        isCorrect: true,
        hintsUsed: 0,
      },
    });

    assert.ok(res1.recordedMisconception !== null);
    assert.equal(res1.recordedMisconception.id, gap.id);
    assert.equal(res1.recordedMisconception.severity, 0.65);
    assert.equal(res1.recordedMisconception.status, "OPEN");

    // TEST 2: Second clean correct answer decays 0.65 -> 0.35, status remains OPEN
    const res2 = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentAId,
        kc: testKc,
        score: 1.0,
        isCorrect: true,
        hintsUsed: 0,
      },
    });

    assert.ok(res2.recordedMisconception !== null);
    assert.equal(res2.recordedMisconception.severity, 0.35);
    assert.equal(res2.recordedMisconception.status, "OPEN");

    // TEST 3: Third clean correct answer decays 0.35 -> 0.05, status becomes CLOSED and closedAt is set
    const res3 = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentAId,
        kc: testKc,
        score: 1.0,
        isCorrect: true,
        hintsUsed: 0,
      },
    });

    assert.ok(res3.recordedMisconception !== null);
    assert.equal(res3.recordedMisconception.severity, 0.05);
    assert.equal(res3.recordedMisconception.status, "CLOSED");
    assert.ok(res3.recordedMisconception.closedAt !== null);

    // TEST 4: No existing KnowledgeGap -> returns null, no new gap created
    const cleanKc = `test_kc_no_gap_${Date.now()}`;
    const resNoGap = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentAId,
        kc: cleanKc,
        score: 1.0,
        isCorrect: true,
        hintsUsed: 0,
      },
    });
    assert.equal(resNoGap.recordedMisconception, null);

    // TEST 5: Student Isolation — Student A's gap is never decayed by Student B's answer
    let studentBProfile = await prisma.studentProfile.findFirst({
      where: { id: { not: studentAId } },
    });

    if (!studentBProfile) {
      const dummyUser = await prisma.user.create({
        data: {
          name: "Student B Test",
          email: `studentB_${Date.now()}@test.com`,
          password: "password123",
          role: "STUDENT",
          isVerified: true,
        },
      });
      studentBProfile = await prisma.studentProfile.create({
        data: { userId: dummyUser.id },
      });
    }

    if (studentBProfile) {
      const studentBId = studentBProfile.id;
      const isoKc = `test_kc_isolation_${Date.now()}`;
      const isoConcept = `iso_concept_${Date.now()}`;

      // Student A has an OPEN gap
      const gapA = await prisma.knowledgeGap.create({
        data: {
          studentId: studentAId,
          concept: isoConcept,
          kc: isoKc,
          severity: 0.95,
          status: "OPEN",
          detectedAt: new Date(),
        },
      });

      // Student B submits a clean correct answer for the same KC
      const resStudentB = await learnerModelService.recordEvidence({
        callingUser: { id: studentBProfile.userId, role: "STUDENT" },
        data: {
          studentId: studentBId,
          kc: isoKc,
          score: 1.0,
          isCorrect: true,
          hintsUsed: 0,
        },
      });

      assert.equal(resStudentB.recordedMisconception, null);

      // Student A's gap remains untouched at 0.95 OPEN
      const gapACurrent = await prisma.knowledgeGap.findUnique({
        where: { id: gapA.id },
      });
      assert.equal(gapACurrent.severity, 0.95);
      assert.equal(gapACurrent.status, "OPEN");
    }
  });
});
