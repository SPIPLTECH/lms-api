const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDedupeKey } = require("../utils/dedupeKey.util");

test("buildDedupeKey joins parts with a colon", () => {
  assert.equal(buildDedupeKey("STAFFING", "OVERLOAD", "i1"), "STAFFING:OVERLOAD:i1");
});

test("buildDedupeKey treats null/undefined parts as empty strings, not literal 'null'", () => {
  assert.equal(buildDedupeKey("A", null, "B"), "A::B");
  assert.equal(buildDedupeKey("A", undefined, "B"), "A::B");
});
