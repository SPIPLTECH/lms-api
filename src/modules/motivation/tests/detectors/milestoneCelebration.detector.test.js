const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/milestoneCelebration.detector");
const { makeContext } = require("../helpers/makeContext");

test("milestoneCelebration.detect stays silent with no achievements or new streak milestones", () => {
  const context = makeContext();
  assert.deepEqual(detect(context, { newlyCrossedMilestones: [] }), []);
});

test("milestoneCelebration.detect celebrates a recently earned achievement", () => {
  const context = makeContext({
    recentAchievements: [{ achievementId: "ach_1", earnedAt: new Date(), achievement: { name: "First Quiz", xpReward: 10 } }],
  });
  const candidates = detect(context, { newlyCrossedMilestones: [] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].dedupeKey, "achievement:ach_1");
});

test("milestoneCelebration.detect celebrates a newly crossed streak milestone", () => {
  const context = makeContext();
  const candidates = detect(context, { newlyCrossedMilestones: [7] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].dedupeKey, "streak:7");
});

test("milestoneCelebration.detect combines both sources in one pass", () => {
  const context = makeContext({
    recentAchievements: [{ achievementId: "ach_1", earnedAt: new Date(), achievement: { name: "X", xpReward: 5 } }],
  });
  const candidates = detect(context, { newlyCrossedMilestones: [30] });
  assert.equal(candidates.length, 2);
});
