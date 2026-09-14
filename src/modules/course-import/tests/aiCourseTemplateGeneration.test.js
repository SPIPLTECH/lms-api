const test = require("node:test");
const assert = require("node:assert/strict");

// Same seam as aiCourseGenerator.test.js: the generator only reaches an LLM
// through llmService.generate, so that is what these tests replace.
const llmService = require("../../llm/llm.service");
const { generateCourse } = require("../services/aiCourseGenerator.service");
const template = require("../fixtures/course_json_template.json");

const originalGenerate = llmService.generate;
test.afterEach(() => {
  llmService.generate = originalGenerate;
});

const NOW = new Date("2026-09-14T10:00:00.000Z");

function respondWith(json, calls = []) {
  llmService.generate = async (args) => {
    calls.push(args);
    return { response: JSON.stringify(json), finishReason: "STOP" };
  };
  return calls;
}

test("a simple request stays simple: no topics, quizzes or assignments are added", async () => {
  const calls = respondWith({
    course: { title: "HTML Basics", category: "Web Development", tags: ["html"] },
    modules: [1, 2, 3].map((m) => ({
      title: `Module ${m}`,
      order: m,
      lessons: [1, 2].map((l) => ({ title: `Lesson ${m}.${l}`, order: l, content: [{ type: "HTML", title: "Read", htmlContent: "<h2>Tags</h2><p>Use <strong>semantic</strong> tags.</p>" }] })),
    })),
  });

  const { canonical, warnings } = await generateCourse({ prompt: "Create a simple course about HTML with 3 modules. Each module should have 2 lessons.", now: NOW });

  assert.deepEqual(warnings, []);
  assert.equal(canonical.modules.length, 3);
  assert.ok(canonical.modules.every((m) => m.lessons.length === 2));
  assert.ok(canonical.modules.every((m) => m.quizzes.length === 0 && m.assignments.length === 0));
  assert.ok(canonical.modules.every((m) => m.lessons.every((l) => l.topics.length === 0)), "no topics were invented");

  const lesson = canonical.modules[0].lessons[0];
  assert.equal(lesson.moduleId, "html_mod_1", "IDs follow the template's reference style");
  assert.deepEqual(lesson.contents[0].data, { blockType: "text", title: "Read", cssStyles: "", markdown: "## Tags\n\nUse **semantic** tags." });

  assert.match(calls[0].systemPrompt, /REFERENCE TEMPLATE \(built-in example\)/);
  assert.match(calls[0].systemPrompt, /NOT a list of elements every course must have/);
  assert.equal(calls[0].size, "LARGE");
});

test("a pasted template is followed as a template, and the request text is what is sent as the instruction", async () => {
  const calls = respondWith({ course: { title: "Introduction to Python", tags: ["python"] }, content: [{ type: "HTML", htmlContent: "<p>Hi</p>" }] });
  const prompt = `Create a course about Python using this template.\n${JSON.stringify(template)}`;

  await generateCourse({ prompt, now: NOW });

  assert.match(calls[0].systemPrompt, /REFERENCE TEMPLATE \(supplied by the instructor/);
  assert.match(calls[0].prompt, /INSTRUCTOR REQUEST:\nCreate a course about Python using this template\.\n/);
  assert.doesNotMatch(calls[0].prompt, /Introduction to Physics/, "the template is not repeated inside the instruction");
});

test("model output is brought in line with the template before validation, and every visible change is reported", async () => {
  respondWith({
    course: { title: "Complete HTML", tags: ["html"], status: "PUBLISHED" },
    modules: [
      {
        courseId: "whatever",
        title: "Structure",
        lessons: [
          {
            moduleId: "mod_x",
            title: "Elements",
            topics: [
              {
                lessonId: "les_y",
                title: "Headings",
                content: [{ type: "TEXT_BLOCK", htmlContent: "<p>h1 to h6</p>" }],
                quiz: {
                  title: "Headings check",
                  moduleId: "totally_different",
                  questions: [
                    { question: "Largest heading?", options: ["h1", "h6"], correctAnswer: "h1" },
                    { question: "Broken key", options: ["a", "b"], correctAnswer: "z" },
                  ],
                },
                assignment: { title: "Mark up a page" },
              },
            ],
          },
        ],
        quiz: { title: "Module check", questions: [{ question: "Only bad", options: ["a", "b"] }] },
      },
    ],
  });

  const { canonical, warnings } = await generateCourse({ prompt: "Create a complete HTML course with modules, lessons, topics, quizzes and assignments.", now: NOW });

  const topic = canonical.modules[0].lessons[0].topics[0];
  assert.equal(canonical.metadata.status, "DRAFT");
  assert.equal(topic.contents[0].type, "HTML");
  assert.equal(topic.quizzes[0].quizTag, "SELF_TEST", "a missing tag follows the level");
  assert.deepEqual(
    [topic.quizzes[0].courseId, topic.quizzes[0].moduleId, topic.quizzes[0].lessonId, topic.quizzes[0].topicId],
    ["course_html", "html_mod_1", "html_lesson_1", "html_topic_1"]
  );
  assert.equal(topic.quizzes[0].questions.length, 1);
  assert.equal(topic.assignments[0].dueDate, "2026-09-21T23:59:00.000Z");
  assert.equal(canonical.modules[0].quizzes.length, 0, "a quiz with no usable question is dropped");

  // Reported in walk order: a level's own quizzes before its children's.
  assert.deepEqual(warnings, [
    'Removed question "Only bad" from quiz "Module check": "correctAnswer" is required.',
    'Removed quiz "Module check" because none of its questions had a usable answer key.',
    'Removed question "Broken key" from quiz "Headings check": "correctAnswer" "z" does not match any option.',
    'Assignment "Mark up a page" had no valid due date; it was set to 2026-09-21. Review it after the course is created.',
  ]);
});

test("output that cannot be repaired into a valid course is rejected with the validation errors", async () => {
  respondWith({ course: { description: "forgot the title" }, modules: [{ title: "M", order: 1 }, { title: "N", order: 1 }] });

  await assert.rejects(
    () => generateCourse({ prompt: "Make something", now: NOW }),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.equal(err.code, "AI_COURSE_INVALID");
      // Paths are in the canonical spelling: this JSON was the model's, not the instructor's.
      assert.deepEqual(err.errors, ["metadata.title is required.", "modules: order 1 is used by both modules[0] and modules[1]. Sibling orders must be unique."]);
      return true;
    }
  );
});
