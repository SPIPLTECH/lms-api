const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const { PEDAGOGICAL_STRATEGIES } = require("../src/modules/learner-model/decision.config");

/**
 * Phase 6 bridge: POST /quizzes/:quizId/submit must feed the EXISTING
 * learner-model pipeline (BKT + misconception detection) instead of stopping
 * at QuizSubmission. These tests exercise quizService.submitQuiz directly —
 * the same layer every other test file in this suite uses for "API" coverage
 * (see the "POST /learner-model/decision" tests in pedagogical-decision.test.js
 * and phase6-system-evaluation.test.js) — since the controller is a thin
 * pass-through with no logic of its own.
 */
test("Phase 6 Bridge — Quiz Submission -> Learner Model Evidence", async (t) => {
  const createFixture = async (suffix, { correctAnswer = "A", topic, passingScore = 50 } = {}) => {
    const instructor = await prisma.user.create({
      data: {
        name: `Bridge Instructor ${suffix}`,
        email: `bridge_instructor_${suffix}_${Date.now()}@test.com`,
        password: "hashedpassword123",
        role: "INSTRUCTOR",
      },
    });

    const course = await prisma.course.create({
      data: {
        title: `Bridge Course ${suffix}`,
        creatorId: instructor.id,
      },
    });

    const quiz = await prisma.quiz.create({
      data: {
        title: `Bridge Quiz ${suffix}`,
        passingScore,
        courseId: course.id,
      },
    });

    const question = await prisma.question.create({
      data: {
        question: `Bridge Question ${suffix}`,
        questionType: "MCQ_SINGLE",
        options: ["A", "B", "C", "D"],
        correctAnswer,
        marks: 1,
        courseId: course.id,
        topic,
      },
    });

    await prisma.quizQuestion.create({
      data: { quizId: quiz.id, questionId: question.id, order: 1, marks: 1 },
    });

    const studentUser = await prisma.user.create({
      data: {
        name: `Bridge Student ${suffix}`,
        email: `bridge_student_${suffix}_${Date.now()}@test.com`,
        password: "hashedpassword123",
        role: "STUDENT",
      },
    });

    const studentProfile = await prisma.studentProfile.create({
      data: { userId: studentUser.id },
    });

    return {
      instructor,
      course,
      quiz,
      question,
      studentUser,
      studentProfile,
      callingUser: { id: studentUser.id, role: "STUDENT" },
    };
  };

  const cleanupFixture = async (fx) => {
    if (!fx) return;
    // Wait for any fire-and-forget Tier 2 misconception classification this
    // fixture's submission may have dispatched (quiz.service.js) before
    // deleting the student — otherwise its eventual KnowledgeGap.create()
    // hits KnowledgeGap_studentId_fkey against a row that's already gone.
    await quizService.flushPendingMisconceptionClassifications();
    await prisma.quizSubmission.deleteMany({ where: { studentId: fx.studentProfile.id } });
    await prisma.conceptMastery.deleteMany({ where: { studentId: fx.studentProfile.id } });
    await prisma.knowledgeGap.deleteMany({ where: { studentId: fx.studentProfile.id } });
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

  await t.test("TEST A: correct quiz submission creates ConceptMastery via BKT and logs a LearningEvent", async () => {
    const fx = await createFixture("a", { correctAnswer: "A", topic: "bridge_kc_a" });
    try {
      const priorMastery = await prisma.conceptMastery.findUnique({
        where: { studentId_concept: { studentId: fx.studentProfile.id, concept: "bridge_kc_a" } },
      });
      assert.equal(priorMastery, null);

      const submission = await quizService.submitQuiz(fx.studentProfile.id, fx.quiz.id, [
        { questionId: fx.question.id, answer: "A" },
      ]);

      // QuizSubmission response shape is unaffected by the bridge.
      assert.equal(submission.score, 1);
      assert.equal(submission.percentage, 100);
      assert.equal(submission.passed, true);

      const mastery = await prisma.conceptMastery.findUnique({
        where: { studentId_concept: { studentId: fx.studentProfile.id, concept: "bridge_kc_a" } },
      });
      assert.ok(mastery, "ConceptMastery should have been created by the evidence bridge");
      assert.equal(mastery.attemptsCount, 1);
      assert.ok(
        mastery.masteryScore > 0.2,
        `expected BKT mastery to rise above the 0.2 prior on a correct answer, got ${mastery.masteryScore}`
      );

      const events = await prisma.learningEvent.findMany({
        where: { studentId: fx.studentProfile.id, quizId: fx.quiz.id },
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].eventType, "QUIZ_SUBMITTED");
      assert.equal(events[0].payload.kc, "bridge_kc_a");
      assert.equal(events[0].payload.isCorrect, true);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST B: incorrect quiz submission moves BKT mastery down", async () => {
    const fx = await createFixture("b", { correctAnswer: "A", topic: "bridge_kc_b" });
    try {
      const submission = await quizService.submitQuiz(fx.studentProfile.id, fx.quiz.id, [
        { questionId: fx.question.id, answer: "B" },
      ]);

      assert.equal(submission.score, 0);
      assert.equal(submission.passed, false);

      const mastery = await prisma.conceptMastery.findUnique({
        where: { studentId_concept: { studentId: fx.studentProfile.id, concept: "bridge_kc_b" } },
      });
      assert.ok(mastery, "ConceptMastery should have been created even on an incorrect answer");
      assert.equal(mastery.attemptsCount, 1);
      assert.ok(
        mastery.masteryScore < 0.2,
        `expected BKT mastery to drop below the 0.2 prior on an incorrect answer, got ${mastery.masteryScore}`
      );

      const events = await prisma.learningEvent.findMany({
        where: { studentId: fx.studentProfile.id, quizId: fx.quiz.id },
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].payload.isCorrect, false);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST C: quiz submission feeds the EXISTING misconception engine for an already-open hypothesis", async () => {
    const fx = await createFixture("c", { correctAnswer: "A", topic: "bridge_kc_c" });
    const hypothesis = "bridge_hypothesis_c";
    try {
      // Seed and open a misconception through the pre-existing direct evidence
      // channel (mirrors misconception-detection.test.js) BEFORE any quiz
      // submission runs. Quiz questions have no misconceptionHypothesis field,
      // so the bridge itself never invents one.
      await learnerModelService.recordEvidence({
        callingUser: fx.callingUser,
        data: {
          studentId: fx.studentProfile.id,
          kc: "bridge_kc_c",
          score: 0.1,
          isCorrect: false,
          hintsUsed: 2,
          misconceptionHypothesis: hypothesis,
        },
      });
      await learnerModelService.recordEvidence({
        callingUser: fx.callingUser,
        data: {
          studentId: fx.studentProfile.id,
          kc: "bridge_kc_c",
          score: 0.1,
          isCorrect: false,
          hintsUsed: 2,
          misconceptionHypothesis: hypothesis,
        },
      });

      const afterSeed = await prisma.knowledgeGap.findFirst({
        where: { studentId: fx.studentProfile.id, concept: hypothesis },
      });
      assert.ok(afterSeed);
      assert.equal(afterSeed.status, "OPEN");

      // Submit the quiz incorrectly for the SAME kc. The evidence payload the
      // bridge sends carries no explicit hypothesis — proving that the
      // EXISTING misconception.service.js fallback (resolving the hypothesis
      // from ConceptMastery.recentScores history) is what gets invoked, not a
      // new/duplicate misconception engine.
      await quizService.submitQuiz(fx.studentProfile.id, fx.quiz.id, [
        { questionId: fx.question.id, answer: "B" },
      ]);

      const afterQuiz = await prisma.knowledgeGap.findFirst({
        where: { studentId: fx.studentProfile.id, concept: hypothesis },
      });
      assert.ok(afterQuiz);
      assert.equal(afterQuiz.status, "OPEN");
      assert.ok(
        afterQuiz.severity > afterSeed.severity,
        `expected misconception severity to keep climbing (${afterSeed.severity} -> ${afterQuiz.severity})`
      );
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST D: full chain — quiz submission -> evidence -> BKT -> misconception -> POST /learner-model/decision", async () => {
    const fx = await createFixture("d", { correctAnswer: "A", topic: "bridge_kc_d" });
    try {
      // getPedagogicalDecision only accepts KCs already known to the system
      // (ConceptMastery must exist for the concept, for any student). Seed it
      // via the existing initializeLearnerState — the same setup step a real
      // course/curriculum bootstrap would perform before students see this KC.
      await learnerModelService.initializeLearnerState({
        callingUser: fx.callingUser,
        data: { kcs: [{ kc: "bridge_kc_d" }], courseId: fx.course.id },
      });

      const before = await learnerModelService.getPedagogicalDecision({
        callingUser: fx.callingUser,
        data: { kc: "bridge_kc_d" },
      });
      assert.equal(before.strategy, PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION);

      // Six consecutive correct submissions drive BKT to MASTERED with enough
      // accumulated confidence to clear the decision engine's threshold —
      // same math already proven in phase6-system-evaluation.test.js
      // (SCENARIO 1), but driven through the quiz submission flow instead of
      // calling recordEvidence directly.
      for (let i = 0; i < 6; i++) {
        await quizService.submitQuiz(fx.studentProfile.id, fx.quiz.id, [
          { questionId: fx.question.id, answer: "A" },
        ]);
      }

      const mastery = await prisma.conceptMastery.findUnique({
        where: { studentId_concept: { studentId: fx.studentProfile.id, concept: "bridge_kc_d" } },
      });
      assert.equal(mastery.attemptsCount, 6);
      assert.equal(mastery.status, "MASTERED");

      const after = await learnerModelService.getPedagogicalDecision({
        callingUser: fx.callingUser,
        data: { kc: "bridge_kc_d", hasNextTarget: true },
      });
      assert.notEqual(after.strategy, before.strategy);
      assert.ok(
        after.strategy === PEDAGOGICAL_STRATEGIES.ADVANCE || after.strategy === PEDAGOGICAL_STRATEGIES.CHALLENGE,
        `expected a mastered-learner decision, got ${after.strategy}`
      );
    } finally {
      await cleanupFixture(fx);
    }
  });
});
