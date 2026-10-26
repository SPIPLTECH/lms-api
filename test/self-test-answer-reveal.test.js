const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const { previewFile } = require("../src/modules/questions/question.import.service");
const { normalizeQuestion } = require("../src/utils/helpers/question.helper");
const { bulkCreateQuestionsSchema } = require("../src/modules/questions/question.validation");

// The invariants under test:
//
//  1. A Self-Test is practice the student checks answer by answer, so its
//     answer key — the correct answer, its explanation, and each option's
//     reason for being wrong — is sent with the questions, flagged by
//     `revealAnswers`.
//  2. Every other quiz keeps all of that back, option reasons included: an
//     option carrying an explanation is an option that is wrong.
//  3. A Self-Test still never ships a hint.
//  4. Per-option reasons survive the import paths that feed the composer.

const WRONG_REASON = "func is used in Go and Swift. Python does not recognise it.";
const HINT = "Think about the keyword you type before the name.";

const buildQuiz = (quizTag) => ({
  id: "quiz-1",
  courseId: "course-1",
  title: "Python Basics",
  quizTag,
  lessonId: "lesson-1",
  topicId: null,
  passingScore: 70,
  attempts: quizTag === "SELF_TEST" ? 0 : 3,
  timeLimit: null,
  isPublished: true,
  quizQuestions: [
    {
      id: "qq-1",
      order: 1,
      marks: 1,
      isMandatory: true,
      question: {
        id: "q1",
        question: "Which keyword starts a function definition in Python?",
        questionType: "MCQ_SINGLE",
        options: [{ optionText: "def" }, { optionText: "func", explanation: WRONG_REASON }],
        correctAnswer: "def",
        explanation: "Python uses def, then the name and parentheses.",
        hint: HINT,
        marks: 1
      }
    }
  ]
});

function stubQuiz(t, { quiz, submittedAttempts = 0 }) {
  const originals = {
    quizFindUnique: prisma.quiz.findUnique,
    attemptCount: prisma.quizAttempt.count,
    submissionFindUnique: prisma.quizSubmission.findUnique
  };
  t.after(() => {
    prisma.quiz.findUnique = originals.quizFindUnique;
    prisma.quizAttempt.count = originals.attemptCount;
    prisma.quizSubmission.findUnique = originals.submissionFindUnique;
  });
  prisma.quiz.findUnique = async () => quiz;
  prisma.quizAttempt.count = async () => submittedAttempts;
  prisma.quizSubmission.findUnique = async () => null;
}

test("Self-Test — a student gets the answer key, the explanation and each option's reason", async (t) => {
  stubQuiz(t, { quiz: buildQuiz("SELF_TEST") });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");
  const q1 = result.questions[0];

  assert.strictEqual(result.revealAnswers, true);
  assert.strictEqual(q1.correctAnswer, "def");
  assert.strictEqual(q1.explanation, "Python uses def, then the name and parentheses.");
  assert.deepStrictEqual(q1.options, [{ optionText: "def" }, { optionText: "func", explanation: WRONG_REASON }]);
});

test("Self-Test — still no hint, on any attempt", async (t) => {
  stubQuiz(t, { quiz: buildQuiz("SELF_TEST"), submittedAttempts: 3 });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");

  assert.ok(!JSON.stringify(result).includes(HINT));
});

for (const quizTag of ["FINAL", "QUALIFYING"]) {
  test(`${quizTag} — nothing of the answer key is sent, option reasons included`, async (t) => {
    stubQuiz(t, { quiz: buildQuiz(quizTag) });

    const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");
    const q1 = result.questions[0];

    assert.strictEqual(result.revealAnswers, false);
    assert.ok(!("correctAnswer" in q1));
    assert.ok(!("explanation" in q1));
    // Bare option text only, in no particular order.
    assert.deepStrictEqual([...q1.options].sort(), ["def", "func"]);
    assert.ok(!JSON.stringify(result).includes(WRONG_REASON), "no option reason anywhere in the payload");
  });
}

// ---------------------------------------------------------------------------
// Nothing in a graded quiz's options points at the answer
// ---------------------------------------------------------------------------

const gradedQuizWith = (question) => ({ ...buildQuiz("FINAL"), quizQuestions: [{ id: "qq-1", order: 1, marks: 1, isMandatory: true, question }] });

test("FINAL — option flags (isCorrect, misconceptionTag, id) never reach the student", async (t) => {
  stubQuiz(t, {
    quiz: gradedQuizWith({
      id: "q1",
      question: "Pick the prime",
      questionType: "MCQ_SINGLE",
      options: [
        { id: "opt-1", optionText: "7", isCorrect: true },
        { id: "opt-2", optionText: "9", isCorrect: false, misconceptionTag: "CONCEPTUAL_MISAPPLICATION" }
      ],
      correctAnswer: "7"
    })
  });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");
  const payload = JSON.stringify(result);

  assert.deepStrictEqual([...result.questions[0].options].sort(), ["7", "9"]);
  for (const leak of ["isCorrect", "misconceptionTag", "opt-1", "CONCEPTUAL_MISAPPLICATION"]) {
    assert.ok(!payload.includes(leak), `${leak} must not appear in the payload`);
  }
});

// The order of these is itself the answer, so it must not survive. Shuffling
// can land on the original order by chance; over 20 reads of 6 items that
// happens with probability (1/720)^20, so "always the authored order" means
// it was never shuffled.
const alwaysInAuthoredOrder = async (t, question, pick, authored) => {
  stubQuiz(t, { quiz: gradedQuizWith(question) });
  for (let i = 0; i < 20; i++) {
    const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");
    if (JSON.stringify(pick(result.questions[0].options)) !== JSON.stringify(authored)) return false;
  }
  return true;
};

