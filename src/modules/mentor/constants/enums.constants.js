/** Mirrors the Prisma enums in schema.prisma — keep both in sync. */

const MESSAGE_ROLE = Object.freeze({
  USER: "USER",
  ASSISTANT: "ASSISTANT",
  SYSTEM: "SYSTEM",
});

const INTENT = Object.freeze({
  LEARNING: "LEARNING",
  ASSESSMENT: "ASSESSMENT",
  RECOMMENDATION: "RECOMMENDATION",
  CAREER: "CAREER",
  PLACEMENT: "PLACEMENT",
  MOTIVATION: "MOTIVATION",
  ANALYTICS: "ANALYTICS",
  ADMINISTRATION: "ADMINISTRATION",
  TECHNICAL_SUPPORT: "TECHNICAL_SUPPORT",
  NAVIGATION: "NAVIGATION",
  GENERAL: "GENERAL",
});

const CONVERSATION_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
});

const AGENT_INVOCATION_STATUS = Object.freeze({
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  TIMEOUT: "TIMEOUT",
});

const FEEDBACK_RATING = Object.freeze({
  HELPFUL: "HELPFUL",
  NOT_HELPFUL: "NOT_HELPFUL",
});

/** Mirrors schema.prisma's Role enum (User.role) — this module never defines its own copy, it just needs the three literal strings for role-aware branching. */
const USER_ROLE = Object.freeze({
  STUDENT: "STUDENT",
  INSTRUCTOR: "INSTRUCTOR",
  ADMIN: "ADMIN",
});

module.exports = { MESSAGE_ROLE, INTENT, CONVERSATION_STATUS, AGENT_INVOCATION_STATUS, FEEDBACK_RATING, USER_ROLE };
