const fs = require("fs");
// pdf-parse v2 exports a PDFParse class (the v1 default-export function no
// longer exists), the same API course-import's pdf.extractor uses.
const { PDFParse } = require("pdf-parse");

const pdfText = async (buffer) => {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
        return { text: (await parser.getText()).text || "" };
    } finally {
        await parser.destroy();
    }
};
const { normalizeQuestion } = require("../helpers/question.helper");

const parsePDF = async (filePath) => {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfText(buffer);

    const lines = data.text
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

        // Options
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
    }

    if (currentQuestion) {
        questions.push(normalizeQuestion(currentQuestion));
    }

    return questions;
};

module.exports = {
    parsePDF
};