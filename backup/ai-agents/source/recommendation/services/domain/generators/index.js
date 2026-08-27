const continueLearning = require("./continueLearning.generator");
const revision = require("./revision.generator");
const adaptiveQuiz = require("./adaptiveQuiz.generator");
const video = require("./video.generator");
const notes = require("./notes.generator");
const assignment = require("./assignment.generator");
const codingPractice = require("./codingPractice.generator");
const discussion = require("./discussion.generator");
const aiTutor = require("./aiTutor.generator");
const deadline = require("./deadline.generator");
const studyTasks = require("./studyTasks.generator");
const weeklyGoals = require("./weeklyGoals.generator");

/** Primary generators: independent, each reads only `context`. */
const PRIMARY_GENERATORS = [
  continueLearning,
  revision,
  adaptiveQuiz,
  video,
  notes,
  assignment,
  codingPractice,
  discussion,
  aiTutor,
  deadline,
];

/**
 * Runs every candidate generator against one StudentContext and returns the
 * flat, unranked candidate list. Composite generators (studyTasks,
 * weeklyGoals) run last and see the primary generators' output alongside
 * the raw context, so "today's tasks" always reflects the same signals the
 * individual recommendations do.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generateAllCandidates = (context) => {
  const primary = PRIMARY_GENERATORS.flatMap((generator) => generator.generate(context));

  const composite = [...studyTasks.generate(context, primary), ...weeklyGoals.generate(context)];

  return [...primary, ...composite];
};

module.exports = { generateAllCandidates, PRIMARY_GENERATORS };
