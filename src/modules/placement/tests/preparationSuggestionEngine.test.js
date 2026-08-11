const test = require("node:test");
const assert = require("node:assert/strict");

const { generatePreparationSuggestions } = require("../ai/preparationSuggestionEngine");

test("generatePreparationSuggestions includes MOCK_INTERVIEW only above the readiness threshold", () => {
  const below = generatePreparationSuggestions({
    interviewReadinessScore: 20,
    resumeQualityScore: 80,
    portfolioQualityScore: 80,
    missingSkillsCount: 0,
    topCompanyName: null,
  });
  const above = generatePreparationSuggestions({
    interviewReadinessScore: 80,
    resumeQualityScore: 80,
    portfolioQualityScore: 80,
    missingSkillsCount: 0,
    topCompanyName: null,
  });
  assert.ok(!below.some((s) => s.type === "MOCK_INTERVIEW"));
  assert.ok(above.some((s) => s.type === "MOCK_INTERVIEW"));
});

test("generatePreparationSuggestions includes CODING_ASSESSMENT only above the gap-count threshold", () => {
  const fewGaps = generatePreparationSuggestions({
    interviewReadinessScore: 0,
    resumeQualityScore: 80,
    portfolioQualityScore: 80,
    missingSkillsCount: 1,
    topCompanyName: null,
  });
  const manyGaps = generatePreparationSuggestions({
    interviewReadinessScore: 0,
    resumeQualityScore: 80,
    portfolioQualityScore: 80,
    missingSkillsCount: 5,
    topCompanyName: null,
  });
  assert.ok(!fewGaps.some((s) => s.type === "CODING_ASSESSMENT"));
  assert.ok(manyGaps.some((s) => s.type === "CODING_ASSESSMENT"));
});

test("generatePreparationSuggestions includes RESUME_IMPROVEMENT/PORTFOLIO_IMPROVEMENT only below 50", () => {
  const weak = generatePreparationSuggestions({
    interviewReadinessScore: 0,
    resumeQualityScore: 30,
    portfolioQualityScore: 30,
    missingSkillsCount: 0,
    topCompanyName: null,
  });
  assert.ok(weak.some((s) => s.type === "RESUME_IMPROVEMENT"));
  assert.ok(weak.some((s) => s.type === "PORTFOLIO_IMPROVEMENT"));
});

test("generatePreparationSuggestions includes COMPANY_SPECIFIC_PREP only when a top company exists", () => {
  const withCompany = generatePreparationSuggestions({
    interviewReadinessScore: 0,
    resumeQualityScore: 80,
    portfolioQualityScore: 80,
    missingSkillsCount: 0,
    topCompanyName: "TechNova Solutions",
  });
  const withoutCompany = generatePreparationSuggestions({
    interviewReadinessScore: 0,
    resumeQualityScore: 80,
    portfolioQualityScore: 80,
    missingSkillsCount: 0,
    topCompanyName: null,
  });
  assert.ok(withCompany.some((s) => s.type === "COMPANY_SPECIFIC_PREP"));
  assert.ok(!withoutCompany.some((s) => s.type === "COMPANY_SPECIFIC_PREP"));
});
