const test = require("node:test");
const assert = require("node:assert/strict");

const { startOfDay, addDays, startOfWeek } = require("../utils/dateMath.util");

test("startOfDay strips the time-of-day component", () => {
  assert.equal(startOfDay(new Date("2026-07-29T18:42:11.000Z")).toISOString(), "2026-07-29T00:00:00.000Z");
});

test("addDays shifts forward by N days", () => {
  assert.equal(addDays(new Date("2026-07-29T00:00:00.000Z"), 7).toISOString(), "2026-08-05T00:00:00.000Z");
});

test("startOfWeek resolves to the Monday of the current ISO week", () => {
  const wednesday = new Date("2026-07-29T12:00:00.000Z"); // Wednesday
  assert.equal(startOfWeek(wednesday).toISOString(), "2026-07-27T00:00:00.000Z"); // Monday
});

test("startOfWeek on a Monday returns that same day", () => {
  const monday = new Date("2026-07-27T09:00:00.000Z");
  assert.equal(startOfWeek(monday).toISOString(), "2026-07-27T00:00:00.000Z");
});

test("startOfWeek on a Sunday rolls back to the preceding Monday", () => {
  const sunday = new Date("2026-08-02T09:00:00.000Z");
  assert.equal(startOfWeek(sunday).toISOString(), "2026-07-27T00:00:00.000Z");
});
