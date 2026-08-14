const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveTargetStudentId, isStaff } = require("../utils/accessControl.util");
const ApiError = require("../../../utils/ApiError");

test("resolveTargetStudentId locks a STUDENT actor to their own id", () => {
  assert.equal(resolveTargetStudentId({ role: "STUDENT", studentId: "s1" }, undefined), "s1");
});

test("resolveTargetStudentId forbids a STUDENT actor from requesting another student's id", () => {
  assert.throws(() => resolveTargetStudentId({ role: "STUDENT", studentId: "s1" }, "s2"), ApiError);
});

test("resolveTargetStudentId requires staff to name a target", () => {
  assert.throws(() => resolveTargetStudentId({ role: "ADMIN" }, undefined), ApiError);
});

test("resolveTargetStudentId allows staff to name any target", () => {
  assert.equal(resolveTargetStudentId({ role: "INSTRUCTOR" }, "s9"), "s9");
});

test("isStaff identifies ADMIN/INSTRUCTOR only", () => {
  assert.equal(isStaff("ADMIN"), true);
  assert.equal(isStaff("STUDENT"), false);
});
