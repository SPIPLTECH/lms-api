const test = require("node:test");
const assert = require("node:assert/strict");

const { detectMissingSkills } = require("../ai/skillGapDetector");

const opportunity = { requiredSkills: { JavaScript: 90, React: 80, Git: 30 } };

test("detectMissingSkills returns nothing when every skill is already at/above the required level", () => {
  const skillVector = [
    { skillName: "JavaScript", proficiency: 90 },
    { skillName: "React", proficiency: 85 },
    { skillName: "Git", proficiency: 30 },
  ];
  assert.deepEqual(detectMissingSkills(skillVector, opportunity), []);
});

test("detectMissingSkills treats a missing skill as a full gap and sorts largest gap first", () => {
  // JavaScript: missing entirely -> gap 90. Git: missing entirely -> gap 30. React: 80-60 -> gap 20.
  const result = detectMissingSkills([{ skillName: "React", proficiency: 60 }], opportunity);
  assert.deepEqual(result, ["JavaScript", "Git", "React"]);
});

test("detectMissingSkills matches skill names case-insensitively", () => {
  const result = detectMissingSkills([{ skillName: "javascript", proficiency: 90 }], opportunity);
  assert.ok(!result.includes("JavaScript"));
});
