/**
 * One revision candidate per weak topic from Student State's own
 * performance.weakTopics — this agent never re-derives weakness itself,
 * it only reads Student State's already-computed signal (same discipline
 * Recommendation Agent's REVIEW_WEAK_TOPICS generator uses for Assessment's
 * knowledge gaps).
 *
 * @param {string[]} weakTopics
 * @param {string|null} courseId
 * @returns {{topic: string, reason: string, courseId: string|null}[]}
 */
const detectRevisionTopics = (weakTopics, courseId) =>
  (weakTopics || []).map((topic) => ({
    topic,
    reason: `"${topic}" is a detected weak spot — revisiting it now prevents it compounding into later lessons.`,
    courseId: courseId || null,
  }));

module.exports = { detectRevisionTopics };
