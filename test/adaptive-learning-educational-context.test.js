const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const llmService = require("../src/modules/llm/llm.service");
const { mintAccessToken } = require("./helpers/authToken");

/**
 * Phase 6 — Educational Context Pipeline for POST /adaptive-learning/respond.
 *
 * Proves: quizId+questionId are references only (question text/options/
 * correctAnswer/studentAnswer are always server-resolved, never trusted from
 * the client); the field pair is co-dependent (both or neither); a mismatched
 * or missing reference degrades gracefully to the pre-existing kc+message
 * flow instead of erroring; the resolution path is read-only; and internal
 * learner metrics (masteryProbability/confidence/recentScores/attemptsCount/
 * status) never reach the LLM, with or without educational context present.
 */
test("Phase 6 — Adaptive Learning Educational Context Pipeline", async (t) => {
  const createFixture = async (
    suffix,
    { questionType = "MCQ_SINGLE", options = ["Queue", "Stack", "Tree", "Graph"], correctAnswer = "Stack", topic } = {}
  ) => {
    const instructor = await prisma.user.create({
      data: {
        name: `EduCtx Instructor ${suffix}`,
        email: `eductx_instructor_${suffix}_${Date.now()}@test.com`,
        password: "hashedpassword123",
        role: "INSTRUCTOR",
      },
    });
    const course = await prisma.course.create({
      data: { title: `EduCtx Course ${suffix}`, creatorId: instructor.id },
    });
    const quiz = await prisma.quiz.create({
      data: { title: `EduCtx Quiz ${suffix}`, passingScore: 50, courseId: course.id },
    });
    const kc = topic || `eductx_kc_${suffix}_${Date.now()}`;
    const question = await prisma.question.create({
      data: {
        question: `EduCtx Question ${suffix}: which data structure uses LIFO ordering?`,
        questionType,
        options,
        correctAnswer,
        marks: 1,
        courseId: course.id,
        topic: kc,
      },
    });
    await prisma.quizQuestion.create({
      data: { quizId: quiz.id, questionId: question.id, order: 1, marks: 1 },
    });
    const studentUser = await prisma.user.create({
      data: {
        name: `EduCtx Student ${suffix}`,
        email: `eductx_student_${suffix}_${Date.now()}@test.com`,
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
      kc,
      studentUser,
      studentProfile,
      token: mintAccessToken(studentUser),
      callingUser: { id: studentUser.id, role: "STUDENT" },
    };
  };

  const cleanupFixture = async (fx) => {
    if (!fx) return;
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

  // Seeds a ConceptMastery row for (student, kc) WITHOUT creating a
  // QuizSubmission — getPedagogicalDecision 404s on a kc unknown to the
  // whole system, so every scenario needs this regardless of whether it
  // also exercises the quiz-submission path.
  const seedConceptMastery = (fx) =>
    learnerModelService.recordEvidence({
      callingUser: fx.callingUser,
      data: { studentId: fx.studentProfile.id, kc: fx.kc, isCorrect: true, score: 0.9, hintsUsed: 0 },
    });

  const withMockedLlm = async (fn) => {
    const originalGenerate = llmService.generate;
    let capturedPrompt = null;
    let capturedContext = null;
    llmService.generate = async ({ prompt, context }) => {
      capturedPrompt = prompt;
      capturedContext = context;
      return {
        response: "Mocked tutoring response.",
        usage: { promptTokens: 10, outputTokens: 10, totalTokens: 20 },
        latency: { totalMs: 50, loadMs: 5, evalMs: 45 },
        model: "qwen3:8b",
        thinkingEnabled: false,
      };
    };
    try {
      await fn(() => ({ capturedPrompt, capturedContext }));
    } finally {
      llmService.generate = originalGenerate;
    }
  };

  await t.test("TEST 1: backward compatibility — kc+message only, no quizId/questionId", async () => {
    const fx = await createFixture("t1");
    try {
      await seedConceptMastery(fx);

      await withMockedLlm(async (getCaptured) => {
        const res = await request(app)
          .post("/adaptive-learning/respond")
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ kc: fx.kc, message: "I don't understand why I got this wrong." });

        assert.equal(res.status, 200, JSON.stringify(res.body));

        const { capturedPrompt, capturedContext } = getCaptured();
        assert.equal(capturedPrompt, `Target Knowledge Component: ${fx.kc}\n\nStudent Message:\n"I don't understand why I got this wrong."`);
        assert.deepEqual(capturedContext, { targetKC: fx.kc, assignedStrategy: capturedContext.assignedStrategy });
        assert.ok(!("questionId" in capturedContext));
        assert.ok(!capturedPrompt.includes("Question:"));
        assert.ok(!capturedPrompt.includes("Options:"));
        assert.ok(!capturedPrompt.includes("Correct Answer:"));
      });
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 2: quizId without questionId returns 400", async () => {
    const fx = await createFixture("t2");
    try {
      const res = await request(app)
        .post("/adaptive-learning/respond")
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ kc: fx.kc, message: "help", quizId: fx.quiz.id });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 3: questionId without quizId returns 400", async () => {
    const fx = await createFixture("t3");
    try {
      const res = await request(app)
        .post("/adaptive-learning/respond")
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ kc: fx.kc, message: "help", questionId: fx.question.id });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 4: valid quiz/question — question text, type, options, correctAnswer, questionId reach prompt/context", async () => {
    const fx = await createFixture("t4", { options: ["Queue", "Stack", "Tree", "Graph"], correctAnswer: "Stack" });
    try {
      await seedConceptMastery(fx);

      await withMockedLlm(async (getCaptured) => {
        const res = await request(app)
          .post("/adaptive-learning/respond")
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ kc: fx.kc, message: "Can you help me review this?", quizId: fx.quiz.id, questionId: fx.question.id });

        assert.equal(res.status, 200, JSON.stringify(res.body));

        const { capturedPrompt, capturedContext } = getCaptured();
        assert.equal(capturedContext.questionId, fx.question.id);
        assert.equal(capturedContext.questionType, "MCQ_SINGLE");
        assert.ok(capturedPrompt.includes(fx.question.question), "question text must reach the prompt");
        assert.ok(capturedPrompt.includes("Queue") && capturedPrompt.includes("Stack") && capturedPrompt.includes("Tree") && capturedPrompt.includes("Graph"), "options must reach the prompt");
        assert.ok(capturedPrompt.includes("Correct Answer:\nStack"), "correct answer must reach the prompt");
      });
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 5: valid quiz/question WITH a submission — student's actual answer reaches the prompt", async () => {
    const fx = await createFixture("t5", { options: ["Queue", "Stack", "Tree", "Graph"], correctAnswer: "Stack" });
    try {
      await quizService.submitQuiz(fx.studentProfile.id, fx.quiz.id, [{ questionId: fx.question.id, answer: "Queue" }]);

      await withMockedLlm(async (getCaptured) => {
        const res = await request(app)
          .post("/adaptive-learning/respond")
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ kc: fx.kc, message: "Why is this wrong?", quizId: fx.quiz.id, questionId: fx.question.id });

        assert.equal(res.status, 200, JSON.stringify(res.body));

        const { capturedPrompt } = getCaptured();
        assert.ok(capturedPrompt.includes("Student's Answer:\nQueue"), "the student's actual submitted answer must reach the prompt");
        assert.ok(!capturedPrompt.includes("Not yet attempted"));
      });
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 6: valid quiz/question WITHOUT a submission — studentAnswer is null / 'Not yet attempted', question still reaches the prompt", async () => {
    const fx = await createFixture("t6", { options: ["Queue", "Stack", "Tree", "Graph"], correctAnswer: "Stack" });
    try {
      await seedConceptMastery(fx);
      // No quizService.submitQuiz call — no QuizSubmission exists for this student/quiz.

      await withMockedLlm(async (getCaptured) => {
        const res = await request(app)
          .post("/adaptive-learning/respond")
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ kc: fx.kc, message: "What should I know before attempting this?", quizId: fx.quiz.id, questionId: fx.question.id });

        assert.equal(res.status, 200, JSON.stringify(res.body));

        const { capturedPrompt } = getCaptured();
        assert.ok(capturedPrompt.includes(fx.question.question), "question must still reach the prompt with no submission");
        assert.ok(capturedPrompt.includes("Student's Answer:\nNot yet attempted"));
      });
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 7: questionId does not belong to quizId — request still succeeds, no educational context added", async () => {
    const fxA = await createFixture("t7a");
    const fxB = await createFixture("t7b");
    try {
      await seedConceptMastery(fxA);

      await withMockedLlm(async (getCaptured) => {
        const res = await request(app)
          .post("/adaptive-learning/respond")
          .set("Authorization", `Bearer ${fxA.token}`)
          // fxA's own quizId paired with fxB's unrelated questionId.
          .send({ kc: fxA.kc, message: "help", quizId: fxA.quiz.id, questionId: fxB.question.id });

        assert.equal(res.status, 200, JSON.stringify(res.body));

        const { capturedPrompt, capturedContext } = getCaptured();
        assert.ok(!("questionId" in capturedContext), "mismatched reference must not leak into context");
        assert.ok(!capturedPrompt.includes("Question:"));
        assert.ok(!capturedPrompt.includes(fxB.question.question));
        assert.equal(capturedPrompt, `Target Knowledge Component: ${fxA.kc}\n\nStudent Message:\n"help"`);
      });
    } finally {
      await cleanupFixture(fxA);
      await cleanupFixture(fxB);
    }
  });

  await t.test("TEST 8: cross-student isolation — caller cannot receive another student's submitted answer", async () => {
    const fxOwner = await createFixture("t8owner", { options: ["Queue", "Stack", "Tree", "Graph"], correctAnswer: "Stack" });
    const fxCaller = await createFixture("t8caller");
    try {
      // fxOwner submits an answer to their OWN quiz/question.
      await quizService.submitQuiz(fxOwner.studentProfile.id, fxOwner.quiz.id, [
        { questionId: fxOwner.question.id, answer: "Queue" },
      ]);

      // A DIFFERENT student (fxCaller) asks about the SAME quizId+questionId,
      // authenticated as themselves.
      await seedConceptMastery(fxCaller);

      await withMockedLlm(async (getCaptured) => {
        const res = await request(app)
          .post("/adaptive-learning/respond")
          .set("Authorization", `Bearer ${fxCaller.token}`)
          .send({ kc: fxCaller.kc, message: "help", quizId: fxOwner.quiz.id, questionId: fxOwner.question.id });

        assert.equal(res.status, 200, JSON.stringify(res.body));

        const { capturedPrompt } = getCaptured();
        // fxCaller never submitted this quiz -> must see "Not yet attempted",
        // never fxOwner's real answer "Queue".
        assert.ok(capturedPrompt.includes("Student's Answer:\nNot yet attempted"));
        assert.ok(!capturedPrompt.includes("Student's Answer:\nQueue"));
      });
    } finally {
      await cleanupFixture(fxOwner);
      await cleanupFixture(fxCaller);
    }
  });

  await t.test("TEST 9: metric non-leakage — masteryProbability/confidence/recentScores/attemptsCount/status never reach the LLM", async () => {
    const fx = await createFixture("t9", { options: ["Queue", "Stack", "Tree", "Graph"], correctAnswer: "Stack" });
    try {
      // Build up substantial, distinctive internal state so a leak would be detectable.
      for (let i = 0; i < 4; i++) {
        await learnerModelService.recordEvidence({
          callingUser: fx.callingUser,
          data: { studentId: fx.studentProfile.id, kc: fx.kc, isCorrect: true, score: 0.95, hintsUsed: 0 },
        });
      }
      await quizService.submitQuiz(fx.studentProfile.id, fx.quiz.id, [{ questionId: fx.question.id, answer: "Queue" }]);

      const mastery = await prisma.conceptMastery.findUnique({
        where: { studentId_concept: { studentId: fx.studentProfile.id, concept: fx.kc } },
      });
      assert.ok(mastery.attemptsCount >= 4);

      await withMockedLlm(async (getCaptured) => {
        const res = await request(app)
          .post("/adaptive-learning/respond")
          .set("Authorization", `Bearer ${fx.token}`)
          .send({ kc: fx.kc, message: "help", quizId: fx.quiz.id, questionId: fx.question.id });

        assert.equal(res.status, 200, JSON.stringify(res.body));

        const { capturedPrompt, capturedContext } = getCaptured();
        const serialized = `${capturedPrompt}\n${JSON.stringify(capturedContext)}`;

        for (const forbidden of ["masteryProbability", "confidence", "recentScores", "attemptsCount", "status"]) {
          assert.ok(!serialized.includes(forbidden), `internal metric key "${forbidden}" must never appear in prompt/context`);
        }
        // Also confirm the actual numeric mastery value itself isn't present.
        assert.ok(!serialized.includes(String(mastery.masteryScore)));
      });
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 10: zero mutation — educational context resolution performs only reads", async () => {
    const fx = await createFixture("t10", { options: ["Queue", "Stack", "Tree", "Graph"], correctAnswer: "Stack" });
    try {
      await quizService.submitQuiz(fx.studentProfile.id, fx.quiz.id, [{ questionId: fx.question.id, answer: "Stack" }]);

      let writeAttempted = false;
      const guards = [
        ["question", "update"],
        ["question", "create"],
        ["quizQuestion", "update"],
        ["quizQuestion", "create"],
        ["quizSubmission", "update"],
        ["quizSubmission", "create"],
        ["conceptMastery", "update"],
        ["conceptMastery", "create"],
        ["knowledgeGap", "update"],
        ["knowledgeGap", "create"],
        ["learningEvent", "create"],
      ];
      const originals = guards.map(([model, method]) => prisma[model][method]);
      guards.forEach(([model, method], i) => {
        prisma[model][method] = async function (...args) {
          writeAttempted = true;
          return originals[i].apply(this, args);
        };
      });

      await withMockedLlm(async () => {
        try {
          const res = await request(app)
            .post("/adaptive-learning/respond")
            .set("Authorization", `Bearer ${fx.token}`)
            .send({ kc: fx.kc, message: "help", quizId: fx.quiz.id, questionId: fx.question.id });
          assert.equal(res.status, 200, JSON.stringify(res.body));
        } finally {
          guards.forEach(([model, method], i) => {
            prisma[model][method] = originals[i];
          });
        }
      });

      assert.equal(writeAttempted, false, "resolveEducationalContext must never write to the database");
    } finally {
      await cleanupFixture(fx);
    }
  });
});
