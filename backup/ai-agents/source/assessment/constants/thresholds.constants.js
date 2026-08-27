module.exports = Object.freeze({
  // Mastery EMA: how much a new observation moves the mastery score.
  // Higher = more reactive to recent performance, lower = more stable.
  MASTERY_EMA_ALPHA: 0.35,

  // Score thresholds (0-100).
  MASTERY_SCORE_THRESHOLD: 80,
  WEAK_SCORE_THRESHOLD: 50,

  // A concept isn't called MASTERED on score alone — confidence (sample
  // size + consistency) must also clear this bar, or it's just DEVELOPING.
  MASTERY_CONFIDENCE_THRESHOLD: 60,

  // Confidence ramps toward 100 as attempts grow: attempts / (attempts + K).
  CONFIDENCE_SAMPLE_SCALE: 3,

  RECENT_SCORES_WINDOW: 6,
  IMPROVEMENT_TREND_DELTA_POINTS: 5,

  // Spaced-repetition-style reassessment intervals, in days, by mastery status.
  REASSESSMENT_INTERVAL_DAYS: {
    MASTERED: 30,
    DEVELOPING: 10,
    WEAK: 3,
    UNASSESSED: null, // nothing to reassess yet — no evidence at all
  },

  // When Student State reports rising risk, shrink reassessment intervals
  // for not-yet-mastered concepts by this factor (sooner, not later).
  RISK_ESCALATION_INTERVAL_FACTOR: 0.5,
  RISK_ESCALATION_DROPOUT_THRESHOLD: 50, // dropoutRiskScore that triggers escalation

  // Payload discriminator for coding-exercise results riding on the
  // existing QUIZ_COMPLETED/ASSIGNMENT_SUBMITTED event types (see module
  // README in index.js) — no dedicated EventType exists for this yet.
  CODING_EXERCISE_TYPE: "CODING",
});
