const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDedupeKey, normalizeSkillName } = require("../utils/dedupeKey.util");

test("buildDedupeKey combines type and target", () => {
  assert.equal(buildDedupeKey("COURSE", "React"), "COURSE:React");
});

test("normalizeSkillName trims and lowercases", () => {
  assert.equal(normalizeSkillName("  React  "), "react");
  assert.equal(normalizeSkillName("JAVASCRIPT"), "javascript");
});

test("normalizeSkillName handles null/undefined gracefully", () => {
  assert.equal(normalizeSkillName(null), "");
  assert.equal(normalizeSkillName(undefined), "");
});
