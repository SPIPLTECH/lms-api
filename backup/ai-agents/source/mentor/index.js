const router = require("./mentor.routes");
const promptTemplateRepository = require("./repositories/promptTemplate.repository");
const mentorService = require("./services/mentor.service");

/** Idempotent — safe to call on every boot. Fails soft (logs, doesn't crash) before the migration that creates these tables has run. */
const seedPromptTemplates = async () => {
  try {
    const count = await promptTemplateRepository.ensureSeeded();
    console.log(`[mentor] ${count} prompt template(s) seeded/verified`);
  } catch (error) {
    console.warn("[mentor] could not seed prompt templates yet (likely pre-migration) — will retry on next restart:", error.message);
  }
};

/**
 * Public surface of the AI Mentor Agent (Master Orchestrator) — the final
 * agent, and the only one with no `subscribe`/`*_EVENT_NAMES` export: it is
 * purely a consumer of the other 11 agents' public surfaces, never a
 * producer another agent would subscribe to. `router` is mounted at
 * `/mentor` in app.js. `bootstrap()` seeds the role-specific system
 * PromptTemplate rows (same seeded-catalog precedent as Career's
 * IndustryRole/Placement's Company) — there is nothing to subscribe to and
 * no scheduler, since every mentor turn is triggered directly by an
 * incoming chat request, not by a peer agent's event or a sweep.
 *
 * ---
 * Architecture: this agent sits above every other agent, not beside them —
 * "aggregates the aggregators" extended one more layer for a single
 * conversational surface. Every fact it presents comes from a peer agent's
 * own already-computed, already-trusted getter (see orchestrator/
 * agentSelector.js for the full (role, intent) -> agent-calls table) or
 * this LMS's own raw tables (Notification, CalendarEvent) — it never
 * recomputes what a peer agent already owns, and every write in this
 * module touches only its own 8 tables (MentorConversation, MentorMessage,
 * ConversationContext, AgentInvocation, MentorMemory, ConversationSummary,
 * PromptTemplate, ResponseFeedback) — never another agent's records.
 *
 * Pipeline (services/mentor.service.js#chat / #streamChat call
 * orchestrator/index.js#runTurn, then persist): Intent Detection (rule-
 * based keyword classifier, intent-engine/) -> Context Collection + Agent
 * Selection (orchestrator/agentSelector.js's declarative (role,intent) ->
 * agent-calls table) -> Parallel Agent Execution (utils/safeInvoke.util.js,
 * Promise.allSettled-shaped — one broken/slow peer agent can never hang or
 * crash the whole turn) -> Merge Results (context-engine/mergeContext.js —
 * every fact is provenance-labeled by source agent; where multiple agents'
 * outputs compete for attention as "you should do X" suggestions, their
 * own already-computed urgency/impact/priority ranks them, no fabricated
 * second-guessing of a peer's judgment) -> Reasoning Layer + Prompt
 * Construction (prompt-builder/, role-specific PromptTemplate + compacted
 * ConversationSummary + MentorMemory facts) -> Generate Final Response
 * (llm/, real @anthropic-ai/sdk call when ANTHROPIC_API_KEY is configured,
 * an honestly-labeled non-generative fallback built straight from the
 * merged context when it isn't) -> Store Conversation.
 *
 * Access control differs from every prior agent: this module is NOT
 * role-gated (STUDENT/INSTRUCTOR/ADMIN can all use it) — role only selects
 * which peer agents get queried and which system-prompt persona loads.
 * Access is ownership-based instead (utils/accessControl.util.js) — a user
 * only ever sees their own conversations, with no admin-override read
 * access, since this is a personal AI-assistant surface, not an
 * institutional report.
 *
 * Per the constraints, this agent never writes to another agent's tables,
 * never bypasses business rules (every read is through an already-public
 * getter), and never fabricates: the LLM's system prompt hard-constrains it
 * to the provided context, and the no-LLM-configured fallback path is
 * explicit about being non-generative rather than inventing plausible-
 * sounding prose.
 *
 * Honest domain gaps (documented, not fabricated):
 *
 * 1. No LLM integration existed anywhere in this codebase before this
 *    agent — llm/anthropicProvider.js is a real, production-ready
 *    integration, gated on `ANTHROPIC_API_KEY` being set; llm/
 *    fallbackProvider.js is the honest default when it isn't, same "real
 *    adapter seam, honest empty default" pattern as Placement's
 *    jobPortalProvider.js / Career's jobMarketProvider.js.
 * 2. The spec's `Conversation`/`ConversationMessage` model names collide
 *    with a real, live, socket-driven human-to-human chat feature already
 *    in this codebase (modules/conversations + modules/messages +
 *    src/socket) — this agent's models are named `MentorConversation`/
 *    `MentorMessage` instead (see schema.prisma's own doc comment on this
 *    agent's models).
 * 3. `AI_HINT_REQUESTED`/`AI_CHAT_*` are real Observation event types,
 *    already read by Analytics' AI_USAGE metric and Recommendation's
 *    thresholds, but never published by anything before this agent — every
 *    STUDENT chat turn now publishes AI_HINT_REQUESTED, activating that
 *    previously-dead consumer code (see services/mentor.service.js
 *    #publishAiHintEvent).
 * 4. No `UserPreference`/`StudentPreference` model exists anywhere in this
 *    schema — the spec's Context Engine "User Preferences" input has no
 *    real source to read from; not fabricated, simply omitted from the
 *    merged context.
 * 5. Cross-conversation "memory" is a small, fixed-vocabulary structured
 *    fact ledger (MentorMemory, see constants/memoryKeys.constants.js),
 *    not a semantic/embedding memory — this stack has no vector-store
 *    dependency to back real similarity retrieval.
 * 6. No SSE precedent existed anywhere in this codebase before
 *    `POST /mentor/stream` (controllers/mentor.controller.js#stream) —
 *    plain Express `res.write()` + `text/event-stream`, chosen over the
 *    existing Socket.IO layer since that layer is purpose-built for the
 *    unrelated human chat feature and the spec names this an HTTP POST
 *    endpoint, not a socket event.
 */
const bootstrap = () => {
  seedPromptTemplates();
};

module.exports = {
  router,
  bootstrap,
  chat: mentorService.chat,
  streamChat: mentorService.streamChat,
};
