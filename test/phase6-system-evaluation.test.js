const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = require("../src/config/database");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const adaptiveLearningService = require("../src/modules/adaptive-learning/adaptiveLearning.service");
const llmService = require("../src/modules/llm/llm.service");
const { PEDAGOGICAL_STRATEGIES, DECISION_PRIORITY } = require("../src/modules/learner-model/decision.config");

test("Phase 6 — Assessment & Evaluation System Suite", async (t) => {
  // Helper to create an isolated student profile per test scenario
  const createIsolatedLearner = async (suffix) => {
    const user = await prisma.user.create({
      data: {
        name: `Phase6 Learner ${suffix}`,
        email: `phase6_${suffix}_${Date.now()}@test.com`,
        password: "hashedpassword123",
        role: "STUDENT",
      },
    });

    const profile = await prisma.studentProfile.create({
      data: {
        userId: user.id,
        education: "Computer Science",
      },
    });

    return {
      user,
      profile,
      callingUser: { id: user.id, role: "STUDENT" },
    };
  };

  // Helper to cleanup isolated student data
  const cleanupLearner = async (learner) => {
    if (!learner || !learner.profile) return;
    await prisma.conceptMastery.deleteMany({ where: { studentId: learner.profile.id } });
    await prisma.knowledgeGap.deleteMany({ where: { studentId: learner.profile.id } });
    await prisma.learningEvent.deleteMany({ where: { studentId: learner.profile.id } });
    await prisma.studentState.deleteMany({ where: { studentId: learner.profile.id } });
    await prisma.studentProfile.delete({ where: { id: learner.profile.id } });
    await prisma.user.delete({ where: { id: learner.user.id } });
  };

  await t.test("SCENARIO 1: Multi-Step Mastery Progression (WEAK -> DEVELOPING -> MASTERED)", async () => {
    const learner = await createIsolatedLearner("sc1");
    const testKc = `pointers_memory`; // Valid KC

    try {
      // 1. Initial State: Unassessed / Weak
      const initialDecision = await learnerModelService.getPedagogicalDecision({
        callingUser: learner.callingUser,
        data: { kc: testKc },
      });
      assert.equal(initialDecision.strategy, PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION);

      // 2. First Evidence Event: Correct response (BKT: 0.20 -> 0.60)
      const ev1 = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 0.9, hintsUsed: 0, responseTimeMs: 4500 },
      });
      assert.equal(ev1.bktUpdate.newMastery, 0.6);
      assert.equal(ev1.bktUpdate.status, "DEVELOPING");

      // 3. Second Evidence Event: Repeated correct response (BKT: 0.60 -> 0.898, confidence < 0.50 -> INDEPENDENT_PRACTICE)
      const ev2 = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 0.95, hintsUsed: 0, responseTimeMs: 3800 },
      });
      assert.equal(ev2.bktUpdate.status, "MASTERED");
      assert.ok(ev2.bktUpdate.newMastery >= 0.85);

      // 4. Third & Fourth Evidence Events: Build evidence depth to satisfy minimum confidence (>= 0.50)
      await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 0.95, hintsUsed: 0, responseTimeMs: 3200 },
      });
      const ev4 = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 1.0, hintsUsed: 0, responseTimeMs: 3000 },
      });
      assert.ok(ev4.bktUpdate.confidence >= 0.50);

      // 5. Verify Decision Engine transitions strategy to ADVANCE when confidence >= 0.50 and hasNextTarget is true
      const finalDecision = await learnerModelService.getPedagogicalDecision({
        callingUser: learner.callingUser,
        data: { kc: testKc, hasNextTarget: true },
      });
      assert.equal(finalDecision.strategy, PEDAGOGICAL_STRATEGIES.ADVANCE);
    } finally {
      await cleanupLearner(learner);
    }
  });

  await t.test("SCENARIO 2: Performance Degradation (Mastered -> Degraded -> REVIEW)", async () => {
    const learner = await createIsolatedLearner("sc2");
    const testKc = `pointers_memory`;

    try {
      // Establish strong mastery baseline (3 consecutive successes)
      for (let i = 0; i < 3; i++) {
        await learnerModelService.recordEvidence({
          callingUser: learner.callingUser,
          data: { kc: testKc, isCorrect: true, score: 0.9, hintsUsed: 0 },
        });
      }

      const stateBefore = await learnerModelService.getLearnerState({ callingUser: learner.callingUser });
      const kcMasteryBefore = stateBefore.knowledgeState.find((k) => k.kc === testKc);
      assert.equal(kcMasteryBefore.status, "MASTERED");

      // Apply repeated poor / incorrect evidence (2 consecutive failures)
      await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: false, score: 0.2, hintsUsed: 2 },
      });
      await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: false, score: 0.1, hintsUsed: 3 },
      });

      const stateAfter = await learnerModelService.getLearnerState({ callingUser: learner.callingUser });
      const kcMasteryAfter = stateAfter.knowledgeState.find((k) => k.kc === testKc);

      assert.ok(kcMasteryAfter.masteryProbability < kcMasteryBefore.masteryProbability);

      // Decision engine must trigger REVIEW due to recent degradation from prior high average
      const decision = await learnerModelService.getPedagogicalDecision({
        callingUser: learner.callingUser,
        data: { kc: testKc },
      });
      assert.equal(decision.strategy, PEDAGOGICAL_STRATEGIES.REVIEW);
      assert.equal(decision.priority, DECISION_PRIORITY.HIGH);
    } finally {
      await cleanupLearner(learner);
    }
  });

  await t.test("SCENARIO 3: Misconception Accumulation & Open Gap", async () => {
    const learner = await createIsolatedLearner("sc3");
    const testKc = `pointers_memory`;
    const hypothesis = "eval_pointer_offset_confusion";

    try {
      // 1. Submit initial incorrect attempt with explicit hypothesis
      const ev1 = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: false, score: 0.2, hintsUsed: 2, misconceptionHypothesis: hypothesis },
      });
      assert.ok(ev1.recordedMisconception);
      assert.equal(ev1.recordedMisconception.status, "CLOSED"); // Weak baseline (0.17 < 0.35)

      // 2. Submit second consecutive incorrect attempt with same hypothesis
      const ev2 = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: false, score: 0.1, hintsUsed: 2, misconceptionHypothesis: hypothesis },
      });

      assert.ok(ev2.recordedMisconception);
      assert.equal(ev2.recordedMisconception.status, "OPEN"); // Severity accumulates above 0.35 threshold
      assert.ok(ev2.recordedMisconception.severity >= 0.35);

      // 3. Verify Decision Engine prioritizes MISCONCEPTION_REMEDIATION
      const decision = await learnerModelService.getPedagogicalDecision({
        callingUser: learner.callingUser,
        data: { kc: testKc },
      });
      assert.equal(decision.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);
      assert.equal(decision.priority, DECISION_PRIORITY.HIGH);
      assert.equal(decision.misconception.hypothesis, hypothesis);
    } finally {
      await cleanupLearner(learner);
    }
  });

  await t.test("SCENARIO 4: Misconception Recovery & Closure", async () => {
    const learner = await createIsolatedLearner("sc4");
    const testKc = `pointers_memory`;
    const hypothesis = "eval_memory_leak_confusion";

    try {
      // 1. Accumulate open misconception
      await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: false, score: 0.2, hintsUsed: 2, misconceptionHypothesis: hypothesis },
      });
      await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: false, score: 0.1, hintsUsed: 2, misconceptionHypothesis: hypothesis },
      });

      const decisionBefore = await learnerModelService.getPedagogicalDecision({
        callingUser: learner.callingUser,
        data: { kc: testKc },
      });
      assert.equal(decisionBefore.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);

      // 2. Submit clean successful attempt (score 0.95, 0 hints) -> Applies recovery decay
      const rec1 = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 0.95, hintsUsed: 0 },
      });
      assert.ok(rec1.recordedMisconception.severity < decisionBefore.misconception.probability);

      // 3. Submit second clean successful attempt -> Closes misconception gap (< 0.25 threshold)
      const rec2 = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 1.0, hintsUsed: 0 },
      });
      assert.equal(rec2.recordedMisconception.status, "CLOSED");

      // 4. Verify decision strategy returns to normal mastery-based progression
      const decisionAfter = await learnerModelService.getPedagogicalDecision({
        callingUser: learner.callingUser,
        data: { kc: testKc },
      });
      assert.notEqual(decisionAfter.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);
    } finally {
      await cleanupLearner(learner);
    }
  });

  await t.test("SCENARIO 5: Active Misconception Priority Override", async () => {
    const learner = await createIsolatedLearner("sc5");
    const testKc = `pointers_memory`;
    const hypothesis = "forced_open_gap";

    try {
      // Establish strong mastery
      for (let i = 0; i < 4; i++) {
        await learnerModelService.recordEvidence({
          callingUser: learner.callingUser,
          data: { kc: testKc, isCorrect: true, score: 0.95, hintsUsed: 0 },
        });
      }

      // Record evidence associated with the misconception hypothesis for testKc
      await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: false, score: 0.2, hintsUsed: 2, misconceptionHypothesis: hypothesis },
      });

      // Force open misconception
      await learnerModelService.recordMisconceptionState({
        callingUser: learner.callingUser,
        data: { hypothesis, probability: 0.85, status: "OPEN" },
      });

      // Decision MUST select MISCONCEPTION_REMEDIATION, overriding ADVANCE / CHALLENGE / INDEPENDENT_PRACTICE
      const decision = await learnerModelService.getPedagogicalDecision({
        callingUser: learner.callingUser,
        data: { kc: testKc, hasNextTarget: true },
      });

      assert.equal(decision.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);
      assert.equal(decision.priority, DECISION_PRIORITY.HIGH);
      assert.notEqual(decision.strategy, PEDAGOGICAL_STRATEGIES.ADVANCE);
    } finally {
      await cleanupLearner(learner);
    }
  });

  await t.test("SCENARIO 6: False Mastery Protection (Single success does NOT jump to MASTERED)", async () => {
    const learner = await createIsolatedLearner("sc6");
    const testKc = `pointers_memory`;

    try {
      // Submit single 100% correct response from initial unassessed state
      const ev = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 1.0, hintsUsed: 0 },
      });

      // Mastery probability follows standard BKT formula (0.60) and status MUST be DEVELOPING, not MASTERED
      assert.equal(ev.bktUpdate.newMastery, 0.6);
      assert.equal(ev.bktUpdate.status, "DEVELOPING");

      const decision = await learnerModelService.getPedagogicalDecision({
        callingUser: learner.callingUser,
        data: { kc: testKc },
      });
      assert.equal(decision.strategy, PEDAGOGICAL_STRATEGIES.GUIDED_PRACTICE);
      assert.notEqual(decision.strategy, PEDAGOGICAL_STRATEGIES.ADVANCE);
    } finally {
      await cleanupLearner(learner);
    }
  });

  await t.test("SCENARIO 7: False Misconception Protection (Single error does NOT open high-confidence gap)", async () => {
    const learner = await createIsolatedLearner("sc7");
    const testKc = `pointers_memory`;

    try {
      // Submit single incorrect response with hypothesis
      const ev = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: false, score: 0.2, hintsUsed: 2, misconceptionHypothesis: "single_error_gap" },
      });

      // Severity baseline (0.17) is below OPEN threshold (0.35); status must remain CLOSED
      assert.ok(ev.recordedMisconception.severity < 0.35);
      assert.equal(ev.recordedMisconception.status, "CLOSED");
    } finally {
      await cleanupLearner(learner);
    }
  });

  await t.test("SCENARIO 8: End-to-End Adaptive Learning Loop", async () => {
    const learner = await createIsolatedLearner("sc8");
    const testKc = `pointers_memory`;

    // Mock LLM Gateway for deterministic evaluation
    const originalGenerate = llmService.generate;
    let lastLLMStrategyPassed = null;

    llmService.generate = async ({ context }) => {
      lastLLMStrategyPassed = context.assignedStrategy;
      return {
        response: "Mocked adaptive tutoring response.",
        usage: { promptTokens: 100, outputTokens: 50, totalTokens: 150 },
        latency: { totalMs: 200, loadMs: 20, evalMs: 180 },
        model: "qwen3:8b",
        thinkingEnabled: false,
      };
    };

    try {
      // Step 1: Unassessed state -> CONCEPT_REMEDIATION
      const resp1 = await adaptiveLearningService.respond({
        callingUser: learner.callingUser,
        data: { kc: testKc, message: "What is this topic?" },
      });
      assert.equal(resp1.strategy, PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION);
      assert.equal(lastLLMStrategyPassed, PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION);

      // Step 2: Record correct evidence -> GUIDED_PRACTICE
      await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 0.8, hintsUsed: 0 },
      });

      const resp2 = await adaptiveLearningService.respond({
        callingUser: learner.callingUser,
        data: { kc: testKc, message: "I understand a bit more now." },
      });
      assert.equal(resp2.strategy, PEDAGOGICAL_STRATEGIES.GUIDED_PRACTICE);
      assert.equal(lastLLMStrategyPassed, PEDAGOGICAL_STRATEGIES.GUIDED_PRACTICE);

      // Step 3: Record multiple strong correct evidence to build mastery AND confidence >= 0.50 -> ADVANCE
      for (let i = 0; i < 3; i++) {
        await learnerModelService.recordEvidence({
          callingUser: learner.callingUser,
          data: { kc: testKc, isCorrect: true, score: 0.95, hintsUsed: 0 },
        });
      }

      const resp3 = await adaptiveLearningService.respond({
        callingUser: learner.callingUser,
        data: { kc: testKc, message: "Ready for next step.", hasNextTarget: true },
      });
      assert.equal(resp3.strategy, PEDAGOGICAL_STRATEGIES.ADVANCE);
      assert.equal(lastLLMStrategyPassed, PEDAGOGICAL_STRATEGIES.ADVANCE);
    } finally {
      llmService.generate = originalGenerate;
      await cleanupLearner(learner);
    }
  });

  await t.test("SCENARIO 9: Zero Learner-State Mutation During Response Generation", async () => {
    const learner = await createIsolatedLearner("sc9");
    const testKc = `pointers_memory`;

    try {
      // Initialize state
      await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 0.8, hintsUsed: 0 },
      });

      let writeAttempted = false;
      const originalEventCreate = prisma.learningEvent.create;
      const originalMasteryUpdate = prisma.conceptMastery.update;
      const originalGapUpdate = prisma.knowledgeGap.update;

      prisma.learningEvent.create = async function (...args) { writeAttempted = true; return originalEventCreate.apply(this, args); };
      prisma.conceptMastery.update = async function (...args) { writeAttempted = true; return originalMasteryUpdate.apply(this, args); };
      prisma.knowledgeGap.update = async function (...args) { writeAttempted = true; return originalGapUpdate.apply(this, args); };

      const originalGenerate = llmService.generate;
      llmService.generate = async () => ({
        response: "Test response",
        usage: { promptTokens: 10, outputTokens: 10, totalTokens: 20 },
        latency: { totalMs: 100, loadMs: 10, evalMs: 90 },
        model: "qwen3:8b",
        thinkingEnabled: false,
      });

      try {
        await adaptiveLearningService.respond({
          callingUser: learner.callingUser,
          data: { kc: testKc, message: "Generating response" },
        });

        assert.equal(writeAttempted, false, "Response generation MUST NOT mutate learner state database");
      } finally {
        llmService.generate = originalGenerate;
        prisma.learningEvent.create = originalEventCreate;
        prisma.conceptMastery.update = originalMasteryUpdate;
        prisma.knowledgeGap.update = originalGapUpdate;
      }
    } finally {
      await cleanupLearner(learner);
    }
  });

  await t.test("SCENARIO 10: API State Consistency (recordEvidence -> getLearnerState)", async () => {
    const learner = await createIsolatedLearner("sc10");
    const testKc = `pointers_memory`;

    try {
      // Record evidence
      const recorded = await learnerModelService.recordEvidence({
        callingUser: learner.callingUser,
        data: { kc: testKc, isCorrect: true, score: 0.85, hintsUsed: 0, responseTimeMs: 5000 },
      });

      // Query learner state
      const learnerState = await learnerModelService.getLearnerState({
        callingUser: learner.callingUser,
      });

      const cmRecord = learnerState.knowledgeState.find((k) => k.kc === testKc);

      assert.ok(cmRecord, "Recorded KC must be present in knowledgeState");
      assert.equal(cmRecord.masteryProbability, recorded.bktUpdate.newMastery);
      assert.equal(cmRecord.confidence, recorded.bktUpdate.confidence);
      assert.equal(cmRecord.attemptsCount, 1);
      assert.ok(learnerState.behaviorState.totalEventsCount > 0);
    } finally {
      await cleanupLearner(learner);
    }
  });
});
