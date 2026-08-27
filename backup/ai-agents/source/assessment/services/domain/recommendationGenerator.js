const { MASTERY_STATUS, ASSESSMENT_TYPE, DIFFICULTY } = require("../../constants");

/**
 * Produces assessment *specifications* (concepts + difficulty + why), not
 * real Question/Quiz rows — this agent never authors course content. A
 * downstream system (instructor tooling, or a future content-generation
 * agent) is responsible for turning a recommendation into an actual quiz.
 *
 * Concepts are grouped into at most 3 recommendations per call — weak
 * concepts needing revision, developing concepts needing reinforcement,
 * and mastered concepts due for a spaced-repetition check — rather than
 * one recommendation per concept, since a real quiz covers several
 * related concepts at once.
 *
 * @param {import("../../types/assessment.types").ConceptMasteryState[]} masteryStates
 * @param {Date} now
 * @returns {import("../../types/assessment.types").AssessmentRecommendation[]}
 */
const generateRecommendations = (masteryStates, now) => {
  const recommendations = [];

  const weak = masteryStates.filter((m) => m.status === MASTERY_STATUS.WEAK);
  const developing = masteryStates.filter((m) => m.status === MASTERY_STATUS.DEVELOPING);
  const dueMastered = masteryStates.filter(
    (m) => m.status === MASTERY_STATUS.MASTERED && m.nextReassessmentAt && m.nextReassessmentAt <= now
  );

  if (weak.length > 0) {
    recommendations.push({
      type: ASSESSMENT_TYPE.REVISION,
      targetConcepts: weak.map((m) => m.concept),
      difficulty: DIFFICULTY.EASY,
      rationale: `${weak.length} concept(s) below the mastery threshold — revision recommended before further progress.`,
      courseId: weak[0].lastCourseId,
    });
  }

  if (developing.length > 0) {
    recommendations.push({
      type: ASSESSMENT_TYPE.ADAPTIVE,
      targetConcepts: developing.map((m) => m.concept),
      difficulty: DIFFICULTY.MEDIUM,
      rationale: `${developing.length} concept(s) partially mastered — adaptive quiz to reinforce and raise confidence.`,
      courseId: developing[0].lastCourseId,
    });
  }

  if (dueMastered.length > 0) {
    recommendations.push({
      type: ASSESSMENT_TYPE.ADAPTIVE,
      targetConcepts: dueMastered.map((m) => m.concept),
      difficulty: DIFFICULTY.HARD,
      rationale: `${dueMastered.length} mastered concept(s) due for spaced-repetition reassessment.`,
      courseId: dueMastered[0].lastCourseId,
    });
  }

  return recommendations;
};

module.exports = { generateRecommendations };
