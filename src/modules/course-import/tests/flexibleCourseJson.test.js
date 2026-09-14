const test = require("node:test");
const assert = require("node:assert/strict");

const { parseCourseJson, buildValidationReport } = require("../services/flexibleCourseJson.service");
const template = require("../fixtures/course_json_template.json");

const clone = (value) => JSON.parse(JSON.stringify(value));
const html = (text) => ({ type: "HTML", title: text, htmlContent: `<p>${text}</p>` });
const mcq = (question = "2 + 2?") => ({ question, questionType: "MCQ_SINGLE", options: ["3", "4"], correctAnswer: "4" });

test("the reference template itself is valid, with every level counted", () => {
  const result = parseCourseJson(clone(template));

  assert.deepEqual(result.errors, []);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.summary, { modules: 2, lessons: 2, topics: 3, contents: 9, quizzes: 8, questions: 13, assignments: 8 });

  const { canonical } = result;
  assert.equal(canonical.metadata.title, "Introduction to Physics");
  assert.equal(canonical.metadata.level, "Beginner", "course fields are kept as written");
  assert.deepEqual(canonical.settings, { visibility: "PUBLIC", certificatesEnabled: false, discussionEnabled: true });
  assert.equal(canonical.contents.length, 2, "course-level content stays on the course");
  assert.equal(canonical.quizzes[0].quizTag, "COURSE_ASSESSMENT");
  assert.equal(canonical.assignments[0].title, "Introduction to Physics Final Assignment");
  assert.equal(canonical.modules[0].contents[0].title, "Introduction to Measurement", "module-level content stays on the module");
  assert.equal(canonical.modules[0].lessons[0].contents[0].title, "Physical Quantities", "lesson-level content stays on the lesson");
});

test("symbolic IDs in the template resolve to the entities they describe", () => {
  const { canonical } = parseCourseJson(clone(template));

  assert.deepEqual(canonical.modules.map((m) => m.id), ["physics_mod_1", "physics_mod_2"]);
  assert.equal(canonical.modules[0].lessons[0].id, "physics_lesson_1");
  assert.equal(canonical.modules[0].lessons[0].topics[0].id, "physics_topic_1");
  assert.equal(canonical.modules[0].lessons[0].topics[1].id, undefined, "a topic nothing refers to gets no invented ID");
  assert.equal(canonical.modules[0].lessons[0].topics[0].quizzes[0].topicId, "physics_topic_1", "reference fields are preserved");
});

test("canonical output parses to the same course again", () => {
  const first = parseCourseJson(clone(template));
  const second = parseCourseJson(clone(first.canonical));

  assert.equal(second.isValid, true);
  assert.deepEqual(second.canonical, first.canonical);
});

test("any subset of the hierarchy is valid, and nothing is added to it", async (t) => {
  const cases = {
    "course-level content without modules": {
      json: { course: { title: "C" }, content: [html("Intro")] },
      summary: { modules: 0, lessons: 0, topics: 0, contents: 1, quizzes: 0, questions: 0, assignments: 0 },
    },
    "a module with content and no lessons": {
      json: { course: { title: "C" }, modules: [{ title: "M", content: [html("Module intro")] }] },
      summary: { modules: 1, lessons: 0, topics: 0, contents: 1, quizzes: 0, questions: 0, assignments: 0 },
    },
    "a lesson with content and no topics": {
      json: { course: { title: "C" }, modules: [{ title: "M", lessons: [{ title: "L", content: [html("Lesson body")] }] }] },
      summary: { modules: 1, lessons: 1, topics: 0, contents: 1, quizzes: 0, questions: 0, assignments: 0 },
    },
    "a topic with no quiz or assignment": {
      json: { course: { title: "C" }, modules: [{ title: "M", lessons: [{ title: "L", topics: [{ title: "T", content: [html("x")] }] }] }] },
      summary: { modules: 1, lessons: 1, topics: 1, contents: 1, quizzes: 0, questions: 0, assignments: 0 },
    },
    "a lesson quiz with no assignment": {
      json: { course: { title: "C" }, modules: [{ title: "M", lessons: [{ title: "L", quiz: { title: "Q", quizTag: "LESSON_ASSESSMENT", questions: [mcq()] } }] }] },
      summary: { modules: 1, lessons: 1, topics: 0, contents: 0, quizzes: 1, questions: 1, assignments: 0 },
    },
    "a module assignment with no module quiz": {
      json: { course: { title: "C" }, modules: [{ title: "M", assignment: { title: "A", dueDate: "2026-12-01T23:59:00.000Z" } }] },
      summary: { modules: 1, lessons: 0, topics: 0, contents: 0, quizzes: 0, questions: 0, assignments: 1 },
    },
    "modules with different structures": {
      json: {
        course: { title: "C" },
        modules: [
          { title: "With topics", lessons: [{ title: "L1", topics: [{ title: "T1" }] }] },
          { title: "Content only", content: [html("just reading")] },
          { title: "Lesson content", lessons: [{ title: "L2", content: [html("no topics here")] }] },
        ],
      },
      summary: { modules: 3, lessons: 2, topics: 1, contents: 2, quizzes: 0, questions: 0, assignments: 0 },
    },
  };

  for (const [name, { json, summary }] of Object.entries(cases)) {
    await t.test(name, () => {
      const result = parseCourseJson(json);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.summary, summary);
    });
  }
});

