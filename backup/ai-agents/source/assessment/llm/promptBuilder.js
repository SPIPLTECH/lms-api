const { QUESTIONS_PER_DIFFICULTY, OPTIONS_PER_QUESTION } = require("../constants");

/**
 * Renders the real course structure (Module -> Lesson titles/descriptions —
 * this LMS's closest equivalent to a "syllabus") and the student's profile
 * into a prompt that asks for a *unique*, structured 15-question set.
 * Concepts are constrained to real module titles so the evaluator can map
 * scores back to real course content (see domain/conceptResolver.js).
 *
 * @param {{title: string, description: string|null}} course
 * @param {{moduleId: string, title: string, description: string|null}[]} concepts
 * @param {object} profileSummary - only the fields relevant to personalization, already redacted of PII by the caller.
 */
const buildSystemPrompt = () =>
  `You are an assessment-design engine for an LMS. You generate a single student's entry (pre-course) knowledge assessment. ` +
  `You must return ONLY valid JSON matching the exact schema described by the user — no prose, no markdown fences, no commentary.`;

const buildUserPrompt = (course, concepts, profileSummary) => {
  const conceptList = concepts.map((c, i) => `${i + 1}. "${c.title}"${c.description ? ` — ${c.description}` : ""}`).join("\n");

  return `Course: "${course.title}"${course.description ? `\nCourse description: ${course.description}` : ""}

Concepts covered (each MUST be tested by at least one question — use the concept title EXACTLY as given as the "concept" field):
${conceptList}

Student profile (personalize question phrasing/examples to this background, never the difficulty distribution below):
${JSON.stringify(profileSummary)}

Generate exactly ${QUESTIONS_PER_DIFFICULTY} EASY, ${QUESTIONS_PER_DIFFICULTY} MEDIUM, and ${QUESTIONS_PER_DIFFICULTY} HARD multiple-choice questions (${QUESTIONS_PER_DIFFICULTY * 3} total). Cover every concept listed above at least once, spread across the three difficulty tiers. Each question must have exactly ${OPTIONS_PER_QUESTION} options, exactly one correct answer, and a short explanation of why the correct answer is correct.

Return ONLY a JSON object with this exact shape:
{
  "questions": [
    {
      "concept": "<one of the concept titles above, verbatim>",
      "difficulty": "EASY" | "MEDIUM" | "HARD",
      "question": "<question text>",
      "options": ["<option 1>", "<option 2>", "<option 3>", "<option 4>"],
      "correctAnswerIndex": <0-3>,
      "explanation": "<why the correct option is correct>"
    }
  ]
}`;
};

module.exports = { buildSystemPrompt, buildUserPrompt };
