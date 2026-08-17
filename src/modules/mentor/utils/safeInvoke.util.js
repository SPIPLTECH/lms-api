const { AGENT_INVOCATION_STATUS, AGENT_CALL_TIMEOUT_MS } = require("../constants");

/**
 * Runs one downstream agent call with a hard timeout, never throwing —
 * every result is a well-formed AgentCallResult (see types/mentor.types.js)
 * whether the call succeeded, failed, or timed out. This is what makes
 * Promise.allSettled-across-many-agents safe: one slow/broken peer agent
 * can never hang or crash the whole context-gathering pass.
 *
 * @param {import("../types/mentor.types").AgentCallDescriptor} descriptor
 * @returns {Promise<import("../types/mentor.types").AgentCallResult>}
 */
const safeInvoke = async ({ agentName, method, invoke }) => {
  const startedAt = Date.now();

  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("timeout")), AGENT_CALL_TIMEOUT_MS);
  });

  try {
    const data = await Promise.race([invoke(), timeout]);
    clearTimeout(timeoutHandle);
    return { agentName, method, status: AGENT_INVOCATION_STATUS.SUCCESS, durationMs: Date.now() - startedAt, data };
  } catch (error) {
    clearTimeout(timeoutHandle);
    const isTimeout = error?.message === "timeout";
    return {
      agentName,
      method,
      status: isTimeout ? AGENT_INVOCATION_STATUS.TIMEOUT : AGENT_INVOCATION_STATUS.FAILURE,
      durationMs: Date.now() - startedAt,
      errorMessage: error?.message || "unknown error",
    };
  }
};

/** Runs every descriptor in parallel — independent reads, no ordering dependency between them (see orchestrator/index.js doc comment). */
const safeInvokeAll = (descriptors) => Promise.all(descriptors.map(safeInvoke));

module.exports = { safeInvoke, safeInvokeAll };
