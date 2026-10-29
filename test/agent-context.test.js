process.env.TEST_DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:9/agent_context_no_db";

const test = require("node:test");
const assert = require("node:assert");

const service = require("../src/modules/agent-context/agentContext.service");
const motivation = require("../src/modules/motivation");
const studyPlan = require("../src/modules/study-plan");
const career = require("../src/modules/career");
const { buildTurn } = require("../src/modules/ai-assistant/prompts/userPrompt.builder");

// The invariants under test, for the Mentor front door:
//
//  1. A slow or failing agent never breaks or delays a turn past its timeout.
//  2. With no learner context the assistant's prompt is exactly what it was.
//  3. A student is never shown a risk label.

const NOW = new Date("2026-03-10T09:00:00.000Z");

function stub(t, target, methods) {
  const originals = {};
  for (const [name, fn] of Object.entries(methods)) {
    originals[name] = target[name];
    target[name] = fn;
  }
  t.after(() => Object.assign(target, originals));
}

const optIn = (t) => {
  process.env.AGENT_CONTEXT_ENABLE_IN_TESTS = "true";
  t.after(() => delete process.env.AGENT_CONTEXT_ENABLE_IN_TESTS);
};

test("safeInvoke resolves SUCCESS, FAILURE or TIMEOUT — never rejects", async (t) => {
  stub(t, console, { warn: () => {} });
  assert.deepStrictEqual(await service.safeInvoke("ok", async () => 42), { name: "ok", status: "SUCCESS", value: 42 });
  assert.deepStrictEqual(await service.safeInvoke("bad", async () => { throw new Error("x"); }), { name: "bad", status: "FAILURE", value: null });
  const started = Date.now();
  const slow = await service.safeInvoke("slow", () => new Promise((r) => setTimeout(r, 5_000)), 50);
  assert.strictEqual(slow.status, "TIMEOUT");
  assert.ok(Date.now() - started < 1_000);
});

test("gatherLearnerContext collects every agent and survives one failing", async (t) => {
  optIn(t);
  stub(t, console, { warn: () => {} });
  stub(t, motivation, {
    getStreak: async () => ({ currentDays: 4, status: "AT_RISK" }),
    getActiveNudges: async () => [{ title: "Essay is due in 5h" }, { title: "Time to revisit Loops" }],
  });
  stub(t, studyPlan, { getPlan: async () => { throw new Error("db down"); } });
  stub(t, career, { getGoalSummary: async () => ({ role: "Backend Developer", readinessLevel: "APPROACHING", topGaps: ["REST APIs"] }) });

  const context = await service.gatherLearnerContext({ studentId: "s1", courseId: "c1", now: NOW });
  assert.strictEqual(context.streak.currentDays, 4);
  assert.strictEqual(context.nudges.length, 2);
  assert.strictEqual(context.plan, null);
  assert.strictEqual(context.career.role, "Backend Developer");
});

test("disabled under the test runner unless opted in, and without a student", async () => {
  delete process.env.AGENT_CONTEXT_ENABLE_IN_TESTS;
  assert.strictEqual(await service.gatherLearnerContext({ studentId: "s1", courseId: "c1" }), null);
  assert.strictEqual(await service.gatherLearnerContext({ studentId: null, courseId: "c1" }), null);
});

test("rendered context is short, labelled by agent, and never mentions risk", () => {
  const text = service.renderLearnerContext(
    {
      streak: { currentDays: 4, status: "AT_RISK" },
      nudges: [{ title: "Essay is due in 5h" }],
      plan: {
        remainingSteps: 6,
        dailyMinutes: 30,
        estimatedCompletionAt: "2026-03-14T00:00:00.000Z",
        adjustmentReason: null,
        days: [{ date: "2026-03-10", items: [{ title: "Classes", minutes: 10 }, { title: "Quiz 1", minutes: 15 }] }],
      },
      career: { role: "Backend Developer", readinessLevel: "APPROACHING", topGaps: ["REST APIs", "SQL"] },
    },
    { now: NOW }
  );
  assert.match(text, /Learning streak \(motivation agent\): 4 day\(s\) in a row \(not yet active today\)\./);
  assert.match(text, /Today's study plan for this course \(learning-path agent\): Classes \(10 min\); Quiz 1 \(15 min\)\./);
  assert.match(text, /on track to finish around 2026-03-14/);
  assert.match(text, /Reminder \(motivation agent\): Essay is due in 5h\./);
  assert.match(text, /Career goal \(career agent\): Backend Developer, readiness approaching\. Skills to build next: REST APIs, SQL\./);
  assert.ok(!/risk|critical|dropout/i.test(text));
  assert.strictEqual(service.renderLearnerContext(null), "");
  assert.strictEqual(service.renderLearnerContext({ streak: { currentDays: 0 }, nudges: [], plan: null, career: null }), "");
});

test("buildTurn is byte-identical without learner context and fences it when present", () => {
  const base = { message: "What next?", history: [], contextChunks: [] };
  assert.strictEqual(buildTurn(base), buildTurn({ ...base, learnerContext: "" }));
  const withContext = buildTurn({ ...base, learnerContext: "- Learning streak (motivation agent): 4 day(s) in a row." });
  assert.match(withContext, /\[AUTHORISED LEARNER CONTEXT\][\s\S]*4 day\(s\) in a row\.\n\[END AUTHORISED LEARNER CONTEXT\]/);
  assert.ok(withContext.indexOf("[AUTHORISED LEARNER CONTEXT]") < withContext.indexOf("[STUDENT MESSAGE"));
});
