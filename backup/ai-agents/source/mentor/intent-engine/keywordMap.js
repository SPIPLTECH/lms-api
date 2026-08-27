const { INTENT } = require("../constants");

/**
 * Deterministic keyword/pattern classification — same "explainable formula,
 * not a black-box model" convention every prior agent's scoring has used
 * (no ML classifier library exists in this repo, and this stays testable
 * and debuggable without one). Each intent has single-word keywords
 * (weight 1) and multi-word phrases (weight 2, since a phrase match is a
 * stronger signal than a lone word).
 */
const KEYWORD_MAP = Object.freeze({
  [INTENT.LEARNING]: {
    words: ["course", "lesson", "module", "learn", "understand", "concept", "explain", "revise", "revision", "study", "syllabus", "topic"],
    phrases: ["study plan", "next lesson", "what should i learn", "how do i learn"],
  },
  [INTENT.ASSESSMENT]: {
    words: ["quiz", "exam", "test", "assignment", "score", "grade", "marks", "submission"],
    phrases: ["quiz prep", "quiz preparation", "how did i do", "assignment help"],
  },
  [INTENT.RECOMMENDATION]: {
    words: ["recommend", "suggestion", "suggest"],
    phrases: ["what should i do", "what should i do next", "any suggestions"],
  },
  [INTENT.CAREER]: {
    words: ["career", "roadmap", "profession", "industry"],
    phrases: ["career goal", "career path", "skill gap", "job role"],
  },
  [INTENT.PLACEMENT]: {
    words: ["placement", "internship", "interview", "resume", "cv", "offer", "company"],
    phrases: ["job application", "mock interview", "placement chances", "apply for"],
  },
  [INTENT.MOTIVATION]: {
    words: ["motivate", "motivation", "streak", "discouraged", "burnout", "encourage", "stuck", "tired"],
    phrases: ["want to give up", "feeling stuck", "losing motivation"],
  },
  [INTENT.ANALYTICS]: {
    words: ["analytics", "dashboard", "metrics", "kpi", "trend", "engagement"],
    phrases: ["performance report", "class performance", "course health"],
  },
  [INTENT.ADMINISTRATION]: {
    words: ["department", "faculty", "institution", "compliance", "audit", "policy", "governance"],
    phrases: ["strategic recommendation", "executive summary", "institution health"],
  },
  [INTENT.TECHNICAL_SUPPORT]: {
    words: ["bug", "error", "broken", "crash", "glitch"],
    phrases: ["not working", "can't access", "cannot access", "login issue", "can't log in"],
  },
  [INTENT.NAVIGATION]: {
    words: ["navigate", "page", "link", "menu"],
    phrases: ["where is", "how do i find", "how do i get to", "go to"],
  },
});

module.exports = { KEYWORD_MAP };
