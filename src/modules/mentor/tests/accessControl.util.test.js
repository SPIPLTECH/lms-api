const test = require("node:test");
const assert = require("node:assert/strict");

const { assertOwnsConversation } = require("../utils/accessControl.util");
const ApiError = require("../../../utils/ApiError");

test("assertOwnsConversation allows the owning user", () => {
  assert.doesNotThrow(() => assertOwnsConversation({ userId: "u1" }, { userId: "u1" }));
});

test("assertOwnsConversation rejects a different user", () => {
  assert.throws(() => assertOwnsConversation({ userId: "u1" }, { userId: "u2" }), ApiError);
});

test("assertOwnsConversation 404s on a missing conversation, no ADMIN override", () => {
  assert.throws(() => assertOwnsConversation({ userId: "admin1", role: "ADMIN" }, null), ApiError);
});
