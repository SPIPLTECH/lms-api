const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/database");
const { mintAccessToken } = require("./helpers/authToken");

/**
 * Phase 6 hardening — Question.topic / KC integrity.
 *
 * Root cause: the "quiz builder" bulk/import question-creation path
 * (POST /questions/bulk, POST /questions/import -> question.service.js ->
 * normalizeQuestion()) never read or persisted `topic` at all, so every
 * question created that way landed with Question.topic = NULL in Postgres
 * regardless of what the caller sent. The sibling Question Repository path
 * (POST /questions -> questionRepositoryService.createQuestion) DID handle
 * `topic` in its service code, but question.validation.js never declared it
 * in Joi's createQuestionSchema, so joiValidation.middleware's
 * stripUnknown:true silently discarded it before the service ever saw it.
 *
 * quiz.service.js's evidence bridge then mapped any null topic to a single
 * shared "Uncategorized" KC, silently merging unrelated questions' BKT and
 * misconception state.
 *
 * These tests exercise the real HTTP question-creation endpoint (proving
 * the fix) and the real HTTP quiz-submission endpoint (proving the KC that
 * reaches the learner model is correct and never a shared bucket).
 */
test("Phase 6 Hardening — Question.topic / KC Integrity", async (t) => {
  const createBaseFixture = async (suffix) => {
    const instructor = await prisma.user.create({
      data: {
        name: `KC Instructor ${suffix}`,
        email: `kc_instructor_${suffix}_${Date.now()}@test.com`,
        password: "hashedpassword123",
        role: "INSTRUCTOR",
      },
    });
    const course = await prisma.course.create({
      data: { title: `KC Course ${suffix}`, creatorId: instructor.id },
    });
    const quiz = await prisma.quiz.create({
      data: { title: `KC Quiz ${suffix}`, passingScore: 50, courseId: course.id },
    });
    const studentUser = await prisma.user.create({
      data: {
        name: `KC Student ${suffix}`,
        email: `kc_student_${suffix}_${Date.now()}@test.com`,
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
      studentUser,
      studentProfile,
      instructorToken: mintAccessToken(instructor),
      studentToken: mintAccessToken(studentUser),
    };
  };

  // Questions created via the bulk endpoint are not guaranteed to carry
  // Question.courseId (a separate, pre-existing gap in question.service.js
  // that is out of scope here), so cleanup walks the QuizQuestion junction
  // rather than filtering questions by courseId.
  const cleanupFixture = async (fx) => {
    if (!fx) return;
    const links = await prisma.quizQuestion.findMany({
      where: { quizId: fx.quiz.id },
      select: { questionId: true },
    });
    const questionIds = links.map((l) => l.questionId);

    await prisma.quizSubmission.deleteMany({ where: { studentId: fx.studentProfile.id } });
    await prisma.conceptMastery.deleteMany({ where: { studentId: fx.studentProfile.id } });
    await prisma.knowledgeGap.deleteMany({ where: { studentId: fx.studentProfile.id } });
    await prisma.learningEvent.deleteMany({ where: { studentId: fx.studentProfile.id } });
    await prisma.studentState.deleteMany({ where: { studentId: fx.studentProfile.id } });
    await prisma.studentProfile.delete({ where: { id: fx.studentProfile.id } });
    await prisma.user.delete({ where: { id: fx.studentUser.id } });
    await prisma.quizQuestion.deleteMany({ where: { quizId: fx.quiz.id } });
    if (questionIds.length) {
      await prisma.question.deleteMany({ where: { id: { in: questionIds } } });
    }
    await prisma.quiz.delete({ where: { id: fx.quiz.id } });
    await prisma.course.delete({ where: { id: fx.course.id } });
    await prisma.user.delete({ where: { id: fx.instructor.id } });
  };

  await t.test("TEST 1: quiz-builder question WITH topic -> topic is persisted", async () => {
    const fx = await createBaseFixture("t1");
    try {
      const res = await request(app)
        .post("/questions/bulk")
        .set("Authorization", `Bearer ${fx.instructorToken}`)
        .send({
          quizId: fx.quiz.id,
          questions: [
            {
              question: "Which of these numbers is prime?",
              questionType: "MCQ",
              options: ["Nine", "Eleven", "Fifteen", "Twenty"],
              correctAnswer: "Eleven",
              marks: 1,
              topic: "arithmetic_primes",
            },
          ],
        });

      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.inserted, 1);

      const link = await prisma.quizQuestion.findFirst({
        where: { quizId: fx.quiz.id },
        include: { question: true },
      });
      assert.ok(link, "question must have been attached to the quiz");
      assert.equal(
        link.question.topic,
        "arithmetic_primes",
        "explicitly supplied topic must survive validation + normalization + persistence"
      );
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 2: quiz-builder question WITHOUT topic -> behavior is explicitly defined (stays NULL, not silently defaulted)", async () => {
    const fx = await createBaseFixture("t2");
    try {
      const res = await request(app)
        .post("/questions/bulk")
        .set("Authorization", `Bearer ${fx.instructorToken}`)
        .send({
          quizId: fx.quiz.id,
          questions: [
            {
              question: "What is the capital of France?",
              questionType: "MCQ",
              options: ["Paris", "London", "Berlin", "Madrid"],
              correctAnswer: "Paris",
              marks: 1,
              // topic intentionally omitted
            },
          ],
        });

      assert.equal(res.status, 201, JSON.stringify(res.body));

      const link = await prisma.quizQuestion.findFirst({
        where: { quizId: fx.quiz.id },
        include: { question: true },
      });
      assert.ok(link);
      // Explicit contract: an untagged question is stored as NULL, not
      // silently rewritten to "General"/"Uncategorized" at creation time.
      // The ambiguity is resolved exactly once, downstream, at the
      // KC-mapping layer in quiz.service.js — see TEST 4.
      assert.equal(link.question.topic, null);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 3: quiz submission maps to the intended KC (Question.topic)", async () => {
    const fx = await createBaseFixture("t3");
    try {
      const createRes = await request(app)
        .post("/questions/bulk")
        .set("Authorization", `Bearer ${fx.instructorToken}`)
        .send({
          quizId: fx.quiz.id,
          questions: [
            {
              question: "Which structure uses LIFO ordering?",
              questionType: "MCQ",
              options: ["Queue", "Stack", "Tree", "Graph"],
              correctAnswer: "Stack",
              marks: 1,
              topic: "data_structures_stack",
            },
          ],
        });
      assert.equal(createRes.status, 201, JSON.stringify(createRes.body));

      const link = await prisma.quizQuestion.findFirst({
        where: { quizId: fx.quiz.id },
        include: { question: true },
      });
      const question = link.question;
      assert.equal(question.topic, "data_structures_stack");

      const submitRes = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.studentToken}`)
        .send({ answers: [{ questionId: question.id, answer: "Stack" }] });

      assert.equal(submitRes.status, 201, JSON.stringify(submitRes.body));
      assert.equal(submitRes.body.data.score, 1);

      const mastery = await prisma.conceptMastery.findUnique({
        where: {
          studentId_concept: { studentId: fx.studentProfile.id, concept: "data_structures_stack" },
        },
      });
      assert.ok(mastery, "ConceptMastery must exist under the question's own topic, not a generic bucket");
      assert.equal(mastery.attemptsCount, 1);
    } finally {
      await cleanupFixture(fx);
    }
  });

  await t.test("TEST 4: two unrelated, untagged questions cannot collapse into the same KC", async () => {
    const fx = await createBaseFixture("t4");
    try {
      const createRes = await request(app)
        .post("/questions/bulk")
        .set("Authorization", `Bearer ${fx.instructorToken}`)
        .send({
          quizId: fx.quiz.id,
          questions: [
            { question: "Untagged question A", questionType: "MCQ", options: ["A", "B"], correctAnswer: "A", marks: 1 },
            { question: "Untagged question B", questionType: "MCQ", options: ["A", "B"], correctAnswer: "B", marks: 1 },
          ],
        });
      assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
      assert.equal(createRes.body.data.inserted, 2);

      const links = await prisma.quizQuestion.findMany({
        where: { quizId: fx.quiz.id },
        orderBy: { order: "asc" },
        include: { question: true },
      });
      assert.equal(links.length, 2);
      const questions = links.map((l) => l.question);
      assert.ok(questions.every((q) => q.topic === null), "both questions should be genuinely untagged");

      const submitRes = await request(app)
        .post(`/quizzes/${fx.quiz.id}/submit`)
        .set("Authorization", `Bearer ${fx.studentToken}`)
        .send({
          answers: [
            { questionId: questions[0].id, answer: "A" }, // correct
            { questionId: questions[1].id, answer: "A" }, // incorrect (correct is "B")
          ],
        });

      assert.equal(submitRes.status, 201, JSON.stringify(submitRes.body));

      const masteries = await prisma.conceptMastery.findMany({ where: { studentId: fx.studentProfile.id } });
      assert.equal(masteries.length, 2, "each untagged question must get its own isolated KC, not a shared bucket");

      const concepts = masteries.map((m) => m.concept).sort();
      assert.ok(!concepts.includes("Uncategorized"), "the old shared-bucket fallback must no longer be used");
      assert.deepEqual(concepts, [`question:${questions[0].id}`, `question:${questions[1].id}`].sort());

      // Different correctness outcomes on isolated KCs must diverge,
      // proving they are tracked independently rather than sharing state.
      const masteryA = masteries.find((m) => m.concept === `question:${questions[0].id}`);
      const masteryB = masteries.find((m) => m.concept === `question:${questions[1].id}`);
      assert.ok(
        masteryA.masteryScore > masteryB.masteryScore,
        `expected the correctly-answered question's isolated KC (${masteryA.masteryScore}) to exceed the incorrectly-answered one (${masteryB.masteryScore})`
      );
    } finally {
      await cleanupFixture(fx);
    }
  });
});
