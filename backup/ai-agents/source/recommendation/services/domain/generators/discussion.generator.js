const { RECOMMENDATION_TYPE, DISCUSSION_LOOKBACK_DAYS } = require("../../../constants");

const DISCUSSION_TYPES = new Set([
  "DISCUSSION_POST_CREATED",
  "DISCUSSION_REPLY_CREATED",
  "DISCUSSION_POST_LIKED",
  "DISCUSSION_VIEWED",
]);

const ENGAGEMENT_TYPES = new Set([
  "LESSON_STARTED",
  "LESSON_COMPLETED",
  "QUIZ_COMPLETED",
  "VIDEO_PLAYED",
  "MODULE_COMPLETED",
]);

/**
 * Nudges a student to join their course's discussion when they're
 * demonstrably active in that course (recent lesson/quiz/video events) but
 * have never engaged with discussion — a participation gap, not a content
 * gap. No dedicated discussion-thread catalog exists to point at, so this
 * is an engagement nudge tied to the course, not a specific thread.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const lookbackMs = DISCUSSION_LOOKBACK_DAYS * 24 * 3600 * 1000;
  const cutoff = context.now.getTime() - lookbackMs;

  const recentByCourse = new Map();
  for (const event of context.recentEvents || []) {
    if (!event.courseId || new Date(event.createdAt).getTime() < cutoff) continue;
    if (!recentByCourse.has(event.courseId)) recentByCourse.set(event.courseId, { engaged: false, discussed: false });
    const bucket = recentByCourse.get(event.courseId);
    if (ENGAGEMENT_TYPES.has(event.eventType)) bucket.engaged = true;
    if (DISCUSSION_TYPES.has(event.eventType)) bucket.discussed = true;
  }

  const candidates = [];
  for (const [courseId, bucket] of recentByCourse) {
    if (bucket.engaged && !bucket.discussed) {
      candidates.push({
        type: RECOMMENDATION_TYPE.JOIN_DISCUSSION,
        dedupeKey: courseId,
        reason: "You're actively learning this course but haven't joined the discussion yet.",
        urgency: 20,
        impact: 35,
        confidence: 60,
        estimatedTimeMinutes: 10,
        courseId,
        metadata: {},
      });
    }
  }

  return candidates;
};

module.exports = { generate };
