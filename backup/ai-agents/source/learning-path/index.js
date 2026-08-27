const router = require("./routes/learningPath.routes");
const eventConsumer = require("./events/eventConsumer");
const dailySweepScheduler = require("./schedulers/dailySweep.scheduler");
const { learningPathBus } = require("./events/eventBus");
const { LEARNING_PATH_EVENT_NAMES } = require("./events/eventNames");
const learningPathService = require("./services/learningPath.service");

/**
 * Public surface of the Learning Path Agent:
 *
 *   const learningPath = require("../learning-path");
 *   learningPath.subscribe(learningPath.LEARNING_PATH_EVENT_NAMES.PATH_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /learning-path in app.js. `bootstrap()` wires the
 * live event subscription (Student State's update signal — the only
 * real-time trigger this agent's spec names) and a daily safety-net sweep.
 *
 * ---
 * Six agents already built in this series (Recommendation, Assessment,
 * Motivation, Teacher Insight, Analytics, Career Guidance) wired a
 * defensive try/require against this exact module path before it existed,
 * specifically so this moment would need zero changes on their side. This
 * index.js's exports were shaped to match precisely what each of them
 * already calls:
 *
 *   - subscribe / LEARNING_PATH_EVENT_NAMES.PATH_UPDATED — all six.
 *   - getFullState(studentId) — Recommendation, Assessment, Motivation
 *     (via their own studentContextBuilder.js), returns null rather than
 *     throwing when no path exists yet, same as every other agent's
 *     cross-agent-friendly read.
 *   - getBatchStates(studentIds) — Teacher Insight's course-wide context
 *     builder, one query instead of N.
 *
 * ---
 * This agent only generates and maintains personalized learning paths —
 * per the constraints, it never generates quiz questions, grades quizzes,
 * evaluates assignments, sends notifications, chats with students, or
 * modifies course content. It owns no source-of-truth learning data, only
 * its own path/plan/milestone/revision ledger, and reads Student State's
 * already-computed signals (progress, weak topics, preferredLearningSpeed,
 * pass rate) rather than re-deriving them from raw events.
 *
 * One documented gap in the current LMS domain shaped this module: there is
 * no explicit prerequisite-graph model anywhere in this codebase.
 * Module.order/Lesson.order already function as the de facto prerequisite
 * chain for this linear-course LMS — "prerequisite lesson" here means "the
 * next incomplete lesson in sequence," not a separate DAG structure that
 * doesn't exist to consult.
 */
const bootstrap = () => {
  eventConsumer.start();
  dailySweepScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: learningPathBus.subscribe.bind(learningPathBus),
  LEARNING_PATH_EVENT_NAMES,
  recalculate: learningPathService.recalculate,
  generateForStudent: learningPathService.generateForStudent,
  getFullState: learningPathService.getFullState,
  getBatchStates: learningPathService.getBatchStates,
};
