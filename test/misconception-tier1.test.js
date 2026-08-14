const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const { MISCONCEPTION_TAXONOMY } = require("../src/modules/learner-model/misconceptionTaxonomy.config");
const { mintAccessToken } = require("./helpers/authToken");

/**
 * Phase 7A — Schema + deterministic Tier 1 misconception detection.
 *
 * Covers: the pure resolveMisconceptionTag algorithm, taxonomy enforcement
 * at question-authoring time (both the single-question Repository path and
 * the bulk/import "quiz builder" path), and the full real-HTTP quiz→
 * evidence→KnowledgeGap flow for authored tags. No LLM anywhere in this
 * file — Tier 2 does not exist yet.
 */
test("Phase 7A — Misconception Taxonomy & Tier 1 Deterministic Detection", async (t) => {
  await t.test("resolveMisconceptionTag — pure algorithm", async (tt) => {
    await tt.test("exact match on a tagged distractor returns the tag", () => {
      const options = [
        { optionText: "Queue", isCorrect: false, misconceptionTag: "FIFO_LIFO_CONFUSION" },
        { optionText: "Stack", isCorrect: true },
      ];
      assert.equal(quizService.resolveMisconceptionTag(options, "Queue"), "FIFO_LIFO_CONFUSION");
    });

    await tt.test("case/whitespace-insensitive match still resolves the tag", () => {
      const options = [
        { optionText: "Queue", misconceptionTag: "FIFO_LIFO_CONFUSION" },
        { optionText: "Stack", isCorrect: true },
      ];
      assert.equal(quizService.resolveMisconceptionTag(options, "  QUEUE  "), "FIFO_LIFO_CONFUSION");
    });

    await tt.test("duplicate option text is ambiguous — never guesses", () => {
      const options = [
        { optionText: "Queue", misconceptionTag: "FIFO_LIFO_CONFUSION" },
        { optionText: "Queue", misconceptionTag: "OFF_BY_ONE_ERROR" },
        { optionText: "Stack", isCorrect: true },
      ];
      assert.equal(quizService.resolveMisconceptionTag(options, "Queue"), null);
    });

    await tt.test("no matching option returns null", () => {
      const options = [{ optionText: "Queue" }, { optionText: "Stack" }];
      assert.equal(quizService.resolveMisconceptionTag(options, "Tree"), null);
    });

    await tt.test("malformed entries are skipped individually, never crash resolution", () => {
      const options = [null, 42, { optionText: "Queue", misconceptionTag: "FIFO_LIFO_CONFUSION" }, { notText: "x" }];
      assert.equal(quizService.resolveMisconceptionTag(options, "Queue"), "FIFO_LIFO_CONFUSION");
    });

    await tt.test("malformed options container returns null", () => {
      assert.equal(quizService.resolveMisconceptionTag(null, "Queue"), null);
      assert.equal(quizService.resolveMisconceptionTag("not-an-array", "Queue"), null);
      assert.equal(quizService.resolveMisconceptionTag([], "Queue"), null);
      assert.equal(quizService.resolveMisconceptionTag(undefined, "Queue"), null);
    });

    await tt.test("legacy plain-string options never carry a tag", () => {
      const options = ["Queue", "Stack", "Tree", "Graph"];
      assert.equal(quizService.resolveMisconceptionTag(options, "Queue"), null);
    });

    await tt.test("object option with an unknown/invalid tag is rejected", () => {
      const options = [{ optionText: "Queue", misconceptionTag: "NOT_A_REAL_TAXONOMY_TYPE" }];
      assert.equal(quizService.resolveMisconceptionTag(options, "Queue"), null);
    });

    await tt.test("object option with no misconceptionTag returns null", () => {
      const options = [{ optionText: "Queue" }, { optionText: "Stack", isCorrect: true }];
      assert.equal(quizService.resolveMisconceptionTag(options, "Queue"), null);
    });

    await tt.test("non-string answers (MCQ_MULTI/MATCH_PAIRS shapes) never resolve a tag", () => {
      const options = [{ optionText: "Queue", misconceptionTag: "FIFO_LIFO_CONFUSION" }];
      assert.equal(quizService.resolveMisconceptionTag(options, ["Queue"]), null);
      assert.equal(quizService.resolveMisconceptionTag(options, { a: "Queue" }), null);
    });
  });

  // ------------------------------------------------------------------
  // HTTP fixtures shared by the authoring + end-to-end groups below.
  // ------------------------------------------------------------------
  const createBaseFixture = async (suffix) => {
    const instructor = await prisma.user.create({
      data: {
        name: `Tier1 Instructor ${suffix}`,
        email: `tier1_instructor_${suffix}_${Date.now()}@test.com`,
        password: "hashedpassword123",
        role: "INSTRUCTOR",
      },
    });
    const course = await prisma.course.create({
      data: { title: `Tier1 Course ${suffix}`, creatorId: instructor.id },
    });
    const quiz = await prisma.quiz.create({
      data: { title: `Tier1 Quiz ${suffix}`, passingScore: 50, courseId: course.id },
    });
    const studentUser = await prisma.user.create({
      data: {
        name: `Tier1 Student ${suffix}`,
        email: `tier1_student_${suffix}_${Date.now()}@test.com`,
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

  // Questions created via the bulk HTTP endpoint aren't guaranteed to carry
  // courseId (a separate, pre-existing gap, out of scope here), so cleanup
  // walks the QuizQuestion junction rather than filtering by courseId.
  const cleanupFixture = async (fx) => {
    if (!fx) return;
    const links = await prisma.quizQuestion.findMany({
      where: { quizId: fx.quiz.id },
      select: { questionId: true },
    });
    const questionIds = links.map((l) => l.questionId);

    await prisma.quizSubmission.deleteMany({ where: { studentId: fx.studentProfile.id } });
    await prisma.knowledgeGap.deleteMany({ where: { studentId: fx.studentProfile.id } });
    await prisma.conceptMastery.deleteMany({ where: { studentId: fx.studentProfile.id } });
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

  await t.test("Authoring — HTTP validation against the taxonomy", async (tt) => {
    await tt.test("POST /questions/bulk: a valid misconceptionTag is accepted and persisted", async () => {
      const fx = await createBaseFixture("bulk_valid");
      try {
        const res = await request(app)
          .post("/questions/bulk")
          .set("Authorization", `Bearer ${fx.instructorToken}`)
          .send({
            quizId: fx.quiz.id,
            questions: [
              {
                question: "Which data structure uses LIFO ordering?",
                questionType: "MCQ_SINGLE",
                options: [
                  { optionText: "Queue", isCorrect: false, misconceptionTag: "FIFO_LIFO_CONFUSION" },
                  { optionText: "Stack", isCorrect: true },
                  { optionText: "Tree", isCorrect: false },
                  { optionText: "Graph", isCorrect: false },
                ],
                correctAnswer: "Stack",
                marks: 1,
                topic: "tier1_authoring_kc",
              },
            ],
          });

        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.data.inserted, 1);

        const link = await prisma.quizQuestion.findFirst({
          where: { quizId: fx.quiz.id },
          include: { question: true },
        });
        assert.ok(link);
        const persistedOptions = link.question.options;
        assert.ok(Array.isArray(persistedOptions));
        const queueOption = persistedOptions.find((o) => o && o.optionText === "Queue");
        assert.ok(queueOption, "object-shaped option must survive normalization, not be coerced to a string");
        assert.equal(queueOption.misconceptionTag, "FIFO_LIFO_CONFUSION");
      } finally {
        await cleanupFixture(fx);
      }
    });

    await tt.test("POST /questions/bulk: an unknown misconceptionTag is rejected with 400", async () => {
      const fx = await createBaseFixture("bulk_invalid");
      try {
        const res = await request(app)
          .post("/questions/bulk")
          .set("Authorization", `Bearer ${fx.instructorToken}`)
          .send({
            quizId: fx.quiz.id,
            questions: [
              {
                question: "Which data structure uses LIFO ordering?",
                questionType: "MCQ_SINGLE",
                options: [
                  { optionText: "Queue", isCorrect: false, misconceptionTag: "MADE_UP_TYPE" },
                  { optionText: "Stack", isCorrect: true },
                ],
                correctAnswer: "Stack",
                marks: 1,
              },
            ],
          });

        assert.equal(res.status, 400, JSON.stringify(res.body));
        assert.equal(res.body.success, false);

        const link = await prisma.quizQuestion.findFirst({ where: { quizId: fx.quiz.id } });
        assert.equal(link, null, "the rejected question must never have been created");
      } finally {
        await cleanupFixture(fx);
      }
    });

    await tt.test("POST /questions (single, Question Repository): a valid misconceptionTag is accepted and persisted", async () => {
      const fx = await createBaseFixture("single_valid");
      try {
        const res = await request(app)
          .post("/questions")
          .set("Authorization", `Bearer ${fx.instructorToken}`)
          .send({
            title: "LIFO question",
            question: "Which data structure uses LIFO ordering?",
            options: [
              { optionText: "Queue", isCorrect: false, misconceptionTag: "FIFO_LIFO_CONFUSION" },
              { optionText: "Stack", isCorrect: true },
            ],
            correctAnswer: "Stack",
            marks: 1,
          });

        assert.equal(res.status, 201, JSON.stringify(res.body));
        const questionId = res.body.data.id;
        const persisted = await prisma.question.findUnique({ where: { id: questionId } });
        const queueOption = persisted.options.find((o) => o && o.optionText === "Queue");
        assert.equal(queueOption.misconceptionTag, "FIFO_LIFO_CONFUSION");

        await prisma.question.delete({ where: { id: questionId } });
      } finally {
        await cleanupFixture(fx);
      }
    });

    await tt.test("POST /questions (single): an unknown misconceptionTag is rejected with 400", async () => {
      const fx = await createBaseFixture("single_invalid");
      try {
        const res = await request(app)
          .post("/questions")
          .set("Authorization", `Bearer ${fx.instructorToken}`)
          .send({
            title: "LIFO question",
            question: "Which data structure uses LIFO ordering?",
            options: [
              { optionText: "Queue", isCorrect: false, misconceptionTag: "MADE_UP_TYPE" },
              { optionText: "Stack", isCorrect: true },
            ],
            correctAnswer: "Stack",
            marks: 1,
          });

        assert.equal(res.status, 400, JSON.stringify(res.body));
      } finally {
        await cleanupFixture(fx);
      }
    });
  });

  await t.test("End-to-end — real HTTP quiz submission drives Tier 1 detection", async (tt) => {
    const authorTaggedQuestion = async (fx, { topic }) => {
      const res = await request(app)
        .post("/questions/bulk")
        .set("Authorization", `Bearer ${fx.instructorToken}`)
        .send({
          quizId: fx.quiz.id,
          questions: [
            {
              question: "Which data structure uses LIFO ordering?",
              questionType: "MCQ_SINGLE",
              options: [
                { optionText: "Queue", isCorrect: false, misconceptionTag: "FIFO_LIFO_CONFUSION" },
                { optionText: "Stack", isCorrect: true },
                { optionText: "Tree", isCorrect: false },
                { optionText: "Graph", isCorrect: false },
              ],
              correctAnswer: "Stack",
              marks: 1,
              topic,
            },
          ],
        });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const link = await prisma.quizQuestion.findFirst({
        where: { quizId: fx.quiz.id },
        include: { question: true },
      });
      return link.question;
    };

    await tt.test("wrong answer on the TAGGED distractor creates a fully-populated KnowledgeGap", async () => {
      const fx = await createBaseFixture("e2e_tagged");
      try {
        const question = await authorTaggedQuestion(fx, { topic: "tier1_e2e_kc_a" });

        const submitRes = await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.studentToken}`)
          .send({ answers: [{ questionId: question.id, answer: "Queue" }] });

        assert.equal(submitRes.status, 201, JSON.stringify(submitRes.body));
        assert.equal(submitRes.body.data.score, 0);

        const gap = await prisma.knowledgeGap.findFirst({
          where: { studentId: fx.studentProfile.id, concept: "FIFO_LIFO_CONFUSION" },
        });
        assert.ok(gap, "Tier 1 must create a KnowledgeGap for the tagged wrong answer");
        assert.equal(gap.kc, "tier1_e2e_kc_a");
        assert.equal(gap.type, "FIFO_LIFO_CONFUSION");
        assert.equal(gap.description, MISCONCEPTION_TAXONOMY.FIFO_LIFO_CONFUSION.description);
        assert.equal(gap.confidence, 1.0);
        assert.equal(gap.evidence, 'Selected "Queue" for question: "Which data structure uses LIFO ordering?"');
        // Existing, unchanged severity formula: a single incorrect answer
        // with hintsUsed=0 (the quiz path never sets hints) is
        // INITIAL_INCORRECT_WEIGHT alone.
        assert.equal(gap.severity, 0.12);
        assert.equal(gap.status, "CLOSED"); // 0.12 < OPEN_THRESHOLD (0.35) — unchanged threshold
      } finally {
        await cleanupFixture(fx);
      }
    });

    await tt.test("wrong answer on an UNTAGGED distractor creates no misconception (no Tier 2 yet)", async () => {
      const fx = await createBaseFixture("e2e_untagged");
      try {
        const question = await authorTaggedQuestion(fx, { topic: "tier1_e2e_kc_b" });

        // "Tree" carries no misconceptionTag.
        const submitRes = await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.studentToken}`)
          .send({ answers: [{ questionId: question.id, answer: "Tree" }] });

        assert.equal(submitRes.status, 201, JSON.stringify(submitRes.body));

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: fx.studentProfile.id } });
        assert.equal(gaps.length, 0, "an untagged wrong answer must not create a KnowledgeGap in Phase 7A");

        // BKT/mastery must still work normally regardless.
        const mastery = await prisma.conceptMastery.findUnique({
          where: { studentId_concept: { studentId: fx.studentProfile.id, concept: "tier1_e2e_kc_b" } },
        });
        assert.ok(mastery);
        assert.equal(mastery.attemptsCount, 1);
      } finally {
        await cleanupFixture(fx);
      }
    });

    await tt.test("correct answer never attempts misconception resolution, even on a tagged question", async () => {
      const fx = await createBaseFixture("e2e_correct");
      try {
        const question = await authorTaggedQuestion(fx, { topic: "tier1_e2e_kc_c" });

        const submitRes = await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.studentToken}`)
          .send({ answers: [{ questionId: question.id, answer: "Stack" }] });

        assert.equal(submitRes.status, 201, JSON.stringify(submitRes.body));
        assert.equal(submitRes.body.data.score, 1);

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: fx.studentProfile.id } });
        assert.equal(gaps.length, 0);
      } finally {
        await cleanupFixture(fx);
      }
    });

    await tt.test("repeated wrong answers on the same tag accumulate severity via the UNCHANGED formula, crossing OPEN", async () => {
      const fx = await createBaseFixture("e2e_repeat");
      try {
        const question = await authorTaggedQuestion(fx, { topic: "tier1_e2e_kc_d" });

        await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.studentToken}`)
          .send({ answers: [{ questionId: question.id, answer: "Queue" }] });

        const afterFirst = await prisma.knowledgeGap.findFirst({
          where: { studentId: fx.studentProfile.id, concept: "FIFO_LIFO_CONFUSION" },
        });
        assert.equal(afterFirst.status, "CLOSED");
        assert.equal(afterFirst.severity, 0.12);

        await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.studentToken}`)
          .send({ answers: [{ questionId: question.id, answer: "Queue" }] });

        const afterSecond = await prisma.knowledgeGap.findFirst({
          where: { studentId: fx.studentProfile.id, concept: "FIFO_LIFO_CONFUSION" },
        });
        assert.ok(
          afterSecond.severity > afterFirst.severity,
          `expected severity to keep climbing (${afterFirst.severity} -> ${afterSecond.severity})`
        );
        assert.equal(afterSecond.status, "OPEN", "two consecutive tagged errors must cross the unchanged 0.35 OPEN threshold");
        // Metadata columns refresh on each update (current-row pattern, same as severity/status).
        assert.equal(afterSecond.type, "FIFO_LIFO_CONFUSION");
        assert.equal(afterSecond.confidence, 1.0);
      } finally {
        await cleanupFixture(fx);
      }
    });

    await tt.test("legacy plain-string-options question is fully unaffected (backward compatibility)", async () => {
      const fx = await createBaseFixture("e2e_legacy");
      try {
        const createRes = await request(app)
          .post("/questions/bulk")
          .set("Authorization", `Bearer ${fx.instructorToken}`)
          .send({
            quizId: fx.quiz.id,
            questions: [
              {
                question: "Which data structure uses FIFO ordering?",
                questionType: "MCQ_SINGLE",
                options: ["Queue", "Stack", "Tree", "Graph"],
                correctAnswer: "Queue",
                marks: 1,
                topic: "tier1_e2e_kc_legacy",
              },
            ],
          });
        assert.equal(createRes.status, 201, JSON.stringify(createRes.body));

        const link = await prisma.quizQuestion.findFirst({
          where: { quizId: fx.quiz.id },
          include: { question: true },
        });
        assert.ok(link.question.options.every((o) => typeof o === "string"), "legacy questions stay plain strings");

        const submitRes = await request(app)
          .post(`/quizzes/${fx.quiz.id}/submit`)
          .set("Authorization", `Bearer ${fx.studentToken}`)
          .send({ answers: [{ questionId: link.question.id, answer: "Stack" }] });

        assert.equal(submitRes.status, 201, JSON.stringify(submitRes.body));
        assert.equal(submitRes.body.data.score, 0);

        const gaps = await prisma.knowledgeGap.findMany({ where: { studentId: fx.studentProfile.id } });
        assert.equal(gaps.length, 0, "no tag was ever possible on a legacy question — zero behavior change");

        const mastery = await prisma.conceptMastery.findUnique({
          where: { studentId_concept: { studentId: fx.studentProfile.id, concept: "tier1_e2e_kc_legacy" } },
        });
        assert.ok(mastery, "BKT/mastery must still work exactly as before Phase 7A");
      } finally {
        await cleanupFixture(fx);
      }
    });
  });
});
