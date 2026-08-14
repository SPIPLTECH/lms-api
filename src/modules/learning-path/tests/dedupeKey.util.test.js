const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDedupeKey, buildMilestoneKey } = require("../utils/dedupeKey.util");

test("buildDedupeKey combines type and target", () => {
  assert.equal(buildDedupeKey("NEXT_LESSON", "lesson1"), "NEXT_LESSON:lesson1");
});

test("buildMilestoneKey combines milestone type and target id", () => {
  assert.equal(buildMilestoneKey("MODULE_COMPLETION", "module1"), "MODULE_COMPLETION:module1");
});
