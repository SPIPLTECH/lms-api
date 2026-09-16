/**
 * Every tunable for the AI Assistant in one frozen object, so limits are
 * auditable in one place rather than scattered as magic numbers.
 */
const SCOPE = Object.freeze({
  GUEST: "GUEST",
  BROWSING: "BROWSING",
  ENROLLED: "ENROLLED",
});

const MESSAGE_ROLE = Object.freeze({
  USER: "USER",
  ASSISTANT: "ASSISTANT",
});

const LIMITS = Object.freeze({
  // Input. Matches the old Mentor's proven cap; long enough for a real
  // question, short enough that prompt-stuffing is not a viable attack.
  MAX_MESSAGE_CHARS: 4000,
  MAX_TITLE_CHARS: 120,

  // How many prior turns are replayed verbatim. The old Mentor used 6, which
  // was too short to follow a multi-step explanation; 12 (6 exchanges) costs
  // little at these context sizes.
  HISTORY_TURNS: 12,

  // Hard ceiling on retrieved LMS context handed to Gemini, in characters.
  // The whole point of contextBudget: a large course must never be dumped in.
  MAX_CONTEXT_CHARS: 24000,
  // No single chunk may monopolise the budget.
  MAX_CHUNK_CHARS: 6000,
  // Ceiling on how many sibling/nearby items are pulled in as periphery.
  MAX_RELATED_ITEMS: 12,

  // Gemini output cap for a chat turn. Deliberately far below the course
  // generator's 32768 — a chat reply that long is a bug, not a feature.
  MAX_OUTPUT_TOKENS: 2048,

  // Whole-turn wall clock, independent of the provider's own deadline.
  REQUEST_TIMEOUT_MS: 60000,

  // Conversation list page size.
  CONVERSATION_PAGE_SIZE: 50,
});

// Retrieval priority. Lower number = kept first when the budget is tight.
// Mirrors "nearest to what the student is looking at wins".
const PRIORITY = Object.freeze({
  ACTIVE_CONTENT: 1,
  ACTIVE_TOPIC: 2,
  ACTIVE_LESSON: 3,
  ACTIVE_MODULE: 4,
  RELATED: 5,
  COURSE: 6,
});

const SOURCE_TYPE = Object.freeze({
  COURSE: "COURSE",
  MODULE: "MODULE",
  LESSON: "LESSON",
  TOPIC: "TOPIC",
  CONTENT: "CONTENT",
});

// The single sentence the assistant must use when retrieval came back
// without enough grounding. Centralised so prompt and tests agree.
const INSUFFICIENT_CONTEXT_REPLY =
  "I don't have enough information in the available course material to answer that accurately.";

module.exports = Object.freeze({
  SCOPE,
  MESSAGE_ROLE,
  LIMITS,
  PRIORITY,
  SOURCE_TYPE,
  INSUFFICIENT_CONTEXT_REPLY,
});
