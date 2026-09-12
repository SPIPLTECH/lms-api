const prisma = require("../../../config/database");
const { QUESTIONS_PER_DIFFICULTY, OPTIONS_PER_QUESTION, ENTRY_DIFFICULTIES, FALLBACK_MIN_TOTAL_QUESTIONS } = require("../constants");

const shuffle = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/**
 * When no LLM is configured (or generation fails validation), this samples
 * from real, human-authored `Question` rows already attached to the
 * course's quizzes instead of fabricating plausible-looking MCQs with
 * invented correct answers — inventing quiz content would be actively
 * misleading, not just a degraded feature. Only questions this LMS itself
 * already treats as real MCQs (exactly `OPTIONS_PER_QUESTION` options, a
 * correctAnswer that is one of those options verbatim) are eligible.
 *
 * @param {string} courseId
 * @param {{moduleId: string, title: string}[]} concepts - real module titles, for best-effort concept tagging
 * @returns {Promise<{concept: string, moduleId: string|null, difficulty: string, question: string, options: string[], correctAnswerIndex: number, explanation: string}[]|null>}
 *   null when there isn't enough real question data to assemble a credible assessment.
 */
const buildFallbackQuestionSet = async (courseId, concepts) => {
  const rows = await prisma.question.findMany({
    where: { quiz: { courseId }, status: "ACTIVE", isPublished: true },
    select: { id: true, question: true, options: true, correctAnswer: true, explanation: true, difficulty: true, topic: true, subject: true },
  });

  const conceptTitlesLower = concepts.map((c) => c.title.trim().toLowerCase());
  const resolveConceptForRow = (row) => {
    const label = (row.topic || row.subject || "").trim().toLowerCase();
    const matchIndex = conceptTitlesLower.indexOf(label);
    if (matchIndex >= 0) return concepts[matchIndex];
    return null;
  };

  const eligible = rows
    .filter(
      (row) =>
        Array.isArray(row.options) &&
        row.options.length === OPTIONS_PER_QUESTION &&
        typeof row.correctAnswer === "string" &&
        row.options.includes(row.correctAnswer) &&
        typeof row.question === "string" &&
        row.question.trim()
    )
    .map((row) => {
      const matchedConcept = resolveConceptForRow(row);
      return {
        concept: matchedConcept?.title || row.topic || row.subject || "General",
        moduleId: matchedConcept?.moduleId || null,
        difficulty: ENTRY_DIFFICULTIES.includes(row.difficulty) ? row.difficulty : "MEDIUM",
        question: row.question.trim(),
        options: row.options.map((o) => String(o).trim()),
        correctAnswerIndex: row.options.indexOf(row.correctAnswer),
        explanation: row.explanation?.trim() || "No explanation was provided for this question.",
      };
    });

  if (eligible.length < FALLBACK_MIN_TOTAL_QUESTIONS) return null;

  const byDifficulty = { EASY: [], MEDIUM: [], HARD: [] };
  for (const q of eligible) byDifficulty[q.difficulty].push(q);

  const selected = ENTRY_DIFFICULTIES.flatMap((difficulty) => shuffle(byDifficulty[difficulty]).slice(0, QUESTIONS_PER_DIFFICULTY));

  return selected.length >= FALLBACK_MIN_TOTAL_QUESTIONS ? selected : null;
};

module.exports = { buildFallbackQuestionSet };
