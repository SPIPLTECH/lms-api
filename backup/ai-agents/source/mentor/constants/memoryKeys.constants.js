/**
 * Fixed vocabulary for MentorMemory — a small, deliberately closed set of
 * cross-conversation facts, not an open-ended/fabricated semantic memory
 * (this stack has no vector-store dependency to back real embedding
 * retrieval). Each key's value shape is documented inline.
 */
const MEMORY_KEY = Object.freeze({
  /** { intent, at } — the last classified intent, used to weight follow-up-question disambiguation. */
  LAST_INTENT: "LAST_INTENT",
  /** { targetRoleId, targetRoleTitle, at } — mirrors CareerGoal, cached so the mentor doesn't need to re-fetch it every turn. */
  CAREER_GOAL: "CAREER_GOAL",
  /** { courseId, courseTitle, at } — most recently discussed course, for pronoun/follow-up resolution ("how am I doing in it?"). */
  LAST_DISCUSSED_COURSE: "LAST_DISCUSSED_COURSE",
  /** { topic, at } — free-text label of the last study/revision topic discussed. */
  LAST_STUDY_TOPIC: "LAST_STUDY_TOPIC",
});

module.exports = { MEMORY_KEY };
