const test = require("node:test");
const assert = require("node:assert/strict");

const { computeEnrollmentGrowthPercent, bucketByDay } = require("../utils/growth.util");

const day = 24 * 3600 * 1000;

test("computeEnrollmentGrowthPercent is 0 when both windows are empty", () => {
  assert.equal(computeEnrollmentGrowthPercent([], new Date()), 0);
});

test("computeEnrollmentGrowthPercent computes growth between the two windows", () => {
  const now = new Date();
  const enrollments = [
    ...Array.from({ length: 5 }, (_, i) => ({ enrolledAt: new Date(now.getTime() - i * day) })), // recent window
    ...Array.from({ length: 10 }, (_, i) => ({ enrolledAt: new Date(now.getTime() - (35 + i) * day) })), // prior window
  ];
  const growth = computeEnrollmentGrowthPercent(enrollments, now, 30);
  assert.equal(growth, -50); // 5 recent vs 10 prior -> -50%
});

test("bucketByDay counts rows per calendar day within range and excludes rows outside it", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  const since = new Date("2026-01-05T00:00:00Z");
  const rows = [
    { createdAt: new Date("2026-01-06T01:00:00Z") },
    { createdAt: new Date("2026-01-06T23:00:00Z") },
    { createdAt: new Date("2026-01-07T00:00:00Z") },
    { createdAt: new Date("2026-01-01T00:00:00Z") }, // before `since` -> excluded
  ];
  const buckets = bucketByDay(rows, "createdAt", since, now);
  assert.deepEqual(buckets, [
    { date: "2026-01-06", value: 2 },
    { date: "2026-01-07", value: 1 },
  ]);
});