test("a course with only its details is valid but flagged", () => {
  const result = parseCourseJson({ course: { title: "Just a shell" } });

  assert.equal(result.isValid, true);
  assert.match(result.warnings.join("\n"), /no content, modules, quizzes or assignments/);
});

test("the V2 spelling and the template spelling describe the same course", () => {
  const templateSpelling = {
    course: { title: "Same", visibility: "PRIVATE" },
    modules: [{ title: "M", lessons: [{ title: "L", topics: [{ title: "T", content: [html("x")], quiz: { title: "Q", questions: [mcq()] } }] }] }],
  };
  const v2Spelling = {
    metadata: { title: "Same" },
    settings: { visibility: "PRIVATE" },
    modules: [{ title: "M", lessons: [{ title: "L", topics: [{ title: "T", contents: [html("x")], quizzes: [{ title: "Q", questions: [mcq()] }] }] }] }],
  };

  const a = parseCourseJson(templateSpelling).canonical;
  const b = parseCourseJson(v2Spelling).canonical;
  assert.deepEqual(a.modules, b.modules);
  assert.deepEqual(a.settings, b.settings);
});

test("orders: given orders are kept, positions fill in when none are given, duplicates are rejected", async (t) => {
  await t.test("given orders are kept and the array is not rearranged", () => {
    const { canonical } = parseCourseJson({ course: { title: "C" }, modules: [{ title: "Second", order: 2 }, { title: "First", order: 1 }] });
    assert.deepEqual(canonical.modules.map((m) => [m.title, m.order]), [["Second", 2], ["First", 1]]);
  });

  await t.test("no orders at all means array position", () => {
    const { canonical } = parseCourseJson({ course: { title: "C" }, content: [html("a"), html("b"), html("c")] });
    assert.deepEqual(canonical.contents.map((c) => c.order), [1, 2, 3]);
  });

  await t.test("an unordered sibling goes after the ordered ones, with a warning", () => {
    const result = parseCourseJson({ course: { title: "C" }, modules: [{ title: "A", order: 3 }, { title: "B" }] });
    assert.deepEqual(result.canonical.modules.map((m) => m.order), [3, 4]);
    assert.match(result.warnings.join("\n"), /modules\[1\] has no order; it was placed after its ordered siblings as order 4/);
  });

  await t.test("duplicate sibling orders are an error naming both", () => {
    const result = parseCourseJson({ course: { title: "C" }, modules: [{ title: "M", lessons: [{ title: "A", order: 1 }, { title: "B", order: 1 }] }] });
    assert.equal(result.isValid, false);
    assert.deepEqual(result.errors, ["modules[0].lessons: order 1 is used by both modules[0].lessons[0] and modules[0].lessons[1]. Sibling orders must be unique."]);
  });
});

test("errors name the exact path in the user's own keys, and only for what is actually wrong", () => {
  const result = parseCourseJson({
    course: { description: "no title" },
    content: [{ title: "No type, nothing to infer it from" }],
    modules: [
      {
        title: "M",
        content: [{ type: "HOLOGRAM", title: "Unsupported" }],
        lessons: [
          {
            title: "L",
            quiz: { title: "Q", quizTag: "MIDTERM", questions: [{ question: "Pick", options: ["A", "B"], correctAnswer: "C" }] },
            assignment: { title: "No due date" },
          },
        ],
      },
    ],
  });

  assert.equal(result.isValid, false);
  assert.deepEqual(result.errors, [
    "course.title is required.",
    'content[0].type is required (for example "HTML", "VIDEO" or "DOCUMENT").',
    'modules[0].content[0].type "HOLOGRAM" is not a supported content type. Use one of: VIDEO, DOCUMENT, TEXT, LINK, PRESENTATION, IMAGE, PDF, FILE, EXTERNAL_LINK, HTML, CODE, ASSIGNMENT, CODING_EXERCISE, SCORM, INTERACTIVE_LAB, AUDIO, EMBED, SLIDE.',
    'modules[0].lessons[0].quiz.quizTag "MIDTERM" is not supported. Use one of: SELF_TEST, FINAL, LESSON_ASSESSMENT, MODULE_ASSESSMENT, COURSE_ASSESSMENT.',
    'modules[0].lessons[0].quiz.questions[0]: "correctAnswer" "C" does not match any option.',
    'modules[0].lessons[0].assignment.dueDate is required — the LMS needs a due date for every assignment (ISO 8601, e.g. "2026-11-15T23:59:00.000Z").',
  ]);
});

