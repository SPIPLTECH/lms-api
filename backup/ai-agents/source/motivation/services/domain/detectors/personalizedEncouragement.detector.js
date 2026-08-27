const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY } = require("../../../constants");

/**
 * PERSONALIZED_ENCOURAGEMENT: the soft-touch counterpart to
 * INACTIVITY_ALERT. Fires when the burnout heuristic says "back off, don't
 * push" (see burnoutHeuristic.js — the orchestrator computes this once per
 * cycle and passes the boolean in), or when dropout risk is elevated but
 * the student hasn't gone fully inactive — someone visibly struggling but
 * still showing up deserves encouragement, not another alert.
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @param {boolean} isBurnedOut
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detect = (context, isBurnedOut) => {
  const risk = context.learningState?.risk;
  const isElevatedRisk = risk?.dropoutRiskLevel === "MEDIUM" || risk?.dropoutRiskLevel === "HIGH";

  if (!isBurnedOut && !isElevatedRisk) return [];

  return [
    {
      type: MOTIVATION_ACTION_TYPE.PERSONALIZED_ENCOURAGEMENT,
      dedupeKey: "general",
      priority: MOTIVATION_PRIORITY.MEDIUM,
      triggerReason: isBurnedOut
        ? "You've been putting in a lot of effort — a short break can help it stick better than pushing through."
        : "Progress isn't always visible day to day — you're further along than it might feel.",
      confidence: 60,
      recommendedAt: context.now,
      metadata: { isBurnedOut, dropoutRiskLevel: risk?.dropoutRiskLevel || "LOW" },
    },
  ];
};

module.exports = { detect };
