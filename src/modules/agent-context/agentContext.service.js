const motivation = require("../motivation");
const studyPlan = require("../study-plan");
const career = require("../career");

/**
 * Mentor front door (adaptive Phase 7) — what the AI assistant knows about
 * the learner it is talking to, gathered from the other agents.
 *
 * The removed Mentor agent orchestrated every agent itself; here the live
 * ai-assistant stays in charge of the conversation and simply receives this
 * small, provenance-labelled fact block. Only stored agent state is read (no
 * recomputes), each agent call is time-boxed and always resolves (the
 * original's safeInvoke), so a slow or broken agent can never delay or break
 * a chat turn.
 *
 * Deliberately excluded: Learning Health risk levels. A student is never
 * told they are "at risk" — the assistant gets the actionable facts instead
 * (what is due, what to do today, what to revisit).
 */

const AGENT_CALL_TIMEOUT_MS = 1500;

const isDisabled = () =>
  process.env.AGENT_CONTEXT_DISABLED === "true" ||
  (Boolean(process.env.NODE_TEST_CONTEXT) && process.env.AGENT_CONTEXT_ENABLE_IN_TESTS !== "true");

/** Resolves to {status: SUCCESS|FAILURE|TIMEOUT, value} — never rejects. */
async function safeInvoke(name, call, timeoutMs = AGENT_CALL_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ name, status: "TIMEOUT", value: null }), timeoutMs);
    if (typeof timer?.unref === "function") timer.unref();
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(call)
        .then((value) => ({ name, status: "SUCCESS", value })),
      timeout,
    ]);
  } catch (error) {
    console.warn("[agent-context] agent call failed", { name, error: error?.message });
    return { name, status: "FAILURE", value: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{studentId: string, courseId: string|null, now?: Date}} input
 * @returns {Promise<{streak: object|null, nudges: object[], plan: object|null, career: object|null}|null>}
 */
async function gatherLearnerContext({ studentId, courseId, now = new Date() }) {
  if (!studentId || isDisabled()) return null;

  const [streak, nudges, plan, goal] = await Promise.all([
    safeInvoke("motivation.getStreak", () => motivation.getStreak(studentId)),
    safeInvoke("motivation.getActiveNudges", () => motivation.getActiveNudges(studentId, { now })),
    courseId ? safeInvoke("studyPlan.getPlan", () => studyPlan.getPlan(studentId, courseId)) : { value: null },
    safeInvoke("career.getGoalSummary", () => career.getGoalSummary(studentId)),
  ]);

  return {
    streak: streak.value,
    nudges: (nudges.value ?? []).slice(0, 3),
    plan: plan.value,
    career: goal.value,
  };
}

const minutes = (n) => `${n} min`;

/**
 * Renders the gathered facts as short, labelled lines. Returns "" when there
 * is nothing worth saying, so the assistant's prompt is then exactly what it
 * would have been without this feature.
 */
function renderLearnerContext(context, { now = new Date() } = {}) {
  if (!context) return "";
  const lines = [];

  if (context.streak && context.streak.currentDays > 0) {
    const state = context.streak.status === "AT_RISK" ? " (not yet active today)" : "";
    lines.push(`- Learning streak (motivation agent): ${context.streak.currentDays} day(s) in a row${state}.`);
  }

  const today = now.toISOString().slice(0, 10);
  const todayPlan = context.plan?.days?.find((d) => d.date === today);
  if (context.plan) {
    if (context.plan.remainingSteps === 0) {
      lines.push("- Study plan (learning-path agent): every item in this course is complete.");
    } else {
      const items = (todayPlan?.items ?? []).map((i) => `${i.title} (${minutes(i.minutes)})`).join("; ");
      if (items) lines.push(`- Today's study plan for this course (learning-path agent): ${items}.`);
      const finish = context.plan.estimatedCompletionAt ? new Date(context.plan.estimatedCompletionAt).toISOString().slice(0, 10) : null;
      lines.push(
        `- Pace (learning-path agent): about ${minutes(context.plan.dailyMinutes)} a day, ${context.plan.remainingSteps} item(s) left` +
          (finish ? `, on track to finish around ${finish}.` : ".")
      );
      if (context.plan.adjustmentReason) lines.push(`- Plan note: ${context.plan.adjustmentReason}`);
    }
  }

  for (const nudge of context.nudges ?? []) {
    lines.push(`- Reminder (motivation agent): ${nudge.title}.`);
  }

  if (context.career) {
    const gaps = context.career.topGaps?.length ? ` Skills to build next: ${context.career.topGaps.join(", ")}.` : "";
    lines.push(`- Career goal (career agent): ${context.career.role}, readiness ${context.career.readinessLevel.toLowerCase()}.${gaps}`);
  }

  return lines.join("\n");
}

module.exports = { gatherLearnerContext, renderLearnerContext, safeInvoke, AGENT_CALL_TIMEOUT_MS };
