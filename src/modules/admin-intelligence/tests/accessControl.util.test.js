const test = require("node:test");
const assert = require("node:assert/strict");

const { assertAdminAccess } = require("../utils/accessControl.util");
const ApiError = require("../../../utils/ApiError");

test("assertAdminAccess allows ADMIN", () => {
  assert.doesNotThrow(() => assertAdminAccess({ role: "ADMIN" }));
});

test("assertAdminAccess rejects STUDENT", () => {
  assert.throws(() => assertAdminAccess({ role: "STUDENT" }), ApiError);
});

test("assertAdminAccess rejects INSTRUCTOR", () => {
  assert.throws(() => assertAdminAccess({ role: "INSTRUCTOR" }), ApiError);
});

test("assertAdminAccess rejects a missing actor", () => {
  assert.throws(() => assertAdminAccess(null), ApiError);
});
