const { safeJsonStringify } = require("../utils/textTruncate.util");
const { MESSAGE_ROLE } = require("../constants");

const CONTEXT_CHAR_BUDGET = 6000;

/**
 * Substitutes the three placeholders every seeded PromptTemplate uses
 * (see constants/promptTemplates.seed.js) — no general-purpose templating
 * engine is used or needed for three fixed slots.
 *
 * @param {string} template
 * @param {{context: string, summary: string, memory: string}} slots
 */
const fillTemplate = (template, slots) =>
  template.replace("{{context}}", slots.context).replace("{{summary}}", slots.summary).replace("{{memory}}", slots.memory);

/**
 * Renders the merged context down to a compact, LLM-readable block.
 * Provenance stays visible (each fact is nested under its source agent's
 * key) so the model never has to guess where a number came from.
 *
 * @param {import("../types/mentor.types").MergedContext} mergedContext
 */
const renderContextBlock = (mergedContext) => {
  const payload = {
    role: mergedContext.actor.role,
    dataFromAgents: mergedContext.byAgent,
    topSuggestions: mergedContext.rankedSuggestions.slice(0, 5),
    unreadNotificationCount: mergedContext.notifications.length,
    recentActivityCount: mergedContext.recentActivity.length,
    upcomingCalendarEvents: mergedContext.calendarEvents.slice(0, 5).map((e) => ({ title: e.title, date: e.date, type: e.type })),
  };
  return safeJsonStringify(payload, CONTEXT_CHAR_BUDGET);
};

/**
 * @param {string} systemTemplate - the seeded PromptTemplate.template for this role
 * @param {import("../types/mentor.types").MergedContext} mergedContext
 * @param {{summaryText: string|null, memoryFacts: Record<string, any>}} memory
 */
const buildSystemPrompt = (systemTemplate, mergedContext, memory) =>
  fillTemplate(systemTemplate, {
    context: renderContextBlock(mergedContext),
    summary: memory.summaryText || "(none yet)",
    memory: Object.keys(memory.memoryFacts).length > 0 ? safeJsonStringify(memory.memoryFacts, 1000) : "(nothing remembered yet)",
  });

/**
 * Builds the Anthropic-shaped messages array: recent verbatim turns +
 * the new user message. Older turns are already folded into the summary
 * placeholder above, not repeated here.
 *
 * @param {{role: string, content: string}[]} recentMessages - oldest first
 * @param {string} newUserMessage
 */
const buildMessages = (recentMessages, newUserMessage) => [
  ...recentMessages.map((m) => ({ role: m.role === MESSAGE_ROLE.ASSISTANT ? "assistant" : "user", content: m.content })),
  { role: "user", content: newUserMessage },
];

module.exports = { buildSystemPrompt, buildMessages, renderContextBlock, fillTemplate };
