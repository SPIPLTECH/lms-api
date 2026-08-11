const test = require("node:test");
const assert = require("node:assert/strict");

const { safeInvoke, safeInvokeAll } = require("../utils/safeInvoke.util");

test("safeInvoke returns SUCCESS with the resolved data", async () => {
  const result = await safeInvoke({ agentName: "career", method: "getFullState", invoke: async () => ({ readinessScore: 80 }) });
  assert.equal(result.status, "SUCCESS");
  assert.deepEqual(result.data, { readinessScore: 80 });
  assert.ok(result.durationMs >= 0);
});

test("safeInvoke returns FAILURE (not a throw) when the underlying call rejects", async () => {
  const result = await safeInvoke({
    agentName: "career",
    method: "getFullState",
    invoke: async () => {
      throw new Error("no profile");
    },
  });
  assert.equal(result.status, "FAILURE");
  assert.equal(result.errorMessage, "no profile");
});

test("safeInvokeAll runs every descriptor even when one fails, never short-circuiting the batch", async () => {
  const results = await safeInvokeAll([
    { agentName: "a", method: "m", invoke: async () => "ok" },
    {
      agentName: "b",
      method: "m",
      invoke: async () => {
        throw new Error("boom");
      },
    },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].status, "SUCCESS");
  assert.equal(results[1].status, "FAILURE");
});
