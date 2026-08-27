const { EVENT_TYPES, SPEEDS } = require("../../constants");
const { SPEED_SLOW_MAX, SPEED_FAST_MIN } = require("../../constants/thresholds.constants");
const { getNumber } = require("../../utils/eventPayload.util");
const { safeDivide, round2 } = require("../../utils/scoreMath.util");

const derivePreferredSpeed = (averageSpeed) => {
  if (averageSpeed === null) return null;
  if (averageSpeed <= SPEED_SLOW_MAX) return SPEEDS.SLOW;
  if (averageSpeed >= SPEED_FAST_MIN) return SPEEDS.FAST;
  return SPEEDS.NORMAL;
};

const argmax = (histogram) => {
  let bestHour = null;
  let bestCount = 0;
  histogram.forEach((count, hour) => {
    if (count > bestCount) {
      bestCount = count;
      bestHour = hour;
    }
  });
  return bestHour;
};

/**
 * @param {import("../../types/studentState.types").BehaviorState} behavior
 * @param {object} event
 * @returns {import("../../types/studentState.types").BehaviorState}
 */
const reduceBehavior = (behavior, event) => {
  const next = { ...behavior };

  const hour = new Date(event.createdAt).getUTCHours();
  next.hourHistogram = behavior.hourHistogram.map((count, h) => (h === hour ? count + 1 : count));
  next.preferredLearningHour = argmax(next.hourHistogram);

  switch (event.eventType) {
    case EVENT_TYPES.VIDEO_PLAYED: {
      if (event.contentId && event.contentId === behavior.lastPlayedContentId) {
        next.rewatchCount = behavior.rewatchCount + 1;
      }
      if (event.contentId) next.lastPlayedContentId = event.contentId;
      break;
    }

    case EVENT_TYPES.LESSON_STARTED: {
      const isNewLesson = event.lessonId && event.lessonId !== behavior.lastStartedLessonId;

      if (isNewLesson && behavior.lastStartedLessonId && !behavior.lastStartedLessonCompleted) {
        next.lessonSkipCount = behavior.lessonSkipCount + 1;
      }

      if (event.lessonId) {
        next.lastStartedLessonId = event.lessonId;
        next.lastStartedLessonCompleted = false;
      }
      break;
    }

    case EVENT_TYPES.LESSON_COMPLETED: {
      if (event.lessonId && event.lessonId === behavior.lastStartedLessonId) {
        next.lastStartedLessonCompleted = true;
      }
      break;
    }

    case EVENT_TYPES.QUIZ_STARTED: {
      if (event.quizId) {
        const alreadyStarted = behavior.startedQuizIds.includes(event.quizId);
        if (alreadyStarted) {
          next.quizRetryCount = behavior.quizRetryCount + 1;
        } else {
          next.startedQuizIds = [...behavior.startedQuizIds, event.quizId];
        }
      }
      break;
    }

    case EVENT_TYPES.AI_HINT_REQUESTED: {
      next.aiHelpRequestCount = behavior.aiHelpRequestCount + 1;
      break;
    }

    case EVENT_TYPES.VIDEO_SPEED_CHANGED: {
      const speed = getNumber(event.payload, "speed");
      if (speed !== null && speed > 0) {
        next.speedSumForAvg = behavior.speedSumForAvg + speed;
        next.speedSampleCount = behavior.speedSampleCount + 1;
        const average = round2(safeDivide(next.speedSumForAvg, next.speedSampleCount));
        next.preferredLearningSpeed = derivePreferredSpeed(average);
      }
      break;
    }

    default:
      break;
  }

  return next;
};

module.exports = { reduceBehavior, derivePreferredSpeed };
