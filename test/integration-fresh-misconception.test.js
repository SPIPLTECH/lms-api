const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/database");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const { MISCONCEPTION_CONFIG } = require("../src/modules/learner-model/misconception.config");

test("Clean Integration Test: Single Incorrect Evidence on Fresh & Closed States", async (t) => {
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

  await t.test("SCENARIO 1: Fresh State (No Prior Misconception)", async () => {
    if (!studentProfile) return;

    const freshKc = `pointers_memory_fresh_${Date.now()}`;
    const hypothesis = `pointer_value_confusion_fresh_${Date.now()}`;

    // Verify initial state: no gap exists
    const initialGap = await prisma.knowledgeGap.findFirst({
      where: { studentId: studentProfile.id, concept: hypothesis },
    });

    const initialSeverity = initialGap ? initialGap.severity : 0.0;
    const initialStatus = initialGap ? initialGap.status : "NONE (No Record)";

    console.log("\n--- SCENARIO 1: Fresh State (No Prior Record) ---");
    console.log(`Initial Severity: ${initialSeverity}`);
    console.log(`Initial Status:   ${initialStatus}`);
    assert.equal(initialGap, null, "No KnowledgeGap record should exist initially");

    // Submit ONE incorrect response
    const res = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: freshKc,
        score: 0.20,
        isCorrect: false,
        hintsUsed: 2,
        responseTimeMs: 12000,
        misconceptionHypothesis: hypothesis,
      },
    });

    const finalSeverity = res.recordedMisconception ? res.recordedMisconception.severity : 0.0;
    const finalStatus = res.recordedMisconception ? res.recordedMisconception.status : "NONE";
    const delta = Number((finalSeverity - initialSeverity).toFixed(4));

    console.log(`Calculated Contribution (delta): +${delta}`);
    console.log(`Final Severity: ${finalSeverity}`);
    console.log(`Final Status:   ${finalStatus}`);
    console.log(`OPEN_THRESHOLD: ${MISCONCEPTION_CONFIG.OPEN_THRESHOLD}`);

    // Assertions:
    assert.ok(finalSeverity < MISCONCEPTION_CONFIG.OPEN_THRESHOLD, `Severity ${finalSeverity} should be < ${MISCONCEPTION_CONFIG.OPEN_THRESHOLD}`);
    assert.equal(finalStatus, "CLOSED", "Status should be CLOSED (weak evidence)");
    console.log("PASSED: Single incorrect response on fresh state remained weak evidence (< 0.35, status: CLOSED).\n");
  });

  await t.test("SCENARIO 2: Prior CLOSED Misconception (severity < 0.25)", async () => {
    if (!studentProfile) return;

    const closedKc = `pointers_memory_closed_${Date.now()}`;
    const hypothesis = `pointer_value_confusion_closed_${Date.now()}`;

    // 1. Setup a gap and resolve it to CLOSED with severity < 0.25
    await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: closedKc, score: 0.1, isCorrect: false, hintsUsed: 2, misconceptionHypothesis: hypothesis } });
    await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: closedKc, score: 0.1, isCorrect: false, hintsUsed: 2, misconceptionHypothesis: hypothesis } });

    // 3 clean successes to close it
    await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: closedKc, score: 1.0, isCorrect: true, hintsUsed: 0, misconceptionHypothesis: hypothesis } });
    await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: closedKc, score: 1.0, isCorrect: true, hintsUsed: 0, misconceptionHypothesis: hypothesis } });
    const closedSetupRes = await learnerModelService.recordEvidence({ callingUser, data: { studentId: studentProfile.id, kc: closedKc, score: 1.0, isCorrect: true, hintsUsed: 0, misconceptionHypothesis: hypothesis } });

    const initialSeverity = closedSetupRes.recordedMisconception.severity; // 0.0
    const initialStatus = closedSetupRes.recordedMisconception.status;     // CLOSED

    console.log("--- SCENARIO 2: Prior CLOSED Misconception ---");
    console.log(`Initial Severity: ${initialSeverity}`);
    console.log(`Initial Status:   ${initialStatus}`);
    assert.ok(initialSeverity < 0.25, "Initial severity must be < 0.25");
    assert.equal(initialStatus, "CLOSED", "Initial status must be CLOSED");

    // 2. Submit ONE incorrect response
    const singleErrRes = await learnerModelService.recordEvidence({
      callingUser,
      data: {
        studentId: studentProfile.id,
        kc: closedKc,
        score: 0.20,
        isCorrect: false,
        hintsUsed: 2,
        responseTimeMs: 12000,
        misconceptionHypothesis: hypothesis,
      },
    });

    const finalSeverity = singleErrRes.recordedMisconception.severity;
    const finalStatus = singleErrRes.recordedMisconception.status;
    const delta = Number((finalSeverity - initialSeverity).toFixed(4));

    console.log(`Calculated Contribution (delta): +${delta}`);
    console.log(`Final Severity: ${finalSeverity}`);
    console.log(`Final Status:   ${finalStatus}`);
    console.log(`OPEN_THRESHOLD: ${MISCONCEPTION_CONFIG.OPEN_THRESHOLD}`);

    // Assertions:
    assert.ok(finalSeverity < MISCONCEPTION_CONFIG.OPEN_THRESHOLD, `Severity ${finalSeverity} should be < ${MISCONCEPTION_CONFIG.OPEN_THRESHOLD}`);
    assert.equal(finalStatus, "CLOSED", "Status should be CLOSED");
    console.log("PASSED: Single incorrect response on CLOSED state remained weak evidence (< 0.35, status: CLOSED).\n");
  });
});
