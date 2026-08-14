const test = require("node:test");
const assert = require("node:assert/strict");

const { matchScoreForRole, matchRoles } = require("../ai/skillMatchEngine");

const role = { id: "r1", name: "Frontend Developer", requiredSkills: { JavaScript: 90, React: 80, CSS: 70 } };

test("matchScoreForRole returns 100 when every required skill is fully met", () => {
  const skillVector = [
    { skillName: "JavaScript", proficiency: 100 },
    { skillName: "React", proficiency: 100 },
    { skillName: "CSS", proficiency: 100 },
  ];
  assert.equal(matchScoreForRole(skillVector, role), 100);
});

test("matchScoreForRole returns 0 for a completely unrelated skill vector", () => {
  const skillVector = [{ skillName: "Cooking", proficiency: 100 }];
  assert.equal(matchScoreForRole(skillVector, role), 0);
});

test("matchScoreForRole matches skill names case-insensitively", () => {
  const skillVector = [{ skillName: "javascript", proficiency: 90 }];
  assert.ok(matchScoreForRole(skillVector, role) > 0);
});

test("matchScoreForRole doesn't over-credit proficiency beyond what's required", () => {
  const skillVector = [{ skillName: "CSS", proficiency: 100 }]; // required is only 70
  const withOvershoot = matchScoreForRole(skillVector, role);
  const withExact = matchScoreForRole([{ skillName: "CSS", proficiency: 70 }], role);
  assert.equal(withOvershoot, withExact);
});

test("matchScoreForRole returns 0 for a role with no required skills", () => {
  assert.equal(matchScoreForRole([{ skillName: "X", proficiency: 100 }], { requiredSkills: {} }), 0);
});

test("matchRoles ranks roles highest-match-first and respects topN", () => {
  const roles = [
    { id: "a", name: "A", requiredSkills: { Python: 100 } },
    { id: "b", name: "B", requiredSkills: { JavaScript: 100 } },
  ];
  const skillVector = [{ skillName: "JavaScript", proficiency: 100 }];
  const ranked = matchRoles(skillVector, roles, 1);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].roleId, "b");
});
