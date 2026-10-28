const test = require("node:test");
const assert = require("node:assert");

const { choiceMatches, findChoiceIndex, isCodeChoice } = require("../src/utils/choiceAnswer");
const { evaluateAnswer } = require("../src/modules/quizzes/quiz.service");

// The invariants under test (pure functions, no database):
//
//  1. A code option (inline `code`, a ``` block, or several lines) is its
//     exact text: indentation, line breaks and case all count.
//  2. A plain one-line option keeps the old allowance for repeated spaces,
//     but never when that would make two of the question's options the same.
//  3. Windows line breaks never change an answer.

const INSIDE = "```python\nfor i in range(3):\n    print(i)\n    print(\"done\")\n```";
const OUTSIDE = "```python\nfor i in range(3):\n    print(i)\nprint(\"done\")\n```";

test("code options — indentation is part of the answer", () => {
  const options = [INSIDE, OUTSIDE];
  assert.strictEqual(choiceMatches(INSIDE, INSIDE, options), true);
  assert.strictEqual(choiceMatches(OUTSIDE, INSIDE, options), false);
  assert.strictEqual(evaluateAnswer(OUTSIDE, INSIDE, "MCQ_SINGLE", options), 0);
  assert.strictEqual(evaluateAnswer(INSIDE, INSIDE, "MCQ_SINGLE", options), 1);
});

test("code options — case and inner spacing count, even without the options list", () => {
  assert.strictEqual(choiceMatches("`String s`", "`string s`"), false);
  assert.strictEqual(choiceMatches("`a  + b`", "`a + b`"), false);
  assert.strictEqual(choiceMatches("x = 1\ny = 2", "x = 1 y = 2"), false);
});

test("code options — Windows line breaks and outer spaces don't matter", () => {
  assert.strictEqual(choiceMatches(INSIDE.replace(/\n/g, "\r\n"), INSIDE), true);
  assert.strictEqual(choiceMatches(`  ${INSIDE}\n`, INSIDE), true);
});

test("plain options — repeated spaces still allowed when unambiguous", () => {
  assert.strictEqual(choiceMatches("Paris  France", "Paris France", ["Paris France", "Rome"]), true);
  assert.strictEqual(choiceMatches(" Paris ", "Paris"), true);
  assert.strictEqual(choiceMatches("paris", "Paris"), false);
});

test("plain options — the space allowance never merges two options", () => {
  const options = ["int  float", "int float"];
  assert.strictEqual(choiceMatches("int  float", "int float", options), false);
  assert.strictEqual(choiceMatches("int float", "int float", options), true);
});

test("MCQ_MULTI uses the same rule per selected option", () => {
  const options = [INSIDE, OUTSIDE, "`None`"];
  assert.strictEqual(evaluateAnswer([INSIDE, "`None`"], [INSIDE, "`None`"], "MCQ_MULTI", options), 1);
  assert.strictEqual(evaluateAnswer([OUTSIDE, "`None`"], [INSIDE, "`None`"], "MCQ_MULTI", options), 0);
});

test("typed answers keep the case-insensitive comparison", () => {
  assert.strictEqual(evaluateAnswer("PARIS", "paris", "FILL_BLANK"), 1);
});

test("findChoiceIndex — exact first, then one unambiguous loose match", () => {
  assert.strictEqual(findChoiceIndex("int Float = 4;", ["int float = 4;", "int Float = 4;"]), 1);
  assert.strictEqual(findChoiceIndex("INT FLOAT", ["int float", "Int Float"]), -1);
  assert.strictEqual(findChoiceIndex("paris", ["Paris", "Rome"]), 0);
  assert.strictEqual(findChoiceIndex("paris", ["Paris", "Rome"], { ignoreCase: false }), -1);
  assert.strictEqual(findChoiceIndex(OUTSIDE.replace(/\n/g, "\r\n"), [INSIDE, OUTSIDE]), 1);
  assert.strictEqual(findChoiceIndex("a  b", ["a b", "a   b"]), -1);
});

test("isCodeChoice", () => {
  assert.strictEqual(isCodeChoice("plain text"), false);
  assert.strictEqual(isCodeChoice("uses `code`"), true);
  assert.strictEqual(isCodeChoice("two\nlines"), true);
});
