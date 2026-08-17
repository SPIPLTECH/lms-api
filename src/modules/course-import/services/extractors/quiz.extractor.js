const fs = require("fs");
const csvParser = require("csv-parser");
const { normalizeQuestion } = require("../../../../utils/helpers/question.helper");

const looksLikeQuestionRow = (row) => Boolean(row && typeof row === "object" && (row.question || row.Question));

/** Converts a normalized question into the Composer's local quiz-block shape (see quizMapper.js on the frontend). */
const buildQuizBlockFromNormalized = (q, file) => {
  const options = q.options || [];
  const rawAnswers = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer].filter(Boolean);

  if (options.length > 0) {
    const indices = rawAnswers
      .map((a) => options.findIndex((opt) => String(opt).toLowerCase() === String(a).toLowerCase()))
      .filter((idx) => idx >= 0);

    if (indices.length > 0) {
      return {
        kind: "quiz",
        answerType: indices.length > 1 ? "chooseMultiple" : "chooseOne",
        question: q.question,
        options,
        correctAnswer: indices,
        explanation: q.explanation || "",
        points: q.marks || 1,
        attributes: { sourcePath: file.relativePath, difficulty: q.difficulty },
      };
    }
  }

  return {
    kind: "quiz",
    answerType: "fill-in-the-blanks",
    question: q.question,
    options: [],
    correctAnswer: rawAnswers.length ? [String(rawAnswers[0])] : [""],
    explanation: q.explanation || "",
    points: q.marks || 1,
    attributes: { sourcePath: file.relativePath, difficulty: q.difficulty },
  };
};

/** Detects a question-bank-shaped array (same shape question.import.service.js already accepts) and converts it to quiz blocks, or returns null if the data isn't question-shaped. */
const tryExtractQuizFromRows = (data, file) => {
  let rows = null;
  if (Array.isArray(data)) rows = data;
  else if (data && Array.isArray(data.questions)) rows = data.questions;

  if (!rows || !rows.some(looksLikeQuestionRow)) return null;

  const normalized = rows.map((r) => normalizeQuestion(r)).filter((q) => q.question);
  if (!normalized.length) return null;

  return normalized.map((q) => buildQuizBlockFromNormalized(q, file));
};

const extractFromFile = async (file) => {
  if (file.extension !== ".csv") return [];

  const rows = await new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(file.absolutePath)
      .pipe(csvParser())
      .on("data", (row) => results.push(row))
      .on("end", () => resolve(results))
      .on("error", reject);
  });

  return tryExtractQuizFromRows(rows, file) || [];
};

module.exports = { tryExtractQuizFromRows, extractFromFile };
