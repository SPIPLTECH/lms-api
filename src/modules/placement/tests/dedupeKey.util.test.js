const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDedupeKey, normalizeSkillName } = require("../utils/dedupeKey.util");

test("buildDedupeKey combines opportunity type and id", () => {
  assert.equal(buildDedupeKey("JOB", "job1"), "JOB:job1");
});

test("normalizeSkillName trims and lowercases", () => {
  assert.equal(normalizeSkillName("  React  "), "react");
});

test("normalizeSkillName handles null/undefined gracefully", () => {
  assert.equal(normalizeSkillName(null), "");
  assert.equal(normalizeSkillName(undefined), "");
});
