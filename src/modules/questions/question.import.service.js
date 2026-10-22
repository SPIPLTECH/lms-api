const fs = require("fs");
const path = require("path");
const { parseFile: parseUploadedFile } = require("../../utils/fileParser");
const { validateQuestion, validateQuestions } = require("../../utils/helpers/questionValidator");
const { normalizeQuestion } = require("../../utils/helpers/question.helper");
const ApiError = require("../../utils/ApiError");

const removeTempFile = (file) => {
    if (file?.path && fs.existsSync(file.path)) {
        try {
            fs.unlinkSync(file.path);
        } catch (err) {
            console.error("Error deleting uploaded temp file:", err.message);
        }
    }
};

const parseFile = async (file) => {
    try {
        const parsedQuestions = await parseUploadedFile(file.path);

        if (!Array.isArray(parsedQuestions)) {
            throw new Error("File did not contain valid questions.");
        }

        // 1. Normalize each question first (so options/correctAnswer/types are formatted)
        const normalizedRows = parsedQuestions.map(q => normalizeQuestion(q));

        // 2. Validate normalized questions
        const { validQuestions, failedQuestions } = validateQuestions(normalizedRows);

        return {
            questions: validQuestions,
            report: {
                total: parsedQuestions.length,
                inserted: validQuestions.length,
                failed: failedQuestions.length,
                errors: failedQuestions,
            },
        };
    } finally {
        removeTempFile(file);
    }
};

// ---------------------------------------------------------------------------
// Preview for the Course Composer's quiz editor
// ---------------------------------------------------------------------------

const PREVIEW_MAX_FILE_BYTES = 5 * 1024 * 1024;
const PREVIEW_MAX_QUESTIONS = 200;

// The composer's quiz editor authors single- and multiple-choice questions
// (see lms_web_demo lib/questionType.js). A True/False question is a
// single-choice question with "True" and "False" options; every other type
// has no editor there yet, so it is reported rather than imported.
const COMPOSER_TYPES = {
    MCQ: "MCQ_SINGLE",
    MCQ_SINGLE: "MCQ_SINGLE",
    TRUE_FALSE: "MCQ_SINGLE",
    MULTIPLE_CORRECT: "MCQ_MULTI",
    MCQ_MULTI: "MCQ_MULTI",
};

const TYPE_NAMES = {
    SHORT_ANSWER: "Short-answer",
    LONG_ANSWER: "Long-answer",
    FILL_BLANK: "Fill-in-the-blank",
    ARRANGE_TOKENS: "Arrange-tokens",
    MATCH_PAIRS: "Match-pairs",
    SELF_ASSESSMENT: "Self-assessment",
};

const optionText = (opt) => (opt && typeof opt === "object" ? String(opt.optionText ?? opt.text ?? "") : String(opt));

const toPreviewItem = (row, index) => {
    // CSVs written by hand often call the column "type".
    const source = row && typeof row === "object" ? { ...row, questionType: row.questionType ?? row.type } : row;
    const q = normalizeQuestion(source);
    const problems = [...validateQuestion(q).errors];

    const questionType = COMPOSER_TYPES[q.questionType] || null;
    if (!questionType) {
        const name = TYPE_NAMES[q.questionType] || q.questionType;
        problems.push(`${name} questions can't be imported here yet. Only single- and multiple-choice questions can.`);
    }

    let correctAnswer = q.correctAnswer;
    if (questionType === "MCQ_SINGLE" && Array.isArray(correctAnswer)) {
        if (correctAnswer.length === 1) correctAnswer = correctAnswer[0];
        else problems.push("A single-choice question can have only one correct answer.");
    }
    if (questionType === "MCQ_MULTI" && !Array.isArray(correctAnswer)) {
        correctAnswer = correctAnswer ? [correctAnswer] : [];
    }

    return {
        row: index + 1,
        question: q.question,
        questionType: questionType || q.questionType,
        options: (q.options || []).map(optionText),
        correctAnswer,
        explanation: q.explanation || "",
        marks: q.marks || 1,
        difficulty: q.difficulty,
        problems: [...new Set(problems)],
    };
};

/**
 * Reads an uploaded question file and returns what it would import, row by
 * row, without writing anything. The composer shows this for review and adds
 * the chosen rows to the quiz being edited; they are saved with the quiz.
 */
const previewFile = async (file) => {
    try {
        if (file.size > PREVIEW_MAX_FILE_BYTES) {
            throw new ApiError(400, "This file is larger than 5 MB. Split it into smaller files and import them one at a time.");
        }

        let parsed;
        try {
            parsed = await parseUploadedFile(file.path);
        } catch (error) {
            throw new ApiError(400, `This file could not be read: ${error.message}`);
        }

        if (!Array.isArray(parsed) || parsed.length === 0) {
            const extension = path.extname(file.originalname || file.path || "").toLowerCase();
            throw new ApiError(
                400,
                extension === ".pdf"
                    ? "No questions were found in this PDF. If it is a scanned document there is no text to read; export it as text, or use the CSV template."
                    : "No questions were found in this file. Check that it follows the sample template."
            );
        }

        if (parsed.length > PREVIEW_MAX_QUESTIONS) {
            throw new ApiError(400, `This file has ${parsed.length} questions. Import at most ${PREVIEW_MAX_QUESTIONS} at a time.`);
        }

        const questions = parsed.map(toPreviewItem);
        const ready = questions.filter((q) => q.problems.length === 0).length;

        return {
            questions,
            summary: { total: questions.length, ready, withProblems: questions.length - ready },
        };
    } finally {
        removeTempFile(file);
    }
};

module.exports = {
    parseFile,
    previewFile,
    PREVIEW_MAX_QUESTIONS,
};
