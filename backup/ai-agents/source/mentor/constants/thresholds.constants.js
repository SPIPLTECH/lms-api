module.exports = Object.freeze({
  // --- Intent classification -------------------------------------------
  // Below this, the pipeline short-circuits to a clarifying question
  // instead of guessing which agents to query or spending an LLM call.
  INTENT_CONFIDENCE_THRESHOLD: 40,

  // --- Conversation memory ----------------------------------------------
  // Messages beyond this count (oldest-first) get compacted into
  // ConversationSummary; the most recent ones stay verbatim in the prompt.
  RECENT_MESSAGES_VERBATIM_COUNT: 10,
  SUMMARY_TRIGGER_MESSAGE_COUNT: 20,

  // --- Context gathering --------------------------------------------------
  RECENT_ACTIVITY_EVENT_LIMIT: 15, // Observation event-log rows pulled for "Recent Activities"
  AGENT_CALL_TIMEOUT_MS: 8000, // a single downstream agent call slower than this is recorded as TIMEOUT, not left hanging

  // --- LLM ------------------------------------------------------------
  LLM_MODEL: "claude-sonnet-4-5",
  LLM_MAX_TOKENS: 1024,
  LLM_TEMPERATURE: 0.4, // low — this agent explains/summarizes trusted data, it isn't creative-writing

  // --- History pagination ----------------------------------------------
  HISTORY_PAGE_SIZE: 20,
});
