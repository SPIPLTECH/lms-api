const { RECOMMENDATION_TYPE, PRIORITY_BY_RECOMMENDATION_TYPE, DIFFICULTY_ADJUSTMENT } = require("../../constants");
const { buildDedupeKey } = require("../../utils/dedupeKey.util");

/**
 * Assembles this agent's small, fixed set of recommendation candidates —
 * unlike Recommendation/CareerRecommendation, there's no large competing
 * pool to score and cap, just a handful of well-defined nudges built
 * directly from the sequencer/pace/revision engines' own outputs.
 *
 * @param {Object} inputs
 * @param {import("../../types/learningPath.types").SequenceItem|null} inputs.nextItem
 * @param {import("../../types/learningPath.types").SequenceItem[]} inputs.sequence
 * @param {string|null} inputs.courseId
 * @param {{topic:string, reason:string, courseId:string|null}[]} inputs.revisionTopics
 * @param {string} inputs.difficultyAdjustment
 * @param {string|null} inputs.currentLessonId - what Student State says the student is actively viewing.
 * @returns {import("../../types/learningPath.types").RecommendationCandidate[]}
 */
const buildRecommendations = ({ nextItem, sequence, courseId, revisionTopics, difficultyAdjustment, currentLessonId }) => {
  const candidates = [];

  if (nextItem) {
    candidates.push({
      type: RECOMMENDATION_TYPE.NEXT_LESSON,
      dedupeKey: buildDedupeKey(RECOMMENDATION_TYPE.NEXT_LESSON, nextItem.lessonId),
      reason: `Continue with "${nextItem.title}" — the next lesson in your course sequence.`,
      courseId,
      moduleId: nextItem.moduleId,
      lessonId: nextItem.lessonId,
      metadata: { estimatedMinutes: nextItem.estimatedMinutes },
    });

    // "Next module" only when the next lesson starts a module the student hasn't touched at all yet.
    const moduleAlreadyStarted = sequence.some((item) => item.moduleId === nextItem.moduleId && item.completed);
    if (!moduleAlreadyStarted) {
      candidates.push({
        type: RECOMMENDATION_TYPE.NEXT_MODULE,
        dedupeKey: buildDedupeKey(RECOMMENDATION_TYPE.NEXT_MODULE, nextItem.moduleId),
        reason: `You're about to start a new module — "${nextItem.title}" is its first lesson.`,
        courseId,
        moduleId: nextItem.moduleId,
        lessonId: null,
        metadata: {},
      });
    }
  }

  for (const revision of revisionTopics) {
    candidates.push({
      type: RECOMMENDATION_TYPE.REVISION,
      dedupeKey: buildDedupeKey(RECOMMENDATION_TYPE.REVISION, revision.topic),
      reason: revision.reason,
      courseId: revision.courseId,
      moduleId: null,
      lessonId: null,
      metadata: { topic: revision.topic },
    });
  }

  // A real signal: the student is actively viewing a lesson further along than the recommended next one -> they've navigated past incomplete earlier content.
  if (currentLessonId && nextItem && currentLessonId !== nextItem.lessonId) {
    const currentItem = sequence.find((item) => item.lessonId === currentLessonId);
    if (currentItem && currentItem.order > nextItem.order) {
      candidates.push({
        type: RECOMMENDATION_TYPE.PREREQUISITE,
        dedupeKey: buildDedupeKey(RECOMMENDATION_TYPE.PREREQUISITE, nextItem.lessonId),
        reason: `"${nextItem.title}" comes before what you're currently viewing — finishing it first will make the rest easier to follow.`,
        courseId,
        moduleId: nextItem.moduleId,
        lessonId: nextItem.lessonId,
        metadata: { skippedToLessonId: currentLessonId },
      });
    }
  }

  if (difficultyAdjustment !== DIFFICULTY_ADJUSTMENT.STANDARD) {
    candidates.push({
      type: RECOMMENDATION_TYPE.PACE_ADJUSTMENT,
      dedupeKey: buildDedupeKey(RECOMMENDATION_TYPE.PACE_ADJUSTMENT, "current"),
      reason:
        difficultyAdjustment === DIFFICULTY_ADJUSTMENT.EASE_UP
          ? "Recent quiz results suggest slowing down and reinforcing fundamentals before moving ahead."
          : "Strong recent performance and a fast learning pace suggest you can take on more per day.",
      courseId,
      moduleId: null,
      lessonId: null,
      metadata: { difficultyAdjustment },
    });
  }

  return candidates.map((candidate) => ({ ...candidate, priority: PRIORITY_BY_RECOMMENDATION_TYPE[candidate.type] }));
};

module.exports = { buildRecommendations };
