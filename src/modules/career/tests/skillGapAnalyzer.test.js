const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeGaps, classifySeverity } = require("../ai/skillGapAnalyzer");

const role = { requiredSkills: { JavaScript: 90, React: 80, Git: 30 } };

test("analyzeGaps returns no gaps when every skill is already at/above the required level", () => {
  const skillVector = [
    { skillName: "JavaScript", proficiency: 90 },
    { skillName: "React", proficiency: 85 },
    { skillName: "Git", proficiency: 30 },
  ];
  assert.deepEqual(analyzeGaps(skillVector, role), []);
});

test("analyzeGaps computes gapSize as the shortfall and treats a missing skill as 0", () => {
  const gaps = analyzeGaps([{ skillName: "React", proficiency: 60 }], role);
  const jsGap = gaps.find((g) => g.skillName === "JavaScript");
  const reactGap = gaps.find((g) => g.skillName === "React");
  assert.equal(jsGap.currentLevel, 0);
  assert.equal(jsGap.gapSize, 90);
  assert.equal(reactGap.gapSize, 20);
});

test("analyzeGaps sorts largest gap first", () => {
  const gaps = analyzeGaps([], role);
  assert.deepEqual(
    gaps.map((g) => g.skillName),
    ["JavaScript", "React", "Git"]
  );
});

test("classifySeverity buckets by the configured thresholds", () => {
  assert.equal(classifySeverity(65), "CRITICAL");
  assert.equal(classifySeverity(45), "HIGH");
  assert.equal(classifySeverity(25), "MEDIUM");
  assert.equal(classifySeverity(5), "LOW");
});
