const { EVENT_TYPES } = require("../../constants");
const { getNumber } = require("../../utils/eventPayload.util");
const { clamp } = require("../../utils/scoreMath.util");

/**
 * payload.percent (0-100) takes priority; falls back to
 * positionSeconds/durationSeconds if the emitter sent raw playback numbers.
 */
const derivePercent = (payload) => {
  const direct = getNumber(payload, "percent");
  if (direct !== null) return clamp(direct, 0, 100);

  const position = getNumber(payload, "positionSeconds");
  const duration = getNumber(payload, "durationSeconds");
  if (position !== null && duration && duration > 0) {
    return clamp((position / duration) * 100, 0, 100);
  }

  return null;
};

/**
 * @param {import("../../types/studentState.types").ProgressState} progress
 * @param {object} event - LearningEvent row
 * @returns {import("../../types/studentState.types").ProgressState}
 */
const reduceProgress = (progress, event) => {
  const next = {
    ...progress,
    // Any event carrying location ids updates "where the student currently is".
    currentCourseId: event.courseId || progress.currentCourseId,
    currentModuleId: event.moduleId || progress.currentModuleId,
    currentLessonId: event.lessonId || progress.currentLessonId,
  };

  switch (event.eventType) {
    case EVENT_TYPES.COURSE_COMPLETED: {
      next.coursesCompletedCount = progress.coursesCompletedCount + 1;
      // Compare against the pre-update snapshot — `next.currentCourseId`
      // was already overwritten with event.courseId above, which would
      // make this check trivially true for every completed course.
      if (!event.courseId || event.courseId === progress.currentCourseId) {
        next.courseCompletionPercent = 100;
      }
      break;
    }

    case EVENT_TYPES.MODULE_COMPLETED: {
      next.modulesCompletedCount = progress.modulesCompletedCount + 1;
      if (!event.moduleId || event.moduleId === progress.currentModuleId) {
        next.moduleCompletionPercent = 100;
      }
      break;
    }

    case EVENT_TYPES.LESSON_COMPLETED: {
      next.lessonsCompletedCount = progress.lessonsCompletedCount + 1;
      if (!event.lessonId || event.lessonId === progress.currentLessonId) {
        next.lessonCompletionPercent = 100;
      }
      break;
    }

    case EVENT_TYPES.VIDEO_PROGRESS: {
      const percent = derivePercent(event.payload);
      if (percent !== null) next.videoProgressPercent = percent;
      break;
    }

    case EVENT_TYPES.VIDEO_COMPLETED: {
      next.videoProgressPercent = 100;
      break;
    }

    case EVENT_TYPES.READING_PROGRESS: {
      const percent = derivePercent(event.payload);
      if (percent !== null) next.readingProgressPercent = percent;
      break;
    }

    case EVENT_TYPES.READING_COMPLETED: {
      next.readingProgressPercent = 100;
      break;
    }

    // Starting a new module/lesson resets the "current" fine-grained
    // progress bars — they describe the new target, not the one just left.
    case EVENT_TYPES.MODULE_STARTED: {
      next.moduleCompletionPercent = 0;
      break;
    }

    case EVENT_TYPES.LESSON_STARTED: {
      next.lessonCompletionPercent = 0;
      next.videoProgressPercent = 0;
      next.readingProgressPercent = 0;
      break;
    }

    default:
      break;
  }

  return next;
};

module.exports = { reduceProgress, derivePercent };