test("answer keys match options the way the grader compares them (trimmed, case-insensitive)", () => {
  const result = parseCourseJson({
    course: { title: "C" },
    quiz: {
      title: "Q",
      questions: [
        { question: "Single", options: ["Metre", "Second"], correctAnswer: " metre " },
        { question: "Multi", questionType: "MCQ_MULTI", options: ["A", "B", "C"], correctAnswer: ["a", "C"] },
        { question: "Multi without keys", questionType: "MCQ_MULTI", options: ["A", "B"], correctAnswer: [] },
      ],
    },
  });

  assert.deepEqual(result.errors, ['quiz.questions[2]: "correctAnswer" must be a non-empty array of the correct options for MCQ_MULTI.']);
});

test("a level-named quiz tag nested at another level is imported by its nesting, with a warning", () => {
  const result = parseCourseJson({
    course: { title: "C" },
    modules: [{ title: "M", lessons: [{ title: "L", quiz: { title: "Q", quizTag: "MODULE_ASSESSMENT", questions: [mcq()] } }] }],
  });

  assert.equal(result.isValid, true);
  assert.match(result.warnings.join("\n"), /quizTag is MODULE_ASSESSMENT, but the quiz is nested at lesson level/);
});

test("ID references must agree with the nesting", async (t) => {
  await t.test("different IDs for the same module", () => {
    const result = parseCourseJson({
      course: { title: "C" },
      modules: [{ title: "M", lessons: [{ title: "L", moduleId: "mod_a" }], quiz: { title: "Q", moduleId: "mod_b", questions: [mcq()] } }],
    });
    assert.deepEqual(result.errors, [
      'modules[0] is referred to by different module IDs: "mod_b" (modules[0].quiz.moduleId) and "mod_a" (modules[0].lessons[0].moduleId).',
    ]);
  });

  await t.test("the same ID used for two modules", () => {
    const result = parseCourseJson({
      course: { title: "C" },
      modules: [
        { title: "A", lessons: [{ title: "L1", moduleId: "mod_1" }] },
        { title: "B", lessons: [{ title: "L2", moduleId: "mod_1" }] },
      ],
    });
    assert.deepEqual(result.errors, ['module ID "mod_1" is used for both modules[0] and modules[1]; IDs must be unique.']);
  });

  await t.test("a reference to a level the object is not inside", () => {
    const result = parseCourseJson({ course: { title: "C" }, quiz: { title: "Q", lessonId: "lesson_9", questions: [mcq()] } });
    assert.deepEqual(result.errors, ['quiz.lessonId is "lesson_9", but quiz is not inside a lesson. Nest it under that lesson or remove lessonId.']);
  });

  await t.test("no IDs at all is fine", () => {
    assert.equal(parseCourseJson({ course: { title: "C" }, modules: [{ title: "M", quiz: { title: "Q", questions: [mcq()] } }] }).isValid, true);
  });

  await t.test("skipped when the caller owns the IDs (the draft Composer's copy)", () => {
    const result = parseCourseJson(
      { course: { title: "C" }, modules: [{ id: "draft-uuid", title: "M", lessons: [{ title: "L", moduleId: "physics_mod_1" }] }] },
      { checkReferences: false }
    );
    assert.equal(result.isValid, true);
  });
});

test("imported courses are always drafts: another status is a warning, not an error", () => {
  const result = parseCourseJson({ course: { title: "C", status: "PUBLISHED" }, content: [html("x")] });

  assert.equal(result.isValid, true);
  assert.match(result.warnings.join("\n"), /course.status is "PUBLISHED", but imported courses are always created as DRAFT/);
});

test("the validation report summarizes what will be created", () => {
  const report = buildValidationReport(parseCourseJson(clone(template)), ["from the generator"]);

  assert.equal(report.isValid, true);
  assert.deepEqual(report.info, ["Course JSON is valid: 2 modules, 2 lessons, 3 topics, 9 content items, 8 quizzes, 13 questions, 8 assignments."]);
  assert.deepEqual(report.warnings, ["from the generator"]);
});
