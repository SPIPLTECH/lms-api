const test = require("node:test");
const assert = require("node:assert/strict");

const { generateMilestones } = require("../services/domain/milestoneGenerator");
const { buildSequence } = require("../services/domain/sequencer");

const courseStructure = [
  { id: "m1", title: "Module One", lessons: [{ id: "l1", title: "L1", contents: [] }] },
  { id: "m2", title: "Module Two", lessons: [{ id: "l2", title: "L2", contents: [] }] },
];

test("generateMilestones marks a fully-completed module ACHIEVED", () => {
  const progress = new Map([["l1", { completed: true }]]);
  const sequence = buildSequence(courseStructure, progress);
  const milestones = generateMilestones(courseStructure, sequence, 30, new Date(), "course1");

  const m1 = milestones.find((m) => m.moduleId === "m1");
  const m2 = milestones.find((m) => m.moduleId === "m2");
  assert.equal(m1.status, "ACHIEVED");
  assert.equal(m2.status, "PENDING");
});

test("generateMilestones always includes one COURSE_COMPLETION milestone", () => {
  const sequence = buildSequence(courseStructure, new Map());
  const milestones = generateMilestones(courseStructure, sequence, 30, new Date(), "course1");
  const courseMilestones = milestones.filter((m) => m.milestoneType === "COURSE_COMPLETION");
  assert.equal(courseMilestones.length, 1);
  assert.equal(courseMilestones[0].status, "PENDING");
});

test("generateMilestones marks COURSE_COMPLETION ACHIEVED once every lesson is done", () => {
  const progress = new Map([
    ["l1", { completed: true }],
    ["l2", { completed: true }],
  ]);
  const sequence = buildSequence(courseStructure, progress);
  const milestones = generateMilestones(courseStructure, sequence, 30, new Date(), "course1");
  const courseMilestone = milestones.find((m) => m.milestoneType === "COURSE_COMPLETION");
  assert.equal(courseMilestone.status, "ACHIEVED");
  assert.equal(courseMilestone.targetDate, null);
});

test("generateMilestones produces stable, non-null milestoneKeys for the upsert unique constraint", () => {
  const sequence = buildSequence(courseStructure, new Map());
  const milestones = generateMilestones(courseStructure, sequence, 30, new Date(), "course1");
  assert.ok(milestones.every((m) => typeof m.milestoneKey === "string" && m.milestoneKey.length > 0));
  const keys = milestones.map((m) => m.milestoneKey);
  assert.equal(new Set(keys).size, keys.length); // all unique
});
