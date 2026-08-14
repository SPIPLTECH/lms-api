const test = require("node:test");
const assert = require("node:assert/strict");

const { matchScoreForOpportunity, matchOpportunities } = require("../ai/jobMatchEngine");

const opportunity = { requiredSkills: { JavaScript: 90, React: 80, CSS: 70 } };

test("matchScoreForOpportunity returns 100 when every required skill is fully met", () => {
  const skillVector = [
    { skillName: "JavaScript", proficiency: 100 },
    { skillName: "React", proficiency: 100 },
    { skillName: "CSS", proficiency: 100 },
  ];
  assert.equal(matchScoreForOpportunity(skillVector, opportunity), 100);
});

test("matchScoreForOpportunity returns 0 for a completely unrelated skill vector", () => {
  assert.equal(matchScoreForOpportunity([{ skillName: "Cooking", proficiency: 100 }], opportunity), 0);
});

test("matchScoreForOpportunity matches skill names case-insensitively", () => {
  assert.ok(matchScoreForOpportunity([{ skillName: "javascript", proficiency: 90 }], opportunity) > 0);
});

test("matchScoreForOpportunity doesn't over-credit proficiency beyond what's required", () => {
  const overshoot = matchScoreForOpportunity([{ skillName: "CSS", proficiency: 100 }], opportunity);
  const exact = matchScoreForOpportunity([{ skillName: "CSS", proficiency: 70 }], opportunity);
  assert.equal(overshoot, exact);
});

test("matchScoreForOpportunity returns 0 for an opportunity with no required skills", () => {
  assert.equal(matchScoreForOpportunity([{ skillName: "X", proficiency: 100 }], { requiredSkills: {} }), 0);
});

test("matchOpportunities returns one entry per opportunity, unsorted", () => {
  const opportunities = [opportunity, { requiredSkills: { Python: 100 } }];
  const result = matchOpportunities([{ skillName: "JavaScript", proficiency: 90 }], opportunities);
  assert.equal(result.length, 2);
});
