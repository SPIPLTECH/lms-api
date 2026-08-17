const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateBktUpdate, clampProbability } = require("../src/modules/learner-model/bkt.service");
const { DEFAULT_BKT_PARAMS, BKT_THRESHOLDS } = require("../src/modules/learner-model/bkt.config");

test("BKT Math Engine - calculateBktUpdate", async (t) => {
  await t.test("correct answer increases mastery probability", () => {
    const result = calculateBktUpdate({
      priorMastery: 0.2,
      isCorrect: true,
    });

    assert.ok(result.newMastery > 0.2);
    assert.equal(result.priorMastery, 0.2);
    assert.ok(result.posteriorGivenObs > 0.2);
  });

  await t.test("incorrect answer decreases mastery probability relative to prior", () => {
    const result = calculateBktUpdate({
      priorMastery: 0.7,
      isCorrect: false,
    });

    assert.ok(result.newMastery < 0.7);
    assert.ok(result.posteriorGivenObs < 0.7);
  });

  await t.test("repeated correct answers increase mastery progressively towards 1.0", () => {
    let currentMastery = 0.2;
    for (let i = 0; i < 5; i++) {
      const res = calculateBktUpdate({
        priorMastery: currentMastery,
        isCorrect: true,
        attemptsCount: i + 1,
      });
      assert.ok(res.newMastery >= currentMastery);
      currentMastery = res.newMastery;
    }

    assert.ok(currentMastery >= 0.85);
  });

  await t.test("repeated incorrect answers decrease mastery progressively towards min bound", () => {
    let currentMastery = 0.8;
    for (let i = 0; i < 5; i++) {
      const res = calculateBktUpdate({
        priorMastery: currentMastery,
        isCorrect: false,
        attemptsCount: i + 1,
      });
      assert.ok(res.newMastery <= currentMastery);
      currentMastery = res.newMastery;
    }

    assert.ok(currentMastery <= 0.4);
  });

  await t.test("guessing and slipping parameters affect posterior calculation as mathematically defined", () => {
    // High guess probability (P(G) = 0.5) makes a correct answer less convincing of true knowledge
    const defaultRes = calculateBktUpdate({
      priorMastery: 0.2,
      isCorrect: true,
    });

    // P(L0)=0.2, P(T)=0.15, P(G)=0.2, P(S)=0.1
    // P(L|Correct) = [0.2 * 0.9] / [0.2 * 0.9 + 0.8 * 0.2] = 0.18 / (0.18 + 0.16) = 0.18 / 0.34 = 0.5294
    // P(L_t) = 0.5294 + (1 - 0.5294) * 0.15 = 0.5294 + 0.0706 = 0.6000
    assert.equal(defaultRes.posteriorGivenObs, 0.5294);
    assert.equal(defaultRes.newMastery, 0.6);
  });

  await t.test("mastery probability remains strictly bounded between 0 and 1", () => {
    const clampedMin = clampProbability(-0.5);
    const clampedMax = clampProbability(1.5);

    assert.equal(clampedMin, BKT_THRESHOLDS.PROBABILITY_MIN);
    assert.equal(clampedMax, BKT_THRESHOLDS.PROBABILITY_MAX);

    const resExtreme = calculateBktUpdate({
      priorMastery: 0.9999,
      isCorrect: true,
    });
    assert.ok(resExtreme.newMastery <= 0.9999);
    assert.ok(resExtreme.newMastery >= 0.0001);
  });

  await t.test("assigns correct status labels based on mastery thresholds", () => {
    const weakRes = calculateBktUpdate({ priorMastery: 0.1, isCorrect: false });
    assert.equal(weakRes.status, "WEAK");

    const devRes = calculateBktUpdate({ priorMastery: 0.4, isCorrect: true });
    assert.equal(devRes.status, "DEVELOPING");

    const mastRes = calculateBktUpdate({ priorMastery: 0.85, isCorrect: true });
    assert.equal(mastRes.status, "MASTERED");
  });
});
