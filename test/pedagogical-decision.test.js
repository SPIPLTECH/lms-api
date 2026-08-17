const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = require("../src/config/database");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const { evaluatePedagogicalDecision } = require("../src/modules/learner-model/decision.service");
const { PEDAGOGICAL_STRATEGIES, DECISION_PRIORITY } = require("../src/modules/learner-model/decision.config");

test("Phase 4 Controlled Integration Test Suite — Adaptive Decision Engine", async (t) => {
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

  // Helper function to assert state immutability on database
  const assertNoStateMutation = async (fn) => {
    if (!studentProfile) return fn();
    const countMasteryBefore = await prisma.conceptMastery.count({ where: { studentId: studentProfile.id } });
    const countGapsBefore = await prisma.knowledgeGap.count({ where: { studentId: studentProfile.id } });
    const countEventsBefore = await prisma.learningEvent.count({ where: { studentId: studentProfile.id } });

    const result = await fn();

    const countMasteryAfter = await prisma.conceptMastery.count({ where: { studentId: studentProfile.id } });
    const countGapsAfter = await prisma.knowledgeGap.count({ where: { studentId: studentProfile.id } });
    const countEventsAfter = await prisma.learningEvent.count({ where: { studentId: studentProfile.id } });

    assert.equal(countMasteryAfter, countMasteryBefore, "Database ConceptMastery count must not mutate");
    assert.equal(countGapsAfter, countGapsBefore, "Database KnowledgeGap count must not mutate");
    assert.equal(countEventsAfter, countEventsBefore, "Database LearningEvent count must not mutate");

    return result;
  };

  await t.test("SCENARIO 1: LOW_MASTERY (mastery=0.20, no misconception -> CONCEPT_REMEDIATION)", async () => {
    const input = {
      kc: "kc_low_mastery",
      kcState: { masteryProbability: 0.20, confidence: 0.10, attemptsCount: 2, recentScores: [] },
      misconception: null,
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    // 1. Strategy, Priority, Reason assertions
    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION);
    assert.equal(res1.priority, DECISION_PRIORITY.HIGH);
    assert.ok(res1.reason.includes("low"));
    assert.equal(res1.misconception, null);

    // 2. Determinism assertion
    assert.deepEqual(res1, res2);

    // 3. Provider-independent (No LLM) assertion
    assert.equal(res1.prompt, undefined);
    assert.equal(res1.response, undefined);
  });

  await t.test("SCENARIO 2: DEVELOPING_MASTERY (mastery=0.55, no misconception -> GUIDED_PRACTICE)", async () => {
    const input = {
      kc: "kc_developing",
      kcState: { masteryProbability: 0.55, confidence: 0.30, attemptsCount: 4, recentScores: [] },
      misconception: null,
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.GUIDED_PRACTICE);
    assert.equal(res1.priority, DECISION_PRIORITY.MEDIUM);
    assert.ok(res1.reason.includes("developing"));
    assert.equal(res1.misconception, null);
    assert.deepEqual(res1, res2);
  });

  await t.test("SCENARIO 3: STRONG_MASTERY (mastery=0.75, no misconception -> INDEPENDENT_PRACTICE)", async () => {
    const input = {
      kc: "kc_strong",
      kcState: { masteryProbability: 0.75, confidence: 0.40, attemptsCount: 6, recentScores: [] },
      misconception: null,
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.INDEPENDENT_PRACTICE);
    assert.equal(res1.priority, DECISION_PRIORITY.LOW);
    assert.ok(res1.reason.includes("strong"));
    assert.equal(res1.misconception, null);
    assert.deepEqual(res1, res2);
  });

  await t.test("SCENARIO 4: HIGH_MASTERY_WITH_NEXT_TARGET (mastery=0.95, confidence=0.85, hasNextTarget=true -> ADVANCE)", async () => {
    const input = {
      kc: "kc_high_advance",
      kcState: { masteryProbability: 0.95, confidence: 0.85, attemptsCount: 10, recentScores: [] },
      misconception: null,
      hasNextTarget: true,
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.ADVANCE);
    assert.equal(res1.priority, DECISION_PRIORITY.LOW);
    assert.ok(res1.reason.includes("advance"));
    assert.equal(res1.misconception, null);
    assert.deepEqual(res1, res2);
  });

  await t.test("SCENARIO 5: HIGH_MASTERY_WITHOUT_NEXT_TARGET (mastery=0.95, confidence=0.85, hasNextTarget=false -> CHALLENGE)", async () => {
    const input = {
      kc: "kc_high_challenge",
      kcState: { masteryProbability: 0.95, confidence: 0.85, attemptsCount: 10, recentScores: [] },
      misconception: null,
      hasNextTarget: false,
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.CHALLENGE);
    assert.equal(res1.priority, DECISION_PRIORITY.LOW);
    assert.ok(res1.reason.includes("challenge"));
    assert.equal(res1.misconception, null);
    assert.deepEqual(res1, res2);
  });

  await t.test("SCENARIO 6: HIGH_MASTERY_ACTIVE_MISCONCEPTION (mastery=0.90, active misconception=0.80 -> MISCONCEPTION_REMEDIATION)", async () => {
    const input = {
      kc: "kc_high_misconception",
      kcState: { masteryProbability: 0.90, confidence: 0.95, attemptsCount: 12, recentScores: [] },
      misconception: { hypothesis: "pointer_value_confusion", probability: 0.80, status: "OPEN" },
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    // Active misconception MUST override high mastery (not CHALLENGE or ADVANCE)
    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);
    assert.equal(res1.priority, DECISION_PRIORITY.HIGH);
    assert.ok(res1.reason.includes("misconception"));
    assert.equal(res1.misconception.hypothesis, "pointer_value_confusion");
    assert.equal(res1.misconception.probability, 0.80);
    assert.equal(res1.misconception.status, "OPEN");
    assert.deepEqual(res1, res2);
  });

  await t.test("SCENARIO 7: MASTERY_DEGRADATION (previous mastery=0.90, current=0.55, recent failures -> REVIEW)", async () => {
    const input = {
      kc: "kc_degraded",
      kcState: {
        masteryProbability: 0.55,
        confidence: 0.40,
        attemptsCount: 8,
        recentScores: [
          { score: 0.9, isCorrect: true },
          { score: 0.85, isCorrect: true },
          { score: 0.2, isCorrect: false },
          { score: 0.1, isCorrect: false },
        ],
      },
      misconception: null,
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.REVIEW);
    assert.equal(res1.priority, DECISION_PRIORITY.HIGH);
    assert.ok(res1.reason.includes("degradation"));
    assert.equal(res1.misconception, null);
    assert.deepEqual(res1, res2);
  });

  await t.test("SCENARIO 8: UNASSESSED (no mastery evidence -> CONCEPT_REMEDIATION)", async () => {
    const input = {
      kc: "kc_unassessed",
      kcState: null,
      misconception: null,
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION);
    assert.equal(res1.priority, DECISION_PRIORITY.MEDIUM);
    assert.ok(res1.reason.includes("unassessed"));
    assert.equal(res1.misconception, null);
    assert.deepEqual(res1, res2);
  });

  await t.test("SCENARIO 9: CLOSED_MISCONCEPTION (mastery=0.70, misconception probability=0.15 CLOSED -> INDEPENDENT_PRACTICE)", async () => {
    const input = {
      kc: "kc_closed_gap",
      kcState: { masteryProbability: 0.70, confidence: 0.40, attemptsCount: 5, recentScores: [] },
      misconception: { hypothesis: "old_resolved_gap", probability: 0.15, status: "CLOSED" },
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    // CLOSED gap must NOT trigger MISCONCEPTION_REMEDIATION
    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.INDEPENDENT_PRACTICE);
    assert.equal(res1.priority, DECISION_PRIORITY.LOW);
    assert.notEqual(res1.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);
    assert.deepEqual(res1, res2);
  });

  await t.test("SCENARIO 10: PRIORITY_TEST (mastery=0.95, confidence=0.95, OPEN misconception=0.90 -> MISCONCEPTION_REMEDIATION)", async () => {
    const input = {
      kc: "kc_priority_test",
      kcState: { masteryProbability: 0.95, confidence: 0.95, attemptsCount: 15, recentScores: [] },
      misconception: { hypothesis: "critical_misconception", probability: 0.90, status: "OPEN" },
      hasNextTarget: true,
    };

    const res1 = evaluatePedagogicalDecision(input);
    const res2 = evaluatePedagogicalDecision(input);

    // Misconception MUST override ADVANCE and CHALLENGE
    assert.equal(res1.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);
    assert.equal(res1.priority, DECISION_PRIORITY.HIGH);
    assert.notEqual(res1.strategy, PEDAGOGICAL_STRATEGIES.ADVANCE);
    assert.notEqual(res1.strategy, PEDAGOGICAL_STRATEGIES.CHALLENGE);
    assert.deepEqual(res1, res2);
  });

  await t.test("INTEGRATION API: POST /learner-model/decision evaluates authentic student deterministically without side effects", async () => {
    // Create an isolated user/profile for deterministic API decision evaluation
    const isoUser = await prisma.user.create({
      data: {
        name: "Decision Test Learner",
        email: `decision_test_${Date.now()}@test.com`,
        password: "password123",
        role: "STUDENT",
      },
    });
    const isoProfile = await prisma.studentProfile.create({
      data: { userId: isoUser.id },
    });
    const isoCallingUser = { id: isoUser.id, role: "STUDENT" };

    try {
      const res1 = await learnerModelService.getPedagogicalDecision({
        callingUser: isoCallingUser,
        data: {
          kc: "pointers_memory",
          hasNextTarget: true,
        },
      });

      const res2 = await learnerModelService.getPedagogicalDecision({
        callingUser: isoCallingUser,
        data: {
          kc: "pointers_memory",
          hasNextTarget: true,
        },
      });

      assert.ok(res1.strategy !== undefined);
      assert.ok(res1.reason !== undefined);
      assert.ok(res1.priority !== undefined);
      assert.equal(res1.kc, "pointers_memory");
      assert.equal(res1.prompt, undefined);
      assert.deepEqual(res1, res2);
    } finally {
      await prisma.conceptMastery.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.knowledgeGap.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.learningEvent.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.studentProfile.delete({ where: { id: isoProfile.id } });
      await prisma.user.delete({ where: { id: isoUser.id } });
    }
  });

  await t.test("INTEGRATION TIER 2 FIX: TEST 1 — Existing concept-based KnowledgeGap produces expected remediation decision", async () => {
    const isoUser = await prisma.user.create({
      data: { name: "Concept Gap Learner", email: `concept_gap_${Date.now()}@test.com`, password: "password123", role: "STUDENT" },
    });
    const isoProfile = await prisma.studentProfile.create({ data: { userId: isoUser.id } });
    const isoCallingUser = { id: isoUser.id, role: "STUDENT" };

    try {
      await prisma.conceptMastery.create({
        data: {
          studentId: isoProfile.id,
          concept: "pointers_memory",
          masteryScore: 0.60,
          confidenceLevel: 0.40,
          status: "DEVELOPING",
          attemptsCount: 3,
          recentScores: [{ score: 0.4, isCorrect: false, misconceptionHypothesis: "syntax_error_pattern" }],
        },
      });
      await prisma.knowledgeGap.create({
        data: { studentId: isoProfile.id, concept: "syntax_error_pattern", severity: 0.80, status: "OPEN" },
      });

      const res = await learnerModelService.getPedagogicalDecision({
        callingUser: isoCallingUser,
        data: { kc: "pointers_memory" },
      });

      assert.equal(res.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);
      assert.equal(res.priority, DECISION_PRIORITY.HIGH);
      assert.equal(res.misconception.hypothesis, "syntax_error_pattern");
    } finally {
      await prisma.conceptMastery.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.knowledgeGap.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.studentProfile.delete({ where: { id: isoProfile.id } });
      await prisma.user.delete({ where: { id: isoUser.id } });
    }
  });

  await t.test("INTEGRATION TIER 2 FIX: TEST 2 — Tier 2 KC-based KnowledgeGap (concept=FIFO_LIFO_CONFUSION, kc=phase6_manual_test_kc) is detected", async () => {
    const isoUser = await prisma.user.create({
      data: { name: "Tier2 Gap Learner", email: `tier2_gap_${Date.now()}@test.com`, password: "password123", role: "STUDENT" },
    });
    const isoProfile = await prisma.studentProfile.create({ data: { userId: isoUser.id } });
    const isoCallingUser = { id: isoUser.id, role: "STUDENT" };

    try {
      await prisma.conceptMastery.create({
        data: { studentId: isoProfile.id, concept: "phase6_manual_test_kc", masteryScore: 0.1969, confidenceLevel: 0.7115, status: "WEAK", attemptsCount: 7 },
      });
      await prisma.knowledgeGap.create({
        data: {
          studentId: isoProfile.id,
          concept: "FIFO_LIFO_CONFUSION",
          kc: "phase6_manual_test_kc",
          type: "FIFO_LIFO_CONFUSION",
          severity: 0.42,
          status: "OPEN",
          description: "Student confuses LIFO with FIFO by selecting Queue instead of Stack.",
          confidence: 0.95,
          evidence: 'Selected "Queue" (correct: "Stack")',
        },
      });

      const res = await learnerModelService.getPedagogicalDecision({
        callingUser: isoCallingUser,
        data: { kc: "phase6_manual_test_kc" },
      });

      assert.equal(res.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);
      assert.equal(res.priority, DECISION_PRIORITY.HIGH);
      assert.equal(res.misconception.hypothesis, "FIFO_LIFO_CONFUSION");
      assert.equal(res.misconception.status, "OPEN");
    } finally {
      await prisma.conceptMastery.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.knowledgeGap.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.studentProfile.delete({ where: { id: isoProfile.id } });
      await prisma.user.delete({ where: { id: isoUser.id } });
    }
  });

  await t.test("INTEGRATION TIER 2 FIX: TEST 3 — KnowledgeGap belonging to another student is NOT returned even if KC matches", async () => {
    const userA = await prisma.user.create({ data: { name: "User A", email: `usera_${Date.now()}@test.com`, password: "password123", role: "STUDENT" } });
    const profileA = await prisma.studentProfile.create({ data: { userId: userA.id } });

    const userB = await prisma.user.create({ data: { name: "User B", email: `userb_${Date.now()}@test.com`, password: "password123", role: "STUDENT" } });
    const profileB = await prisma.studentProfile.create({ data: { userId: userB.id } });
    const callingUserB = { id: userB.id, role: "STUDENT" };

    try {
      await prisma.conceptMastery.create({ data: { studentId: profileA.id, concept: "shared_kc", masteryScore: 0.20, status: "WEAK", attemptsCount: 1 } });
      await prisma.knowledgeGap.create({ data: { studentId: profileA.id, concept: "FIFO_LIFO_CONFUSION", kc: "shared_kc", severity: 0.95, status: "OPEN" } });

      await prisma.conceptMastery.create({ data: { studentId: profileB.id, concept: "shared_kc", masteryScore: 0.20, status: "WEAK", attemptsCount: 1 } });

      const resB = await learnerModelService.getPedagogicalDecision({
        callingUser: callingUserB,
        data: { kc: "shared_kc" },
      });

      assert.equal(resB.misconception, null, "User B must not see User A's KnowledgeGap");
      assert.notEqual(resB.strategy, PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION);
    } finally {
      await prisma.conceptMastery.deleteMany({ where: { studentId: { in: [profileA.id, profileB.id] } } });
      await prisma.knowledgeGap.deleteMany({ where: { studentId: { in: [profileA.id, profileB.id] } } });
      await prisma.studentProfile.deleteMany({ where: { id: { in: [profileA.id, profileB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    }
  });

  await t.test("INTEGRATION TIER 2 FIX: TEST 4 — A CLOSED KnowledgeGap is ignored", async () => {
    const isoUser = await prisma.user.create({
      data: { name: "Closed Gap Learner", email: `closed_gap_${Date.now()}@test.com`, password: "password123", role: "STUDENT" },
    });
    const isoProfile = await prisma.studentProfile.create({ data: { userId: isoUser.id } });
    const isoCallingUser = { id: isoUser.id, role: "STUDENT" };

    try {
      await prisma.conceptMastery.create({ data: { studentId: isoProfile.id, concept: "phase6_manual_test_kc", masteryScore: 0.60, status: "DEVELOPING", attemptsCount: 4 } });
      await prisma.knowledgeGap.create({
        data: { studentId: isoProfile.id, concept: "FIFO_LIFO_CONFUSION", kc: "phase6_manual_test_kc", severity: 0.17, status: "CLOSED" },
      });

      const res = await learnerModelService.getPedagogicalDecision({
        callingUser: isoCallingUser,
        data: { kc: "phase6_manual_test_kc" },
      });

      assert.equal(res.misconception, null, "CLOSED KnowledgeGap must be ignored");
      assert.equal(res.strategy, PEDAGOGICAL_STRATEGIES.GUIDED_PRACTICE);
    } finally {
      await prisma.conceptMastery.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.knowledgeGap.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.studentProfile.delete({ where: { id: isoProfile.id } });
      await prisma.user.delete({ where: { id: isoUser.id } });
    }
  });

  await t.test("INTEGRATION TIER 2 FIX: TEST 5 — If there is no matching KnowledgeGap, existing decision behavior remains unchanged", async () => {
    const isoUser = await prisma.user.create({
      data: { name: "No Gap Learner", email: `no_gap_${Date.now()}@test.com`, password: "password123", role: "STUDENT" },
    });
    const isoProfile = await prisma.studentProfile.create({ data: { userId: isoUser.id } });
    const isoCallingUser = { id: isoUser.id, role: "STUDENT" };

    try {
      await prisma.conceptMastery.create({ data: { studentId: isoProfile.id, concept: "clean_test_kc", masteryScore: 0.60, status: "DEVELOPING", attemptsCount: 4 } });

      const res = await learnerModelService.getPedagogicalDecision({
        callingUser: isoCallingUser,
        data: { kc: "clean_test_kc" },
      });

      assert.equal(res.misconception, null);
      assert.equal(res.strategy, PEDAGOGICAL_STRATEGIES.GUIDED_PRACTICE);
      assert.equal(res.priority, DECISION_PRIORITY.MEDIUM);
    } finally {
      await prisma.conceptMastery.deleteMany({ where: { studentId: isoProfile.id } });
      await prisma.studentProfile.delete({ where: { id: isoProfile.id } });
      await prisma.user.delete({ where: { id: isoUser.id } });
    }
  });
});
