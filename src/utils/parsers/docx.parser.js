const mammoth = require("mammoth");
const { normalizeQuestion } = require("../helpers/question.helper");

const parseDOCX = async (filePath) => {
    const result = await mammoth.extractRawText({
        path: filePath
    });

    const text = result.value;

    const lines = text
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

    const questions = [];
    let currentQuestion = null;

    for (const line of lines) {
        // Question
        if (/^\d+[\.\)]/.test(line)) {
            if (currentQuestion) {
                questions.push(normalizeQuestion(currentQuestion));
            }

            currentQuestion = {
                question: line.replace(/^\d+[\.\)]/, "").trim(),
                options: [],
                correctAnswer: "",
                marks: 1
            };
            continue;
        }

        if (!currentQuestion) continue;

        // Option
        if (/^[A-F][\.\)]/i.test(line)) {
            currentQuestion.options.push(
                line.replace(/^[A-F][\.\)]/i, "").trim()
            );
            continue;
        }

        // Answer
        if (/^(Answer|Correct Answer):/i.test(line)) {
            currentQuestion.correctAnswer = line.replace(/^(Answer|Correct Answer):/i, "").trim();
            continue;
        }

        // Marks
        if (/^Marks:/i.test(line)) {
            currentQuestion.marks = Number(
                line.replace(/^Marks:/i, "").trim()
            );
            continue;
        }

        // Question Type
        if (/^Type:/i.test(line)) {
            currentQuestion.questionType = line.replace(/^Type:/i, "").trim();
            continue;
        }

        // Explanation
        if (/^Explanation:/i.test(line)) {
            currentQuestion.explanation = line.replace(/^Explanation:/i, "").trim();
            continue;
        }
    }

    if (currentQuestion) {
        questions.push(normalizeQuestion(currentQuestion));
    }

    return questions;
};

module.exports = {
    parseDOCX
};