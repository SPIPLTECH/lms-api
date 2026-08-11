const { INTENT, INTENT_CONFIDENCE_THRESHOLD } = require("../constants");
const { KEYWORD_MAP } = require("./keywordMap");
const { clamp } = require("../utils/scoreMath.util");

const WORD_WEIGHT = 20;
const PHRASE_WEIGHT = 35;

/**
 * Scores every intent against the message, picks the highest. A message
 * with zero keyword hits anywhere classifies as GENERAL with 0 confidence —
 * an honest "I don't know" rather than a forced guess.
 *
 * @param {string} message
 * @returns {import("../types/mentor.types").IntentResult}
 */
const classifyIntent = (message) => {
  const normalized = (message || "").toLowerCase();

  let best = { intent: INTENT.GENERAL, confidence: 0, matchedKeywords: [] };

  for (const [intent, { words, phrases }] of Object.entries(KEYWORD_MAP)) {
    const matched = [];
    let score = 0;

    for (const word of words) {
      if (new RegExp(`\\b${word}\\b`, "i").test(normalized)) {
        score += WORD_WEIGHT;
        matched.push(word);
      }
    }
    for (const phrase of phrases) {
      if (normalized.includes(phrase)) {
        score += PHRASE_WEIGHT;
        matched.push(phrase);
      }
    }

    const confidence = Math.round(clamp(score));
    if (confidence > best.confidence) {
      best = { intent, confidence, matchedKeywords: matched };
    }
  }

  return best;
};

const isBelowConfidenceThreshold = (intentResult) => intentResult.confidence < INTENT_CONFIDENCE_THRESHOLD;

module.exports = { classifyIntent, isBelowConfidenceThreshold };
