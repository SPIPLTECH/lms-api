const anthropicProvider = require("./anthropicProvider");
const { buildSystemPrompt, buildUserPrompt } = require("./promptBuilder");
const { parseJsonResponse, validateQuestionSet } = require("./questionValidator");
const { buildFallbackQuestionSet } = require("./fallbackQuestionBank");

const attachModuleIds = (questions, concepts) => {
  const byTitle = new Map(concepts.map((c) => [c.title.trim().toLowerCase(), c.moduleId]));
  return questions.map((q) => ({ ...q, moduleId: byTitle.get(q.concept.trim().toLowerCase()) || null }));
};

/**
 * Generates the entry assessment's 15 questions. Real LLM call when
 * ANTHROPIC_API_KEY is configured and its output survives strict structural
 * validation; otherwise falls back to real human-authored questions already
 * in the course's quizzes (see fallbackQuestionBank.js). If neither path
 * can produce a credible set, returns an empty list with a `failureReason`
 * — never fabricated questions with invented correct answers.
 *
 * @param {{course: {id: string, title: string, description: string|null}, concepts: {moduleId: string, title: string, description: string|null}[], profileSummary: object}} input
 * @returns {Promise<{questions: object[], model: string|null, failureReason: string|null}>}
 */
const generateQuestions = async ({ course, concepts, profileSummary }) => {
  if (anthropicProvider.isConfigured()) {
    try {
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(course, concepts, profileSummary);
      const { text, model } = await anthropicProvider.generate({ systemPrompt, userPrompt });
      const parsed = parseJsonResponse(text);
      const validated = validateQuestionSet(
        parsed,
        concepts.map((c) => c.title)
      );
      return { questions: attachModuleIds(validated, concepts), model, failureReason: null };
    } catch (error) {
      console.error("[assessment:entry] LLM question generation failed, falling back to real question bank:", error.message);
    }
  }

  const fallback = await buildFallbackQuestionSet(course.id, concepts);
  if (fallback) {
    return { questions: fallback, model: "fallback-question-bank", failureReason: null };
  }

  return {
    questions: [],
    model: null,
    failureReason: anthropicProvider.isConfigured()
      ? "AI question generation failed and this course does not have enough existing quiz questions to build a fallback assessment."
      : "AI question generation is not configured and this course does not have enough existing quiz questions to build a fallback assessment.",
  };
};

module.exports = { generateQuestions };
