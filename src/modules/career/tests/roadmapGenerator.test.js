const test = require("node:test");
const assert = require("node:assert/strict");

const { generateRoadmaps } = require("../ai/roadmapGenerator");

test("generateRoadmaps schedules candidates cumulatively — a 90-day plan includes everything a 30-day plan has", () => {
  const candidates = [
    { type: "RESUME_IMPROVEMENT", dedupeKey: "a", reason: "a" }, // 7 days
    { type: "COURSE", dedupeKey: "b", reason: "b" }, // 20 days
    { type: "CERTIFICATION", dedupeKey: "c", reason: "c" }, // 45 days
  ];
  const roadmap = generateRoadmaps(candidates);

  const days30Keys = roadmap.DAYS_30.map((m) => m.dedupeKey);
  const days90Keys = roadmap.DAYS_90.map((m) => m.dedupeKey);
  assert.ok(days30Keys.every((key) => days90Keys.includes(key)));
});

test("generateRoadmaps schedules highest-priority (first in the ranked list) candidates earliest", () => {
  const candidates = [
    { type: "CERTIFICATION", dedupeKey: "first", reason: "first" },
    { type: "RESUME_IMPROVEMENT", dedupeKey: "second", reason: "second" },
  ];
  const roadmap = generateRoadmaps(candidates);
  const all = [...roadmap.YEAR_1];
  const first = all.find((m) => m.dedupeKey === "first");
  const second = all.find((m) => m.dedupeKey === "second");
  assert.ok(first.startDay < second.startDay);
});

test("generateRoadmaps returns an empty milestone list for every horizon given no candidates", () => {
  const roadmap = generateRoadmaps([]);
  assert.deepEqual(roadmap.DAYS_30, []);
  assert.deepEqual(roadmap.YEAR_1, []);
});

test("generateRoadmaps excludes a candidate whose start day falls outside the horizon window", () => {
  const candidates = Array.from({ length: 3 }, (_, i) => ({ type: "CERTIFICATION", dedupeKey: `c${i}`, reason: `c${i}` })); // 45 days each -> cursor at 0, 45, 90
  const roadmap = generateRoadmaps(candidates);
  assert.equal(roadmap.DAYS_30.length, 1); // only the first (startDay 0) fits under 30
});
