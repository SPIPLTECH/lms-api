const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const { mintAccessToken } = require("./helpers/authToken");

/**
 * Phase 6 hardening — real HTTP coverage for the quiz submission path.
 *
 * quiz-learner-model-integration.test.js exercises quizService.submitQuiz()
 * directly. These tests instead go through the actual HTTP stack (Express
 * routing -> auth middleware -> Joi validation -> controller -> service ->
 * learnerModelService.recordEvidence() -> BKT -> ConceptMastery), so a
 * regression in routing, auth wiring, or request validation would be caught
 * here even if the service-level tests still pass.
 *
 * It also proves the fix for submitQuizSchema's answer type: evaluateAnswer()
 * (quiz.service.js) requires an array for MCQ_MULTI/ARRANGE_TOKENS and an
 * object for MATCH_PAIRS, but the schema previously declared
 * `answer: Joi.string()`, which either rejected those payloads outright or
 * let them through in a shape evaluateAnswer could never score above 0.
 */
test("Phase 6 Hardening — Real HTTP Quiz Submission Path", async (t) => {
  const createFixture = async (
    suffix,
    { questionType, options = [], correctAnswer, topic = null, marks = 1, passingScore = 50 } = {}
  ) => {
    const instructor = await prisma.user.create({
      data: {
        name: `HTTP Instructor ${suffix}`,
        email: `http_instructor_${suffix}_${Date.now()}@test.com`,
        password: "hashedpassword123",
        role: "INSTRUCTOR",
      },
    });
    const course = await prisma.course.create({
      data: { title: `HTTP Course ${suffix}`, creatorId: instructor.id },
    });
    const quiz = await prisma.quiz.create({
      data: { title: `HTTP Quiz ${suffix}`, passingScore, courseId: course.id },
    });
    const question = await prisma.question.create({
      data: {
        question: `HTTP Question ${suffix}`,
        questionType,
        options,
        correctAnswer,
        marks,
        courseId: course.id,
        topic,
      },
    });
    await prisma.quizQuestion.create({
      data: { quizId: quiz.id, questionId: question.id, order: 1, marks },
    });
    const studentUser = await prisma.user.create({
      data: {
        name: `HTTP Student ${suffix}`,
        email: `http_student_${suffix}_${Date.now()}@test.com`,
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
      token: mintAccessToken(studentUser),
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

  await t.test("ISSUE 2 — HTTP: POST /quizzes/:quizId/submit exercises the full chain to ConceptMastery + LearningEvent", async () => {
    const fx = await createFixture("issue2", {
      questionType: "MCQ_SINGLE",
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "Paris",
      topic: "http_bridge_kc",
    });
    try {
      const res = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ answers: [{ questionId: fx.question.id, answer: "Paris" }] });

      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.score, 1);
      assert.equal(res.body.data.passed, true);

      const persistedSubmission = await prisma.quizSubmission.findUnique({
        where: { studentId_quizId: { studentId: fx.studentProfile.id, quizId: fx.quiz.id } },
      });
      assert.ok(persistedSubmission, "QuizSubmission must be persisted");
      assert.equal(persistedSubmission.percentage, 100);

      const masteryAfterFirst = await prisma.conceptMastery.findUnique({
        where: { studentId_concept: { studentId: fx.studentProfile.id, concept: "http_bridge_kc" } },
      });
      assert.ok(masteryAfterFirst, "ConceptMastery must be created via the evidence bridge");
      assert.equal(masteryAfterFirst.attemptsCount, 1);
      assert.ok(
        masteryAfterFirst.masteryScore > 0.2,
        `expected mastery to rise above the 0.2 prior, got ${masteryAfterFirst.masteryScore}`
      );

      const events = await prisma.learningEvent.findMany({
        where: { studentId: fx.studentProfile.id, quizId: fx.quiz.id },
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].eventType, "QUIZ_SUBMITTED");
      assert.equal(events[0].payload.isCorrect, true);

      // Resubmit incorrectly through the same real endpoint: attemptsCount
      // must increment and mastery must move back down in the same call.
      const res2 = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ answers: [{ questionId: fx.question.id, answer: "London" }] });

      assert.equal(res2.status, 201);
      assert.equal(res2.body.data.passed, false);

      const masteryAfterSecond = await prisma.conceptMastery.findUnique({
        where: { studentId_concept: { studentId: fx.studentProfile.id, concept: "http_bridge_kc" } },
      });
      assert.equal(masteryAfterSecond.attemptsCount, 2);
      assert.ok(
        masteryAfterSecond.masteryScore < masteryAfterFirst.masteryScore,
        `expected mastery to drop after an incorrect resubmission (${masteryAfterFirst.masteryScore} -> ${masteryAfterSecond.masteryScore})`
      );
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("ISSUE 2b — HTTP: unauthenticated submission is rejected before touching the learner model", async () => {
    const fx = await createFixture("issue2b", {
      questionType: "MCQ_SINGLE",
      options: ["A", "B"],
      correctAnswer: "A",
      topic: "http_auth_kc",
    });
    try {
      const res = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .send({ answers: [{ questionId: fx.question.id, answer: "A" }] });

      assert.equal(res.status, 401);

      const mastery = await prisma.conceptMastery.findUnique({
        where: { studentId_concept: { studentId: fx.studentProfile.id, concept: "http_auth_kc" } },
      });
      assert.equal(mastery, null, "no learner-model write should happen for a rejected request");
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("ISSUE 3 — HTTP: MCQ_MULTI array answer is accepted and scored (previously blocked by Joi.string())", async () => {
    const fx = await createFixture("issue3mcqmulti", {
      questionType: "MCQ_MULTI",
      options: ["Red", "Green", "Blue", "Yellow"],
      correctAnswer: ["Red", "Blue"],
      topic: "http_mcq_multi_kc",
    });
    try {
      const res = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ answers: [{ questionId: fx.question.id, answer: ["Red", "Blue"] }] });

      assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.data.score, 1);
      assert.equal(res.body.data.percentage, 100);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("ISSUE 3 — HTTP: ARRANGE_TOKENS ordered array answer is accepted and scored", async () => {
    const fx = await createFixture("issue3arrange", {
      questionType: "ARRANGE_TOKENS",
      correctAnswer: ["first", "second", "third"],
      topic: "http_arrange_kc",
    });
    try {
      const correctRes = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ answers: [{ questionId: fx.question.id, answer: ["first", "second", "third"] }] });

      assert.equal(correctRes.status, 201, JSON.stringify(correctRes.body));
      assert.equal(correctRes.body.data.score, 1);

      const partialRes = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ answers: [{ questionId: fx.question.id, answer: ["first", "third", "second"] }] });

      assert.equal(partialRes.status, 201);
      // Asserting on `percentage` here, not `score`: QuizSubmission.score is
      // an Int column in the Prisma schema, but calculateSubmissionResult's
      // partial-credit math is fractional (e.g. 1/3 = 0.33). Prisma silently
      // truncates that to 0 on write to the Int column — a pre-existing
      // schema/scoring mismatch, unrelated to and not masked by this fix,
      // that only becomes reachable now that partial-credit-capable answer
      // shapes (arrays/objects) can get past validation at all. Flagged in
      // the hardening report as a remaining risk rather than fixed here,
      // since it requires a schema migration (out of scope: "DO NOT
      // redesign the database schema").
      assert.ok(
        partialRes.body.data.percentage > 0 && partialRes.body.data.percentage < 100,
        `expected partial credit for a partially-correct order, got percentage=${partialRes.body.data.percentage}`
      );
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("ISSUE 3 — HTTP: MATCH_PAIRS object answer is accepted and scored", async () => {
    const fx = await createFixture("issue3match", {
      questionType: "MATCH_PAIRS",
      correctAnswer: { "1": "A", "2": "B" },
      topic: "http_match_kc",
    });
    try {
      const res = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ answers: [{ questionId: fx.question.id, answer: { "1": "A", "2": "B" } }] });

      assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.data.score, 1);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("ISSUE 3 — HTTP: TRUE_FALSE string answer remains backward compatible", async () => {
    const fx = await createFixture("issue3tf", {
      questionType: "TRUE_FALSE",
      options: ["True", "False"],
      correctAnswer: "True",
      topic: "http_tf_kc",
    });
    try {
      const res = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ answers: [{ questionId: fx.question.id, answer: "True" }] });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.score, 1);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("ISSUE 3 — HTTP: MCQ_SINGLE string answer remains backward compatible", async () => {
    const fx = await createFixture("issue3mcqsingle", {
      questionType: "MCQ_SINGLE",
      options: ["A", "B", "C", "D"],
      correctAnswer: "C",
      topic: "http_mcq_single_kc",
    });
    try {
      const res = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ answers: [{ questionId: fx.question.id, answer: "C" }] });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.score, 1);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("ISSUE 3 — HTTP: a malformed answer shape (number) is still rejected with 400 and never reaches the DB", async () => {
    const fx = await createFixture("issue3invalid", {
      questionType: "MCQ_SINGLE",
      options: ["A", "B"],
      correctAnswer: "A",
      topic: "http_invalid_kc",
    });
    try {
      const res = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ answers: [{ questionId: fx.question.id, answer: 12345 }] });

      assert.equal(res.status, 400);

      const submission = await prisma.quizSubmission.findUnique({
        where: { studentId_quizId: { studentId: fx.studentProfile.id, quizId: fx.quiz.id } },
      });
      assert.equal(submission, null, "validation must fail before the controller/service ever runs");
    } finally {
      await cleanupFixture(fx);
    }
  });
});
