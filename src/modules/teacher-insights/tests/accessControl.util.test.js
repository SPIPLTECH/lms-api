const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveTargetTeacherId, assertCourseAccess } = require("../utils/accessControl.util");
const ApiError = require("../../../utils/ApiError");

test("resolveTargetTeacherId defaults an INSTRUCTOR actor to their own id", () => {
  assert.equal(resolveTargetTeacherId({ role: "INSTRUCTOR", userId: "t1" }, undefined), "t1");
});

test("resolveTargetTeacherId forbids an INSTRUCTOR from requesting another teacher's id", () => {
  assert.throws(() => resolveTargetTeacherId({ role: "INSTRUCTOR", userId: "t1" }, "t2"), ApiError);
});

test("resolveTargetTeacherId requires admins to name a target", () => {
  assert.throws(() => resolveTargetTeacherId({ role: "ADMIN", userId: "admin1" }, undefined), ApiError);
});

test("resolveTargetTeacherId allows admins to name any target", () => {
  assert.equal(resolveTargetTeacherId({ role: "ADMIN", userId: "admin1" }, "t9"), "t9");
});

test("resolveTargetTeacherId rejects any other role", () => {
  assert.throws(() => resolveTargetTeacherId({ role: "STUDENT", userId: "s1" }, "t1"), ApiError);
});

test("assertCourseAccess allows the owning instructor", () => {
  assert.doesNotThrow(() => assertCourseAccess({ role: "INSTRUCTOR", userId: "t1" }, { creatorId: "t1" }));
});

test("assertCourseAccess forbids a non-owning instructor", () => {
  assert.throws(() => assertCourseAccess({ role: "INSTRUCTOR", userId: "t1" }, { creatorId: "t2" }), ApiError);
});

test("assertCourseAccess allows admins on any course", () => {
  assert.doesNotThrow(() => assertCourseAccess({ role: "ADMIN", userId: "admin1" }, { creatorId: "t2" }));
});
