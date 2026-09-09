const test = require("node:test");
const assert = require("node:assert");

const quizService = require("../src/modules/quizzes/quiz.service");
const { createQuizSchema, updateQuizSchema } = require("../src/modules/quizzes/quiz.validation");
const prisma = require("../src/config/database");

// The invariant under test: quizTag === "SELF_TEST" implies timeLimit === null,
// enforced in the service so no client can save a timed Self-Test.

test("createQuiz — a Self-Test is written untimed even when a limit is sent", async (t) => {
  const originals = {
    courseFindUnique: prisma.course.findUnique,
    contentFindFirst: prisma.content.findFirst,
    quizFindFirst: prisma.quiz.findFirst,
    quizFindUnique: prisma.quiz.findUnique,
    quizCreate: prisma.quiz.create,
  };

  t.after(() => {
    prisma.course.findUnique = originals.courseFindUnique;
    prisma.content.findFirst = originals.contentFindFirst;
    prisma.quiz.findFirst = originals.quizFindFirst;
    prisma.quiz.findUnique = originals.quizFindUnique;
    prisma.quiz.create = originals.quizCreate;
  });

  prisma.course.findUnique = async () => ({ id: "c1" });
  prisma.content.findFirst = async () => null;
  prisma.quiz.findFirst = async () => null;
  // createQuiz returns getQuizById(...) at the end -- stubbed so these stay
  // unit tests rather than quietly reaching the live database.
  prisma.quiz.findUnique = async () => ({ id: "q1", quizQuestions: [] });

  await t.test("SELF_TEST drops a supplied timeLimit", async () => {
    let captured = null;
    prisma.quiz.create = async ({ data }) => {
      captured = data;
      return { id: "q1", ...data };
    };

    await quizService.createQuiz({
      title: "Practice",
      courseId: "c1",
      quizTag: "SELF_TEST",
      passingScore: 50,
      timeLimit: 45,
    });

    assert.strictEqual(captured.quizTag, "SELF_TEST");
    assert.strictEqual(captured.timeLimit, null);
  });

  await t.test("FINAL keeps its timeLimit", async () => {
    let captured = null;
    prisma.quiz.create = async ({ data }) => {
      captured = data;
      return { id: "q2", ...data };
    };

    await quizService.createQuiz({
      title: "Assessment",
      courseId: "c1",
      quizTag: "FINAL",
      passingScore: 50,
      timeLimit: 45,
    });

    assert.strictEqual(captured.quizTag, "FINAL");
    assert.strictEqual(captured.timeLimit, 45);
  });

  await t.test("FINAL with the timer disabled stays untimed", async () => {
    let captured = null;
    prisma.quiz.create = async ({ data }) => {
      captured = data;
      return { id: "q3", ...data };
    };

    await quizService.createQuiz({
      title: "Untimed assessment",
      courseId: "c1",
      quizTag: "FINAL",
      passingScore: 50,
      timeLimit: null,
    });

    assert.strictEqual(captured.timeLimit, null);
  });
});

test("updateQuiz — the effective tag governs the time limit", async (t) => {
  const originals = {
    quizFindUnique: prisma.quiz.findUnique,
    quizUpdate: prisma.quiz.update,
  };

  t.after(() => {
    prisma.quiz.findUnique = originals.quizFindUnique;
    prisma.quiz.update = originals.quizUpdate;
  });

  const stubExisting = (row) => {
    prisma.quiz.findUnique = async () => row;
  };

  const captureUpdate = () => {
    const box = {};
    prisma.quiz.update = async ({ data }) => {
      box.data = data;
      return { id: "q1", ...data };
    };
    return box;
  };

  // The case a form cannot cover: the client sends only the new tag, so
  // there is no timeLimit key to null out -- it has to be derived.
  await t.test("FINAL -> SELF_TEST clears a stale timer with no timeLimit in the payload", async () => {
    stubExisting({ id: "q1", quizTag: "FINAL", timeLimit: 30 });
    const box = captureUpdate();

    await quizService.updateQuiz("q1", { quizTag: "SELF_TEST" });

    assert.strictEqual(box.data.quizTag, "SELF_TEST");
    assert.strictEqual(box.data.timeLimit, null);
  });

  await t.test("SELF_TEST -> FINAL accepts a newly enabled timer", async () => {
    stubExisting({ id: "q1", quizTag: "SELF_TEST", timeLimit: null });
    const box = captureUpdate();

    await quizService.updateQuiz("q1", { quizTag: "FINAL", timeLimit: 20 });

    assert.strictEqual(box.data.quizTag, "FINAL");
    assert.strictEqual(box.data.timeLimit, 20);
  });

  await t.test("an unrelated edit cannot resurrect a Self-Test's timer", async () => {
    stubExisting({ id: "q1", quizTag: "SELF_TEST", timeLimit: null });
    const box = captureUpdate();

    await quizService.updateQuiz("q1", { title: "Renamed", timeLimit: 30 });

    assert.strictEqual(box.data.timeLimit, null);
  });

  await t.test("a FINAL quiz's unrelated edit leaves its timer alone", async () => {
    stubExisting({ id: "q1", quizTag: "FINAL", timeLimit: 30 });
    const box = captureUpdate();

    await quizService.updateQuiz("q1", { title: "Renamed" });

    assert.strictEqual(box.data.timeLimit, undefined);
    assert.strictEqual(box.data.title, "Renamed");
  });
});

test("validation — the tag is required on create and constrained to two values", async (t) => {
  const base = { title: "Q", courseId: "c1" };

  await t.test("create rejects a missing quizTag", () => {
    const { error } = createQuizSchema.validate(base);
    assert.ok(error, "expected a validation error");
    assert.match(error.message, /quizTag/);
  });

  await t.test("create rejects an unknown tag", () => {
    const { error } = createQuizSchema.validate({ ...base, quizTag: "PRACTICE" });
    assert.ok(error, "expected a validation error");
    assert.match(error.message, /quizTag/);
  });

  await t.test("create accepts both valid tags", () => {
    for (const quizTag of ["SELF_TEST", "FINAL"]) {
      const { error } = createQuizSchema.validate({ ...base, quizTag });
      assert.strictEqual(error, undefined, `expected ${quizTag} to validate`);
    }
  });

  await t.test("update allows quizTag to be omitted", () => {
    const { error } = updateQuizSchema.validate({ title: "Renamed" });
    assert.strictEqual(error, undefined);
  });

  await t.test("update rejects an unknown tag", () => {
    const { error } = updateQuizSchema.validate({ quizTag: "PRACTICE" });
    assert.ok(error, "expected a validation error");
  });
});
