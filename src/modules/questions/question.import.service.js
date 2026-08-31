const fs = require("fs");
const { parseFile: parseUploadedFile } = require("../../utils/fileParser");
const { validateQuestions } = require("../../utils/helpers/questionValidator");
const { normalizeQuestion } = require("../../utils/helpers/question.helper");

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
        if (file?.path && fs.existsSync(file.path)) {
            try {
                fs.unlinkSync(file.path);
            } catch (err) {
                console.error("Error deleting uploaded temp file:", err.message);
            }
        }
    }
};

module.exports = {
    parseFile,
};