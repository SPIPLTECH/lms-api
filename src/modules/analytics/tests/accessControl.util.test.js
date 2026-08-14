const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertStudentScopeAccess,
  assertInstructorScopeAccess,
  assertCourseScopeAccess,
  assertPlatformAccess,
  resolveDefaultScope,
} = require("../utils/accessControl.util");
const ApiError = require("../../../utils/ApiError");

test("assertStudentScopeAccess allows a student to view their own data", () => {
  assert.doesNotThrow(() => assertStudentScopeAccess({ role: "STUDENT", studentId: "s1" }, "s1"));
});

test("assertStudentScopeAccess forbids a student from viewing another student's data", () => {
  assert.throws(() => assertStudentScopeAccess({ role: "STUDENT", studentId: "s1" }, "s2"), ApiError);
});

test("assertStudentScopeAccess forbids an instructor entirely", () => {
  assert.throws(() => assertStudentScopeAccess({ role: "INSTRUCTOR", userId: "t1" }, "s1"), ApiError);
});

test("assertStudentScopeAccess allows an admin on any student", () => {
  assert.doesNotThrow(() => assertStudentScopeAccess({ role: "ADMIN" }, "s1"));
});

test("assertInstructorScopeAccess defaults an instructor actor to their own id", () => {
  assert.equal(assertInstructorScopeAccess({ role: "INSTRUCTOR", userId: "t1" }, undefined), "t1");
});

test("assertInstructorScopeAccess forbids an instructor from requesting another instructor's id", () => {
  assert.throws(() => assertInstructorScopeAccess({ role: "INSTRUCTOR", userId: "t1" }, "t2"), ApiError);
});

test("assertInstructorScopeAccess requires admins to name a target", () => {
  assert.throws(() => assertInstructorScopeAccess({ role: "ADMIN" }, undefined), ApiError);
});

test("assertInstructorScopeAccess rejects a student", () => {
  assert.throws(() => assertInstructorScopeAccess({ role: "STUDENT" }, "t1"), ApiError);
});

test("assertCourseScopeAccess allows the owning instructor", () => {
  assert.doesNotThrow(() => assertCourseScopeAccess({ role: "INSTRUCTOR", userId: "t1" }, { creatorId: "t1" }));
});

test("assertCourseScopeAccess forbids a non-owning instructor", () => {
  assert.throws(() => assertCourseScopeAccess({ role: "INSTRUCTOR", userId: "t1" }, { creatorId: "t2" }), ApiError);
});

test("assertCourseScopeAccess forbids a student", () => {
  assert.throws(() => assertCourseScopeAccess({ role: "STUDENT" }, { creatorId: "t1" }), ApiError);
});

test("assertPlatformAccess allows only admins", () => {
  assert.doesNotThrow(() => assertPlatformAccess({ role: "ADMIN" }));
  assert.throws(() => assertPlatformAccess({ role: "INSTRUCTOR" }), ApiError);
  assert.throws(() => assertPlatformAccess({ role: "STUDENT" }), ApiError);
});

test("resolveDefaultScope maps ADMIN to PLATFORM, INSTRUCTOR to their own INSTRUCTOR scope, STUDENT to their own STUDENT scope", () => {
  assert.deepEqual(resolveDefaultScope({ role: "ADMIN" }), { scopeType: "PLATFORM", scopeId: null });
  assert.deepEqual(resolveDefaultScope({ role: "INSTRUCTOR", userId: "t1" }), { scopeType: "INSTRUCTOR", scopeId: "t1" });
  assert.deepEqual(resolveDefaultScope({ role: "STUDENT", studentId: "s1" }), { scopeType: "STUDENT", scopeId: "s1" });
});

test("resolveDefaultScope throws for a student with no resolved profile", () => {
  assert.throws(() => resolveDefaultScope({ role: "STUDENT", studentId: null }), ApiError);
});
