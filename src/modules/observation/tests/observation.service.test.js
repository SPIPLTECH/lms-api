const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveTargetStudentId, clampPagination } = require("../service/observation.service");
const ApiError = require("../../../utils/ApiError");

test("resolveTargetStudentId: a STUDENT actor with no requested id gets their own id", () => {
  const actor = { role: "STUDENT", studentId: "student_1" };
  assert.equal(resolveTargetStudentId(actor, undefined), "student_1");
});

test("resolveTargetStudentId: a STUDENT actor requesting their own id is allowed", () => {
  const actor = { role: "STUDENT", studentId: "student_1" };
  assert.equal(resolveTargetStudentId(actor, "student_1"), "student_1");
});

test("resolveTargetStudentId: a STUDENT actor requesting another student's id is forbidden", () => {
  const actor = { role: "STUDENT", studentId: "student_1" };
  assert.throws(() => resolveTargetStudentId(actor, "student_2"), ApiError);
});

test("resolveTargetStudentId: staff must supply a target studentId", () => {
  const actor = { role: "INSTRUCTOR", studentId: null };
  assert.throws(() => resolveTargetStudentId(actor, undefined), ApiError);
});

test("resolveTargetStudentId: staff supplying a studentId is allowed", () => {
  const actor = { role: "ADMIN", studentId: null };
  assert.equal(resolveTargetStudentId(actor, "student_9"), "student_9");
});

test("clampPagination applies defaults", () => {
  const result = clampPagination(undefined, undefined);
  assert.equal(result.page, 1);
  assert.equal(result.limit, 20);
  assert.equal(result.skip, 0);
});

test("clampPagination clamps limit to MAX_PAGE_SIZE", () => {
  const result = clampPagination(1, 9999);
  assert.equal(result.limit, 100);
});

test("clampPagination computes skip from page/limit", () => {
  const result = clampPagination(3, 10);
  assert.equal(result.skip, 20);
  assert.equal(result.take, 10);
});

test("clampPagination floors a negative page to 1", () => {
  const result = clampPagination(-5, 10);
  assert.equal(result.page, 1);
});

test("clampPagination treats a falsy limit (0) as not provided and uses the default", () => {
  const result = clampPagination(1, 0);
  assert.equal(result.limit, 20);
});

test("clampPagination floors a negative limit to 1", () => {
  const result = clampPagination(1, -10);
  assert.equal(result.limit, 1);
});
