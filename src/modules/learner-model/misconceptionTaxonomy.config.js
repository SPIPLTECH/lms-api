/**
 * Controlled Misconception Taxonomy (Phase 7A).
 *
 * A small, fixed vocabulary of misconception types. Both authored Tier 1
 * tags (Question.options[].misconceptionTag) and — in a later phase — any
 * LLM-classified type must be a key in this object; nothing outside this
 * list is ever allowed to reach KnowledgeGap.type. Expanding the taxonomy is
 * a plain code change (add a key, deploy) — no migration required, since
 * KnowledgeGap.type is a plain nullable string column, not a Prisma enum.
 */

const MISCONCEPTION_TAXONOMY = {
  FIFO_LIFO_CONFUSION: {
    label: "FIFO/LIFO Ordering Confusion",
    description:
      "Student appears to confuse first-in-first-out (queue) and last-in-first-out (stack) ordering.",
  },
  OFF_BY_ONE_ERROR: {
    label: "Off-By-One Error",
    description:
      "Student appears to miscount a boundary condition, typically an index or loop bound.",
  },
  SIGN_ERROR: {
    label: "Sign Error",
    description:
      "Student appears to confuse positive/negative direction or comparison operators.",
  },
  TERMINOLOGY_CONFUSION: {
    label: "Terminology Confusion",
    description:
      "Student appears to confuse two related but distinct technical terms.",
  },
  CONCEPTUAL_MISAPPLICATION: {
    label: "Conceptual Misapplication",
    description:
      "Student appears to apply a correct concept in the wrong context.",
  },
};

const isKnownMisconceptionType = (type) =>
  typeof type === "string" && Object.prototype.hasOwnProperty.call(MISCONCEPTION_TAXONOMY, type);

module.exports = {
  MISCONCEPTION_TAXONOMY,
  isKnownMisconceptionType,
};
