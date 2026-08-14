const test = require("node:test");
const assert = require("node:assert/strict");

const { generate: generateSkillDevelopment } = require("../ai/generators/skillDevelopment.generator");
const { generate: generatePortfolioCareer } = require("../ai/generators/portfolioCareer.generator");
const { generate: generateInterviewPrep } = require("../ai/generators/interviewPrep.generator");
const { generateAllCandidates } = require("../ai/generators");

test("skillDevelopment.generate escalates HIGH/CRITICAL gaps to a CERTIFICATION candidate, leaves LOW/MEDIUM as COURSE-only", () => {
  const candidates = generateSkillDevelopment({
    skillGaps: [
      { skillName: "React", gapSize: 70, severity: "CRITICAL", currentLevel: 10, requiredLevel: 80 },
      { skillName: "Git", gapSize: 10, severity: "LOW", currentLevel: 40, requiredLevel: 50 },
    ],
  });

  assert.ok(candidates.some((c) => c.type === "CERTIFICATION" && c.metadata.skillName === "React"));
  assert.ok(!candidates.some((c) => c.type === "CERTIFICATION" && c.metadata.skillName === "Git"));
  assert.ok(candidates.some((c) => c.type === "COURSE" && c.metadata.skillName === "Git"));
});

test("skillDevelopment.generate stays silent with no gaps", () => {
  assert.deepEqual(generateSkillDevelopment({ skillGaps: [] }), []);
});

test("portfolioCareer.generate withholds HACKATHON/OPEN_SOURCE_CONTRIBUTION below the readiness threshold", () => {
  const below = generatePortfolioCareer({ credentials: [], previousReadinessScore: 20 });
  const above = generatePortfolioCareer({ credentials: [], previousReadinessScore: 80 });

  assert.ok(!below.some((c) => c.type === "HACKATHON"));
  assert.ok(above.some((c) => c.type === "HACKATHON"));
  assert.ok(above.some((c) => c.type === "OPEN_SOURCE_CONTRIBUTION"));
});

test("portfolioCareer.generate always produces PORTFOLIO_IMPROVEMENT and RESUME_IMPROVEMENT", () => {
  const candidates = generatePortfolioCareer({ credentials: [], previousReadinessScore: 0 });
  assert.ok(candidates.some((c) => c.type === "PORTFOLIO_IMPROVEMENT"));
  assert.ok(candidates.some((c) => c.type === "RESUME_IMPROVEMENT"));
});

test("interviewPrep.generate withholds MOCK_INTERVIEW/INTERNSHIP_PREP for a NOT_READY student", () => {
  const notReady = generateInterviewPrep({ skillGaps: [], previousIndustryReadiness: "NOT_READY" });
  const approaching = generateInterviewPrep({ skillGaps: [], previousIndustryReadiness: "APPROACHING" });

  assert.ok(!notReady.some((c) => c.type === "MOCK_INTERVIEW"));
  assert.ok(approaching.some((c) => c.type === "MOCK_INTERVIEW"));
});

test("interviewPrep.generate always includes APTITUDE_PREP", () => {
  const candidates = generateInterviewPrep({ skillGaps: [], previousIndustryReadiness: "NOT_READY" });
  assert.ok(candidates.some((c) => c.type === "APTITUDE_PREP"));
});

test("generateAllCandidates concatenates every generator's output", () => {
  const context = { skillGaps: [], credentials: [], previousReadinessScore: 80, previousIndustryReadiness: "READY" };
  const all = generateAllCandidates(context);
  const bySkillDev = generateSkillDevelopment(context).length;
  const byPortfolio = generatePortfolioCareer(context).length;
  const byInterview = generateInterviewPrep(context).length;
  assert.equal(all.length, bySkillDev + byPortfolio + byInterview);
});
