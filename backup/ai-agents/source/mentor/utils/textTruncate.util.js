/**
 * Character-based budget, not a real tokenizer — no tokenizer library exists
 * in this repo's dependencies, so this is an honest approximation (~4 chars
 * per token is a common rule of thumb), not a precise token count.
 */
const truncateToCharBudget = (text, maxChars) => (text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`);

const safeJsonStringify = (value, maxChars) => truncateToCharBudget(JSON.stringify(value, null, 2), maxChars);

module.exports = { truncateToCharBudget, safeJsonStringify };
