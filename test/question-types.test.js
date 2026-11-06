const test = require("node:test");
const assert = require("node:assert");

const { parseQuestionType } = require("../src/utils/questionTypes");
const { buildLearningSequence } = require("../src/utils/learningSequence");

// SubTopic.description carries a board question's type in the SSC course.
// Pure — no database.

test("parseQuestionType reads the known types, with or without marks", () => {
  assert.deepStrictEqual(parseQuestionType("Short answer · 2 marks"), { type: "Short answer", marks: 2 });
  assert.deepStrictEqual(parseQuestionType("Descriptive · 1 mark"), { type: "Descriptive", marks: 1 });
  assert.deepStrictEqual(parseQuestionType("MCQs"), { type: "MCQs", marks: null });
  assert.deepStrictEqual(parseQuestionType("Diagrams & graphs · 4 marks"), { type: "Diagrams & graphs", marks: 4 });
});

test("parseQuestionType ignores any other description", () => {
  for (const value of [null, undefined, "", "An introduction to forces", "Solve · 2 marks", "mcqs"]) {
    assert.strictEqual(parseQuestionType(value), null, String(value));
  }
});

test("the sequence tree carries questionType on SubTopics only", () => {
  const hierarchy = {
    id: "c",
    modules: [
      {
        id: "m",
        order: 1,
        lessons: [
          {
            id: "l",
            order: 1,
            topics: [
              {
                id: "t",
                order: 1,
                description: "Short answer · 2 marks",
                subTopics: [
                  { id: "s1", order: 1, title: "MCQ's", description: "MCQs", concepts: [] },
                  { id: "s2", order: 2, title: "Question 1", description: "Activity · 3 marks", concepts: [] },
                  { id: "s3", order: 3, title: "Intro", description: "About this", concepts: [] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const { tree } = buildLearningSequence(hierarchy);
  const topic = tree.entries[0].node.entries[0].node.entries[0].node;
  assert.strictEqual(topic.questionType, null);
  assert.strictEqual(topic.about, "Short answer · 2 marks");
  assert.strictEqual(topic.entries[0].node.about, null);
  assert.deepStrictEqual(
    topic.entries.map((entry) => entry.node.questionType),
    [{ type: "MCQs", marks: null }, { type: "Activity", marks: 3 }, null]
  );
});
