/**
 * Frontend-only helpers for AI Mentor conversation display.
 *
 * The backend always assigns a generic default title ("Learning Mentor
 * Session") when a MentorConversation is created, and there is no
 * title-update endpoint. To give conversations a meaningful label in the
 * history list without touching the backend, we derive a short title from
 * the first user message (deterministic keyword rules, no LLM call) and
 * cache it locally, keyed by conversation id.
 */

export const MENTOR_DEFAULT_TITLE = "Learning Mentor Session";

const TITLE_STORAGE_KEY = "mentor_conversation_title_overrides";

const TITLE_RULES = [
  { test: /quiz/i, title: "Quiz Help" },
  { test: /(dashboard|overall progress|my progress|completion rate|learning streak|how am i doing|my stats)/i, title: "Dashboard Progress" },
  { test: /(knowledge gap|weak area|concept|mastery|study next|what to study|what should i study|topics to review|what should i focus)/i, title: "Study Recommendation" },
  { test: /(course performance|how are my courses|teaching stats|instructor analytics)/i, title: "Course Performance" },
  { test: /(enrolled student|roster|student list|who is enrolled|need attention)/i, title: "Student Overview" },
  { test: /(platform overview|system stats)/i, title: "Platform Overview" },
  { test: /(active users|user breakdown|users count)/i, title: "User Statistics" },
  { test: /(course statistics|all courses|published vs draft)/i, title: "Course Statistics" },
];

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "am", "was", "were", "do", "does", "did",
  "can", "could", "should", "would", "will",
  "i", "me", "my", "mine", "you", "your", "yours", "we", "our", "ours",
  "he", "she", "it", "they", "them",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  "please", "help", "tell", "show", "give", "get", "see", "let", "know",
  "to", "of", "in", "on", "for", "and", "or", "but", "with", "about", "overall", "that", "this",
]);

const toTitleCase = (words) =>
  words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/**
 * Deterministically derives a short display title from a user's first
 * message in a conversation. No network/LLM calls.
 */
export function deriveConversationTitle(message) {
  if (!message || typeof message !== "string") return "New Conversation";
  const trimmed = message.trim();
  if (!trimmed) return "New Conversation";

  const matchedRule = TITLE_RULES.find((rule) => rule.test.test(trimmed));
  if (matchedRule) return matchedRule.title;

  const cleaned = trimmed.replace(/[?!.]+$/g, "");
  const allWords = cleaned.split(/\s+/).filter(Boolean);
  const meaningfulWords = allWords.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const picked = (meaningfulWords.length > 0 ? meaningfulWords : allWords).slice(0, 4);

  const title = toTitleCase(picked.map((w) => w.toLowerCase()));
  if (!title) return "New Conversation";
  return title.length > 40 ? `${title.slice(0, 40).trim()}...` : title;
}

/**
 * Resolves what to show for a conversation in the UI: a locally-derived
 * override (from the first message), the backend title if it's meaningful,
 * or a fallback for still-empty conversations.
 */
export function getConversationDisplayTitle(conversation, overrides = {}) {
  if (!conversation) return "New Conversation";
  if (overrides[conversation.id]) return overrides[conversation.id];
  if (conversation.title && conversation.title !== MENTOR_DEFAULT_TITLE) {
    return conversation.title;
  }
  return "New Conversation";
}

const isSameCalendarDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Splits conversations into "Today" and "Previous" buckets for the
 * lightweight history drawer, preserving the backend's ordering within
 * each bucket (most recent first).
 */
export function groupConversationsByRecency(conversations = []) {
  const now = new Date();
  const today = [];
  const previous = [];

  for (const conversation of conversations) {
    const timestamp = new Date(conversation.lastMessageAt || conversation.createdAt);
    if (isSameCalendarDay(timestamp, now)) {
      today.push(conversation);
    } else {
      previous.push(conversation);
    }
  }

  return { today, previous };
}

export function loadTitleOverrides() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TITLE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveTitleOverrides(overrides) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TITLE_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage may be unavailable (quota exceeded, private browsing) — non-fatal.
  }
}
