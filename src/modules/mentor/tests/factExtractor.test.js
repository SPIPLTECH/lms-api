const test = require("node:test");
const assert = require("node:assert/strict");

const { extractFacts } = require("../memory/factExtractor");
const { MEMORY_KEY } = require("../constants");

test("extractFacts always records LAST_INTENT", () => {
  const facts = extractFacts({ intent: "LEARNING", confidence: 80 }, { byAgent: {} }, "help me study");
  assert.equal(facts[MEMORY_KEY.LAST_INTENT].intent, "LEARNING");
});

test("extractFacts records CAREER_GOAL only when career.getFullState reports a primaryTargetRole", () => {
  const withGoal = extractFacts(
    { intent: "CAREER", confidence: 80 },
    { byAgent: { "career.getFullState": { primaryTargetRole: { id: "r1", name: "Backend Engineer" } } } },
    "career help"
  );
  assert.equal(withGoal[MEMORY_KEY.CAREER_GOAL].targetRoleTitle, "Backend Engineer");

  const withoutGoal = extractFacts({ intent: "CAREER", confidence: 80 }, { byAgent: { "career.getFullState": { primaryTargetRole: null } } }, "career help");
  assert.equal(withoutGoal[MEMORY_KEY.CAREER_GOAL], undefined);
});

test("extractFacts records LAST_STUDY_TOPIC only for LEARNING intent", () => {
  const learning = extractFacts({ intent: "LEARNING", confidence: 80 }, { byAgent: {} }, "help me with module 3");
  assert.ok(learning[MEMORY_KEY.LAST_STUDY_TOPIC]);

  const other = extractFacts({ intent: "ASSESSMENT", confidence: 80 }, { byAgent: {} }, "how did i do on the quiz");
  assert.equal(other[MEMORY_KEY.LAST_STUDY_TOPIC], undefined);
});