test("FINAL — arrange-tokens options are not sent in their correct order", async (t) => {
  const tokens = ["a", "b", "c", "d", "e", "f"];
  const leaked = await alwaysInAuthoredOrder(
    t,
    { id: "q1", question: "Order these", questionType: "ARRANGE_TOKENS", options: tokens, correctAnswer: tokens },
    (options) => options,
    tokens
  );
  assert.strictEqual(leaked, false);
});

test("FINAL — match-pairs right column is not sent aligned with the left", async (t) => {
  const left = ["1", "2", "3", "4", "5", "6"];
  const right = ["one", "two", "three", "four", "five", "six"];
  const leaked = await alwaysInAuthoredOrder(
    t,
    {
      id: "q1",
      question: "Match",
      questionType: "MATCH_PAIRS",
      options: { left, right },
      correctAnswer: Object.fromEntries(left.map((l, i) => [l, right[i]]))
    },
    (options) => options.right,
    right
  );
  assert.strictEqual(leaked, false);
});

// ---------------------------------------------------------------------------
// The question-bank read routes are for authors only
// ---------------------------------------------------------------------------

test("a student cannot read questions through the question-bank routes", () => {
  const router = require("../src/modules/questions/question.routes");
  const reads = router.stack.filter((layer) => layer.route && layer.route.methods.get);
  assert.ok(reads.length >= 3, "the read routes are still there");

  // checkRole() returns an unnamed function; it is the route's only one.
  const runGuard = (guard, role) => {
    let outcome = null;
    const res = { status: (code) => ({ json: () => { outcome = code; } }) };
    guard.handle({ user: { role } }, res, () => { outcome = "next"; });
    return outcome;
  };

  for (const layer of reads) {
    const guard = layer.route.stack.find((s) => s.name === "<anonymous>" || s.name === "");
    assert.ok(guard, `GET ${layer.route.path} has a role guard`);
    assert.strictEqual(runGuard(guard, "STUDENT"), 403, `GET ${layer.route.path} refuses a student`);
    assert.strictEqual(runGuard(guard, "INSTRUCTOR"), "next", `GET ${layer.route.path} lets an instructor through`);
  }
});

test("a qualifying test's second attempt unlocks the hint but not the option reasons", async (t) => {
  stubQuiz(t, { quiz: buildQuiz("QUALIFYING"), submittedAttempts: 1 });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");

  assert.strictEqual(result.questions[0].hint, HINT);
  assert.ok(!JSON.stringify(result).includes(WRONG_REASON));
});

test("an instructor sees option reasons on every kind of quiz", async (t) => {
  stubQuiz(t, { quiz: buildQuiz("FINAL") });

  const result = await quizService.getQuizById("quiz-1", "INSTRUCTOR", null);

  assert.strictEqual(result.questions[0].options[1].explanation, WRONG_REASON);
  assert.strictEqual(result.revealAnswers, undefined);
});

// ---------------------------------------------------------------------------
// Authoring and import paths
// ---------------------------------------------------------------------------

test("normalizeQuestion keeps an option object's explanation and drops an empty one", () => {
  const q = normalizeQuestion({
    question: "Q",
    questionType: "MCQ_SINGLE",
    options: [{ optionText: "def" }, { optionText: "func", explanation: `  ${WRONG_REASON}  ` }, { optionText: "fn", explanation: " " }],
    correctAnswer: "def"
  });

  assert.deepStrictEqual(q.options, [
    { optionText: "def" },
    { optionText: "func", explanation: WRONG_REASON },
    { optionText: "fn" }
  ]);
  assert.strictEqual(q.correctAnswer, "def");
});

test("normalizeQuestion reads optionX_explanation spreadsheet columns", () => {
  const q = normalizeQuestion({
    question: "Which planet is known as the Red Planet?",
    optionA: "Venus",
    optionB: "Mars",
    optionA_explanation: "Venus looks yellow-white.",
    optionB_explanation: "",
    correctAnswer: "B"
  });

  assert.deepStrictEqual(q.options, [{ optionText: "Venus", explanation: "Venus looks yellow-white." }, "Mars"]);
  assert.strictEqual(q.correctAnswer, "Mars");
});

test("the composer's bulk save accepts an option with an explanation", () => {
  const { error } = bulkCreateQuestionsSchema.validate({
    questions: [{ question: "Q", options: [{ optionText: "def" }, { optionText: "func", explanation: WRONG_REASON }] }]
  });
  assert.ifError(error);
});

test("the composer's import preview returns option reasons index-aligned with the options", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "self-test-reveal-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const csvPath = path.join(dir, "q.csv");
  fs.writeFileSync(
    csvPath,
    'question,optionA,optionB,correctAnswer,optionA_explanation\n"Red Planet?",Venus,Mars,B,"Venus looks yellow-white."\n'
  );
  const jsonPath = path.join(dir, "q.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify([{ question: "Keyword?", options: [{ optionText: "func", explanation: WRONG_REASON }, { optionText: "def" }], correctAnswer: "def" }])
  );

  const fromCsv = await previewFile({ path: csvPath, size: fs.statSync(csvPath).size, originalname: "q.csv" });
  assert.deepStrictEqual(fromCsv.questions[0].options, ["Venus", "Mars"]);
  assert.deepStrictEqual(fromCsv.questions[0].optionExplanations, ["Venus looks yellow-white.", ""]);
  assert.strictEqual(fromCsv.questions[0].correctAnswer, "Mars");

  const fromJson = await previewFile({ path: jsonPath, size: fs.statSync(jsonPath).size, originalname: "q.json" });
  assert.deepStrictEqual(fromJson.questions[0].options, ["func", "def"]);
  assert.deepStrictEqual(fromJson.questions[0].optionExplanations, [WRONG_REASON, ""]);
});
