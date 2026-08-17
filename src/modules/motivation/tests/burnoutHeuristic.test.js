const test = require("node:test");
const assert = require("node:assert/strict");

const { isLikelyBurnout } = require("../services/domain/burnoutHeuristic");

test("isLikelyBurnout is false with low effort regardless of trend", () => {
  assert.equal(
    isLikelyBurnout({ quizRetryCount: 0, aiHelpRequestCount: 0, dailyStudyTimeSeconds: 0, performanceTrend: "DECLINING" }),
    false
  );
});

test("isLikelyBurnout is false with high effort but improving performance", () => {
  assert.equal(
    isLikelyBurnout({ quizRetryCount: 5, aiHelpRequestCount: 0, dailyStudyTimeSeconds: 0, performanceTrend: "IMPROVING" }),
    false
  );
});

test("isLikelyBurnout is true with elevated quiz retries and flat/declining performance", () => {
  assert.equal(
    isLikelyBurnout({ quizRetryCount: 3, aiHelpRequestCount: 0, dailyStudyTimeSeconds: 0, performanceTrend: "STABLE" }),
    true
  );
});

test("isLikelyBurnout is true from sustained daily study time alone plus declining performance", () => {
  assert.equal(
    isLikelyBurnout({ quizRetryCount: 0, aiHelpRequestCount: 0, dailyStudyTimeSeconds: 4 * 3600, performanceTrend: "DECLINING" }),
    true
  );
});

test("isLikelyBurnout is true from elevated AI help requests plus stable performance", () => {
  assert.equal(
    isLikelyBurnout({ quizRetryCount: 0, aiHelpRequestCount: 5, dailyStudyTimeSeconds: 0, performanceTrend: "STABLE" }),
    true
  );
});
