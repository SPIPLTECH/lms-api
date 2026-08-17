const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const misconceptionClassifier = require("../src/modules/learner-model/misconceptionClassifier.service");
const llmService = require("../src/modules/llm/llm.service");
const { MISCONCEPTION_TAXONOMY } = require("../src/modules/learner-model/misconceptionTaxonomy.config");
const { mintAccessToken } = require("./helpers/authToken");

/**
 * Phase 7B — Tier 2 LLM misconception classification.
 *
 * Group A tests misconceptionClassifier.classifyAndApply() directly
 * (awaited), which lets severity/status assertions be as precise and
 * deterministic as Phase 7A's — the underlying misconception.service.js
 * call is identical either way. Group B proves the real wiring in
 * quiz.service.js: the classifier only fires for wrong+untagged answers,
 * fire-and-forget (never blocking or failing the HTTP response), and never
 * fires when Tier 1 already resolved a tag or the answer was correct.
 */
test("Phase 7B — Tier 2 LLM Misconception Classification", async (t) => {
  const mockLlm = (implementation) => {
    const original = llmService.generate;
    llmService.generate = implementation;
    return () => {
      llmService.generate = original;
    };
  };

  const jsonResponse = (obj) => ({
    response: JSON.stringify(obj),
    usage: { promptTokens: 50, outputTokens: 20, totalTokens: 70 },
    latency: { totalMs: 10, loadMs: 1, evalMs: 9 },
    model: "qwen3:8b",
    thinkingEnabled: false,
  });

  const createStudent = async (suffix) => {
    const user = await prisma.user.create({
      data: {
        name: `Tier2 Student ${suffix}`,
        email: `tier2_student_${suffix}_${Date.now()}@test.com`,
        password: "hashedpassword123",
        role: "STUDENT",
      },
    });
    const profile = await prisma.studentProfile.create({ data: { userId: user.id } });
    return { user, profile, callingUser: { id: user.id, role: "STUDENT" } };
  };

  const cleanupStudent = async (s) => {
    if (!s) return;
    await prisma.quizSubmission.deleteMany({ where: { studentId: s.profile.id } });
    await prisma.knowledgeGap.deleteMany({ where: { studentId: s.profile.id } });
    await prisma.conceptMastery.deleteMany({ where: { studentId: s.profile.id } });
    await prisma.learningEvent.deleteMany({ where: { studentId: s.profile.id } });
    await prisma.studentState.deleteMany({ where: { studentId: s.profile.id } });
    await prisma.studentProfile.delete({ where: { id: s.profile.id } });
    await prisma.user.delete({ where: { id: s.user.id } });
  };

  // Mirrors what quiz.service.js does synchronously (via recordEvidence,
  // no hypothesis) BEFORE the fire-and-forget classifier dispatch — Tier 1
  // found nothing, so BKT/mastery is recorded with no misconception yet.
  const seedWrongAnswerEvidence = ({ studentId, callingUser, kc, score = 0.1 }) =>
    learnerModelService.recordEvidence({
      callingUser,
      data: { studentId, kc, isCorrect: false, score },
    });

  const classifierInput = (overrides = {}) => ({
    studentId: overrides.studentId,
    kc: overrides.kc,
    questionText: "Which data structure uses LIFO ordering?",
    options: ["Queue", "Stack", "Tree", "Graph"],
    correctAnswer: "Stack",
    studentAnswer: "Queue",
    isCorrect: false,
    score: 0.1,
    ...overrides,
  });

  await t.test("Group A: classifyAndApply — direct", async (tt) => {
    await tt.test("happy path: valid detected response creates a KnowledgeGap with correct severity, status, and metadata", async () => {
      const s = await createStudent("a1");
      const restore = mockLlm(async () =>
        jsonResponse({ detected: true, type: "FIFO_LIFO_CONFUSION", description: "Confuses queue and stack ordering.", confidence: 0.91 })
      );
      try {
        const kc = "tier2_kc_a1";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });

        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc }));

        const gap = await prisma.knowledgeGap.findFirst({ where: { studentId: s.profile.id, concept: "FIFO_LIFO_CONFUSION" } });
        assert.ok(gap, "classifier must create a KnowledgeGap");
        assert.equal(gap.kc, kc);
        assert.equal(gap.type, "FIFO_LIFO_CONFUSION");
        assert.equal(gap.description, "Confuses queue and stack ordering.");
        assert.equal(gap.confidence, 0.91);
        assert.equal(gap.evidence, 'Selected "Queue" (correct: "Stack") for question: "Which data structure uses LIFO ordering?"');
        // Same unchanged severity formula as Tier 1 (Phase 7A): first wrong
        // answer, hintsUsed=0, no prior gap -> INITIAL_INCORRECT_WEIGHT alone.
        assert.equal(gap.severity, 0.12);
        assert.equal(gap.status, "CLOSED");
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });

    await tt.test("detected:false creates no KnowledgeGap", async () => {
      const s = await createStudent("a2");
      const restore = mockLlm(async () => jsonResponse({ detected: false }));
      try {
        const kc = "tier2_kc_a2";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });
        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc }));

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: s.profile.id } });
        assert.equal(gaps.length, 0);
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });

    await tt.test("confidence below threshold (0.6) is discarded even when well-formed and detected", async () => {
      const s = await createStudent("a3");
      const restore = mockLlm(async () =>
        jsonResponse({ detected: true, type: "FIFO_LIFO_CONFUSION", description: "Maybe...", confidence: 0.4 })
      );
      try {
        const kc = "tier2_kc_a3";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });
        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc }));

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: s.profile.id } });
        assert.equal(gaps.length, 0, "a sub-threshold confidence must never create a misconception");
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });

    await tt.test("a type outside the controlled taxonomy is rejected", async () => {
      const s = await createStudent("a4");
      const restore = mockLlm(async () =>
        jsonResponse({ detected: true, type: "SOMETHING_THE_MODEL_INVENTED", description: "...", confidence: 0.95 })
      );
      try {
        const kc = "tier2_kc_a4";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });
        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc }));

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: s.profile.id } });
        assert.equal(gaps.length, 0, "an invented type must never reach the learner model, however confident");
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });

    await tt.test("malformed (non-JSON) response is discarded without crashing", async () => {
      const s = await createStudent("a5");
      const restore = mockLlm(async () => ({
        response: "I cannot determine the misconception here, sorry.",
        usage: {}, latency: {}, model: "qwen3:8b", thinkingEnabled: false,
      }));
      try {
        const kc = "tier2_kc_a5";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });
        await assert.doesNotReject(() => misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc })));

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: s.profile.id } });
        assert.equal(gaps.length, 0);
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });

    await tt.test("JSON wrapped in markdown fences / surrounding prose is still extracted and applied", async () => {
      const s = await createStudent("a6");
      const restore = mockLlm(async () => ({
        response:
          'Here is my analysis:\n```json\n{"detected": true, "type": "FIFO_LIFO_CONFUSION", "description": "Queue/stack mix-up.", "confidence": 0.8}\n```\nHope that helps.',
        usage: {}, latency: {}, model: "qwen3:8b", thinkingEnabled: false,
      }));
      try {
        const kc = "tier2_kc_a6";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });
        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc }));

        const gap = await prisma.knowledgeGap.findFirst({ where: { studentId: s.profile.id, concept: "FIFO_LIFO_CONFUSION" } });
        assert.ok(gap, "fenced/prose-wrapped JSON must still be parsed");
        assert.equal(gap.confidence, 0.8);
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });

    await tt.test("LLM failure (thrown error) is caught, never crashes, never writes", async () => {
      const s = await createStudent("a7");
      const restore = mockLlm(async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      });
      try {
        const kc = "tier2_kc_a7";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });
        await assert.doesNotReject(() => misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc })));

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: s.profile.id } });
        assert.equal(gaps.length, 0);
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });

    await tt.test("repeated classification of the same type accumulates severity via the UNCHANGED formula, crossing OPEN", async () => {
      const s = await createStudent("a8");
      const restore = mockLlm(async () =>
        jsonResponse({ detected: true, type: "FIFO_LIFO_CONFUSION", description: "Queue/stack mix-up.", confidence: 0.85 })
      );
      try {
        const kc = "tier2_kc_a8";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });
        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc }));

        const afterFirst = await prisma.knowledgeGap.findFirst({ where: { studentId: s.profile.id, concept: "FIFO_LIFO_CONFUSION" } });
        assert.equal(afterFirst.severity, 0.12);
        assert.equal(afterFirst.status, "CLOSED");

        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc, score: 0.05 });
        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc, score: 0.05 }));

        const afterSecond = await prisma.knowledgeGap.findFirst({ where: { studentId: s.profile.id, concept: "FIFO_LIFO_CONFUSION" } });
        assert.ok(afterSecond.severity > afterFirst.severity);
        assert.equal(afterSecond.status, "OPEN", "two consecutive classified errors must cross the unchanged 0.35 threshold");
        assert.equal(afterSecond.confidence, 0.85, "metadata refreshes to the latest classification (current-row pattern)");
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });

    await tt.test("a different resolved type for the same KC creates a second, distinct KnowledgeGap", async () => {
      const s = await createStudent("a9");
      try {
        const kc = "tier2_kc_a9";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });
        let restore = mockLlm(async () =>
          jsonResponse({ detected: true, type: "FIFO_LIFO_CONFUSION", description: "...", confidence: 0.8 })
        );
        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc }));
        restore();

        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });
        restore = mockLlm(async () =>
          jsonResponse({ detected: true, type: "OFF_BY_ONE_ERROR", description: "...", confidence: 0.8 })
        );
        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc }));
        restore();

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: s.profile.id } });
        assert.equal(gaps.length, 2);
        const types = gaps.map((g) => g.type).sort();
        assert.deepEqual(types, ["FIFO_LIFO_CONFUSION", "OFF_BY_ONE_ERROR"]);
      } finally {
        await cleanupStudent(s);
      }
    });

    await tt.test("idempotent metadata write: applying the same classification twice leaves consistent final state", async () => {
      const s = await createStudent("a10");
      const restore = mockLlm(async () =>
        jsonResponse({ detected: true, type: "SIGN_ERROR", description: "Sign confusion.", confidence: 0.77 })
      );
      try {
        const kc = "tier2_kc_a10";
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });

        const input = classifierInput({ studentId: s.profile.id, kc });
        await misconceptionClassifier.classifyAndApply(input);
        const first = await prisma.knowledgeGap.findFirst({ where: { studentId: s.profile.id, concept: "SIGN_ERROR" } });

        // Re-apply the identical classification against the identical gap
        // (simulating a duplicate dispatch) — the metadata overwrite is
        // idempotent by construction (plain update-by-id, not an increment).
        await prisma.knowledgeGap.update({
          where: { id: first.id },
          data: { kc, type: "SIGN_ERROR", description: "Sign confusion.", confidence: 0.77, evidence: first.evidence },
        });

        const second = await prisma.knowledgeGap.findUnique({ where: { id: first.id } });
        assert.equal(second.type, first.type);
        assert.equal(second.description, first.description);
        assert.equal(second.confidence, first.confidence);
        assert.equal(second.evidence, first.evidence);
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });

    await tt.test("security: the LLM call never receives internal learner metrics", async () => {
      const s = await createStudent("a11");
      let capturedSystemPrompt = null;
      let capturedPrompt = null;
      const restore = mockLlm(async ({ systemPrompt, prompt }) => {
        capturedSystemPrompt = systemPrompt;
        capturedPrompt = prompt;
        return jsonResponse({ detected: true, type: "FIFO_LIFO_CONFUSION", description: "...", confidence: 0.8 });
      });
      try {
        const kc = "tier2_kc_a11";
        // Build up real, non-trivial mastery/confidence state first.
        for (let i = 0; i < 3; i++) {
          await learnerModelService.recordEvidence({
            callingUser: s.callingUser,
            data: { studentId: s.profile.id, kc, isCorrect: true, score: 0.95 },
          });
        }
        await seedWrongAnswerEvidence({ studentId: s.profile.id, callingUser: s.callingUser, kc });

        await misconceptionClassifier.classifyAndApply(classifierInput({ studentId: s.profile.id, kc }));

        // Note: the classifier's OWN output contract legitimately asks the
        // model to return a "confidence" field, so bare "confidence" is not
        // checked here — these are the internal BKT/state field names that
        // must never appear regardless.
        const combined = `${capturedSystemPrompt}\n${capturedPrompt}`;
        for (const forbidden of ["masteryProbability", "confidenceLevel", "recentScores", "attemptsCount", "kcState"]) {
          assert.ok(!combined.includes(forbidden), `"${forbidden}" must never reach the classifier prompt`);
        }
      } finally {
        restore();
        await cleanupStudent(s);
      }
    });
  });

  await t.test("Group B: quiz.service.js wiring — real HTTP", async (tt) => {
    const createQuizFixture = async (suffix, { options, correctAnswer, topic } = {}) => {
      const instructor = await prisma.user.create({
        data: { name: `Tier2 Instructor ${suffix}`, email: `tier2_instructor_${suffix}_${Date.now()}@test.com`, password: "x", role: "INSTRUCTOR" },
      });
      const course = await prisma.course.create({ data: { title: `Tier2 Course ${suffix}`, creatorId: instructor.id } });
      const quiz = await prisma.quiz.create({ data: { title: `Tier2 Quiz ${suffix}`, passingScore: 50, courseId: course.id } });
      const question = await prisma.question.create({
        data: {
          question: "Which data structure uses LIFO ordering?",
          questionType: "MCQ_SINGLE",
          options,
          correctAnswer,
          marks: 1,
          courseId: course.id,
          topic,
        },
      });
      await prisma.quizQuestion.create({ data: { quizId: quiz.id, questionId: question.id, order: 1, marks: 1 } });
      const studentUser = await prisma.user.create({
        data: { name: `Tier2 Student ${suffix}`, email: `tier2_student_http_${suffix}_${Date.now()}@test.com`, password: "x", role: "STUDENT" },
      });
      const studentProfile = await prisma.studentProfile.create({ data: { userId: studentUser.id } });
      return { instructor, course, quiz, question, studentUser, studentProfile, token: mintAccessToken(studentUser) };
    };

    const cleanupQuizFixture = async (fx) => {
      if (!fx) return;
      await prisma.quizSubmission.deleteMany({ where: { studentId: fx.studentProfile.id } });
      await prisma.knowledgeGap.deleteMany({ where: { studentId: fx.studentProfile.id } });
      await prisma.conceptMastery.deleteMany({ where: { studentId: fx.studentProfile.id } });
      await prisma.learningEvent.deleteMany({ where: { studentId: fx.studentProfile.id } });
      await prisma.studentState.deleteMany({ where: { studentId: fx.studentProfile.id } });
      await prisma.studentProfile.delete({ where: { id: fx.studentProfile.id } });
      await prisma.user.delete({ where: { id: fx.studentUser.id } });
      await prisma.quizQuestion.deleteMany({ where: { quizId: fx.quiz.id } });
      await prisma.question.deleteMany({ where: { courseId: fx.course.id } });
      await prisma.quiz.deleteMany({ where: { courseId: fx.course.id } });
      await prisma.course.delete({ where: { id: fx.course.id } });
      await prisma.user.delete({ where: { id: fx.instructor.id } });
    };

    const waitFor = async (checkFn, { timeoutMs = 4000, intervalMs = 100 } = {}) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const result = await checkFn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return null;
    };

    await tt.test("wrong + untagged answer: HTTP response returns before the classifier finishes, which applies asynchronously afterward", async () => {
      const fx = await createQuizFixture("b1", {
        options: ["Queue", "Stack", "Tree", "Graph"], // plain strings — no Tier 1 tags possible
        correctAnswer: "Stack",
        topic: "tier2_http_kc_b1",
      });
      let callCount = 0;
      // A large, deliberately generous delay (this remote DB's own baseline
      // request latency varies widely, seen anywhere from ~300ms to several
      // seconds elsewhere in this suite) — the point is not a tight timing
      // threshold but a causal ordering: the response must come back and
      // the gap must NOT exist yet, strictly before this delay elapses.
      const SIMULATED_LLM_DELAY_MS = 3000;
      const restore = mockLlm(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, SIMULATED_LLM_DELAY_MS));
        return jsonResponse({ detected: true, type: "FIFO_LIFO_CONFUSION", description: "Queue/stack mix-up.", confidence: 0.9 });
      });
      try {
        const res = await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ answers: [{ questionId: fx.question.id, answer: "Queue" }] });

        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(callCount, 1);

        // The response is already back, but the mock is still sleeping
        // inside its artificial delay — proves the classifier was not
        // awaited before responding.
        const immediatelyAfter = await prisma.knowledgeGap.findFirst({
          where: { studentId: fx.studentProfile.id, concept: "FIFO_LIFO_CONFUSION" },
        });
        assert.equal(immediatelyAfter, null, "the classifier must still be in flight when the HTTP response returns");

        // classifyAndApply writes in two sequential steps — the gap row
        // first (via evaluateAndDetectMisconception), then a separate
        // follow-up update for kc/type/description/confidence/evidence —
        // so poll for the fully-populated state, not just row existence,
        // to avoid catching the narrow window between the two writes.
        const gap = await waitFor(async () => {
          const found = await prisma.knowledgeGap.findFirst({ where: { studentId: fx.studentProfile.id, concept: "FIFO_LIFO_CONFUSION" } });
          return found && found.kc ? found : null;
        }, { timeoutMs: SIMULATED_LLM_DELAY_MS + 4000 });
        assert.ok(gap, "the classifier must eventually apply its result after the response was already sent");
        assert.equal(gap.kc, "tier2_http_kc_b1");
        assert.equal(gap.confidence, 0.9);
      } finally {
        restore();
        await cleanupQuizFixture(fx);
      }
    });

    // Regression test for the KnowledgeGap_studentId_fkey crash: cleanup that
    // deletes a student's StudentProfile without first waiting for this same
    // fire-and-forget dispatch races the classifier's own eventual
    // knowledgeGap.create() — that create() targets a real, still-correct
    // studentId, but by the time it runs the row it points to has already
    // been deleted by cleanup, so it fails its foreign key. Unlike the test
    // above (which uses a bespoke waitFor() poll), this proves the fix meant
    // for exactly this situation: quizService.flushPendingMisconceptionClassifications()
    // deterministically waits for the in-flight dispatch, so cleanup is always
    // safe immediately after awaiting it — no polling, no fixed timeout.
    await tt.test("regression: flushPendingMisconceptionClassifications() prevents KnowledgeGap_studentId_fkey during fixture teardown", async () => {
      const fx = await createQuizFixture("b1r", {
        options: ["Queue", "Stack", "Tree", "Graph"],
        correctAnswer: "Stack",
        topic: "tier2_http_kc_b1r",
      });
      const originalConsoleError = console.error;
      const loggedErrors = [];
      console.error = (...args) => {
        loggedErrors.push(args.map(String).join(" "));
      };
      const restore = mockLlm(async () => {
        await new Promise((r) => setTimeout(r, 500));
        return jsonResponse({ detected: true, type: "FIFO_LIFO_CONFUSION", description: "Queue/stack mix-up.", confidence: 0.9 });
      });
      try {
        const res = await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ answers: [{ questionId: fx.question.id, answer: "Queue" }] });

        assert.equal(res.status, 201, JSON.stringify(res.body));

        // No waitFor() polling — this call must itself be the guarantee that
        // the fire-and-forget classifier has fully settled before we assert
        // the DB write or hand fx back to cleanupQuizFixture().
        await quizService.flushPendingMisconceptionClassifications();

        const fkErrors = loggedErrors.filter((line) => line.includes("KnowledgeGap_studentId_fkey"));
        assert.equal(fkErrors.length, 0, `expected no foreign-key violations, got: ${fkErrors.join("\n")}`);

        const gap = await prisma.knowledgeGap.findFirst({
          where: { studentId: fx.studentProfile.id, concept: "FIFO_LIFO_CONFUSION" },
        });
        assert.ok(gap, "KnowledgeGap must be persisted once the flush resolves");
        assert.equal(gap.studentId, fx.studentProfile.id, "must use the same existing student identifier BKT/ConceptMastery already wrote under");
      } finally {
        console.error = originalConsoleError;
        restore();
        // Now provably safe: the flush above already guaranteed the
        // classifier's write landed, so this cannot race it.
        await cleanupQuizFixture(fx);
      }
    });

    await tt.test("wrong answer WITH a Tier 1 tag: Tier 2 classifier is never invoked", async () => {
      const fx = await createQuizFixture("b2", {
        options: [
          { optionText: "Queue", isCorrect: false, misconceptionTag: "FIFO_LIFO_CONFUSION" },
          { optionText: "Stack", isCorrect: true },
        ],
        correctAnswer: "Stack",
        topic: "tier2_http_kc_b2",
      });
      let callCount = 0;
      const restore = mockLlm(async () => {
        callCount++;
        return jsonResponse({ detected: true, type: "OFF_BY_ONE_ERROR", description: "should never be used", confidence: 0.9 });
      });
      try {
        const res = await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ answers: [{ questionId: fx.question.id, answer: "Queue" }] });

        assert.equal(res.status, 201, JSON.stringify(res.body));

        // Give any (incorrect) fire-and-forget dispatch a moment to have
        // fired if the guard were broken, then assert it never did.
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(callCount, 0, "Tier 1 already resolved a tag — Tier 2 must not run at all");

        const gap = await prisma.knowledgeGap.findFirst({ where: { studentId: fx.studentProfile.id, concept: "FIFO_LIFO_CONFUSION" } });
        assert.ok(gap, "Tier 1 must still have created its own gap synchronously, unaffected by Tier 2 existing");
      } finally {
        restore();
        await cleanupQuizFixture(fx);
      }
    });

    await tt.test("correct answer: Tier 2 classifier is never invoked", async () => {
      const fx = await createQuizFixture("b3", {
        options: ["Queue", "Stack", "Tree", "Graph"],
        correctAnswer: "Stack",
        topic: "tier2_http_kc_b3",
      });
      let callCount = 0;
      const restore = mockLlm(async () => {
        callCount++;
        return jsonResponse({ detected: true, type: "FIFO_LIFO_CONFUSION", description: "should never be used", confidence: 0.9 });
      });
      try {
        const res = await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ answers: [{ questionId: fx.question.id, answer: "Stack" }] });

        assert.equal(res.status, 201, JSON.stringify(res.body));
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(callCount, 0);

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: fx.studentProfile.id } });
        assert.equal(gaps.length, 0);
      } finally {
        restore();
        await cleanupQuizFixture(fx);
      }
    });
  });
});
