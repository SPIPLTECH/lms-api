const test = require("node:test");
const assert = require("node:assert");

const engine = require("../src/modules/career/career.engine");
const roles = require("../src/modules/career/career.roles");

// The invariants under test, for the Career Guidance agent:
//
//  1. Skills are matched by whole words in order — no substring accidents.
//  2. Measured mastery outranks a completed course, which outranks a
//     self-reported skill.
//  3. Readiness uses the original weights; missing evidence is dropped, not
//     scored as zero.
//  4. Course suggestions never include a course the learner is already in.

const backend = roles.find((r) => r.key === "backend-developer");

const evidence = (overrides = {}) => ({ masteries: [], completedCourses: [], technicalSkills: [], ...overrides });

test("the catalogue is the original 10 roles, with no salary or demand figures", () => {
  assert.strictEqual(roles.length, 10);
  for (const role of roles) {
    assert.ok(role.key && role.name && role.requiredSkills);
    assert.ok(!("avgSalaryMin" in role) && !("industryDemandScore" in role));
  }
});

test("skill matching is whole-word and order-aware", () => {
  assert.ok(engine.matchesSkill("SQL Joins and Indexes", "SQL"));
  assert.ok(engine.matchesSkill("Intro to Node.js", "Node.js"));
  assert.ok(engine.matchesSkill("nodejs", "Node.js"));
  assert.ok(engine.matchesSkill("Building REST APIs", "REST APIs"));
  assert.ok(!engine.matchesSkill("Digital Marketing", "Git"));
  assert.ok(!engine.matchesSkill("APIs REST", "REST APIs"));
});

test("evidence strength: mastery > completed course > self-reported", () => {
  const sql = (ev) => engine.skillProficiency("SQL", ev);
  assert.deepStrictEqual(sql(evidence({ technicalSkills: ["sql"] })), { proficiency: 0.5, source: "SELF_REPORTED" });
  assert.deepStrictEqual(sql(evidence({ technicalSkills: ["sql"], completedCourses: [{ title: "Databases", tags: ["SQL"] }] })), { proficiency: 0.7, source: "COMPLETED_COURSE" });
  assert.deepStrictEqual(sql(evidence({ completedCourses: [{ title: "SQL 101" }], masteries: [{ concept: "SQL Joins", masteryScore: 0.92 }] })), { proficiency: 0.92, source: "MASTERY" });
  assert.deepStrictEqual(sql(evidence()), { proficiency: 0, source: null });
});

test("gaps are weight x missing proficiency, with the original severity cut-offs", () => {
  const { skills } = engine.evaluateRole(backend, evidence({ masteries: [{ concept: "Node.js", masteryScore: 0.5 }] }));
  const node = skills.find((s) => s.skill === "Node.js");
  assert.strictEqual(node.gap, Math.round(85 * 0.5)); // 43
  assert.strictEqual(node.severity, "HIGH");
  assert.strictEqual(skills.find((s) => s.skill === "REST APIs").severity, "CRITICAL"); // 85, no evidence
});

test("readiness renormalises over the evidence that exists", () => {
  const onlySkills = engine.readiness({ skillMatchPercent: 80, masteryAvg: null, healthComposite: null, certificateCount: 0, engagementAvg: null, evidencedSkills: 6 });
  // (80*.35 + 0*.1) / .45
  assert.strictEqual(onlySkills.score, Math.round((80 * 0.35) / 0.45));
  assert.strictEqual(onlySkills.confidence, "HIGH");

  const full = engine.readiness({ skillMatchPercent: 80, masteryAvg: 0.8, healthComposite: 70, certificateCount: 5, engagementAvg: 60, evidencedSkills: 1 });
  assert.strictEqual(full.score, Math.round(80 * 0.35 + 80 * 0.25 + 70 * 0.2 + 100 * 0.1 + 60 * 0.1));
  assert.strictEqual(full.level, "READY");
  assert.strictEqual(full.confidence, "LOW");
});

test("goal: an explicit choice wins, else the profile's career goal text, else none", () => {
  assert.strictEqual(engine.resolveGoal(roles, { goalRoleKey: "data-analyst", careerGoalText: "backend developer" }).source, "GOAL");
  const fromText = engine.resolveGoal(roles, { goalRoleKey: null, careerGoalText: "I want to become a Backend Developer" });
  assert.strictEqual(fromText.role.key, "backend-developer");
  assert.strictEqual(fromText.source, "PROFILE_TEXT");
  assert.strictEqual(engine.resolveGoal(roles, { goalRoleKey: "nope", careerGoalText: "astronaut" }), null);
});

test("full state: top matches, goal readiness and gap courses the learner isn't in", () => {
  const state = engine.buildCareerState({
    roles,
    evidence: evidence({ masteries: [{ concept: "SQL Queries", masteryScore: 0.9 }], technicalSkills: ["Python"] }),
    goalRoleKey: "backend-developer",
    careerGoalText: null,
    certificateCount: 1,
    healthStates: [{ engagementScore: 60, performanceScore: 80 }],
    catalog: [
      { id: "k1", title: "REST APIs with Express", tags: [], category: "Web" },
      { id: "k2", title: "Advanced REST APIs", tags: [], category: "Web" },
      { id: "k3", title: "Cooking", tags: ["Food"], category: null },
    ],
    enrolledCourseIds: new Set(["k2"]),
  });

  assert.strictEqual(state.topMatches.length, 3);
  assert.strictEqual(state.goal.roleKey, "backend-developer");
  assert.ok(["BUILDING", "APPROACHING", "READY"].includes(state.goal.readinessLevel));
  assert.strictEqual(state.goal.gaps.length, 3);
  const rest = state.goal.gaps.find((g) => g.skill === "REST APIs");
  assert.deepStrictEqual(rest.courses, [{ id: "k1", title: "REST APIs with Express" }]);
  assert.strictEqual(state.goal.skills.find((s) => s.skill === "SQL").source, "MASTERY");
});
