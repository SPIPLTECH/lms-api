const prisma = require("../../config/database");
const importService = require("./question.import.service");
const { normalizeQuestion } = require("../../utils/helpers/question.helper");
const { validateQuestion, validateQuestions } = require("../../utils/helpers/questionValidator");

// =========================
// Helper: Verify Quiz Exists
// =========================
const verifyQuizExists = async (quizId) => {
    if (!quizId) {
        const error = new Error("quizId is required");
        error.statusCode = 400;
        throw error;
    }

    const quiz = await prisma.quiz.findUnique({
        where: { id: quizId },
    });

    if (!quiz) {
        const error = new Error(`Quiz with ID '${quizId}' not found`);
        error.statusCode = 404;
        throw error;
    }

    return quiz;
};

// =========================
// Get All Questions
// =========================
const getQuestions = async (quizId) => {
    const where = {};
    if (quizId) {
        where.quizId = quizId;
    }

    return prisma.question.findMany({
        where,
        orderBy: [
            { order: "asc" },
            { createdAt: "asc" }
        ],
    });
};

// =========================
// Get Questions By Quiz
// =========================
const getQuestionsByQuizId = async (quizId) => {
    await verifyQuizExists(quizId);

    return prisma.question.findMany({
        where: { quizId },
        orderBy: [
            { order: "asc" },
            { createdAt: "asc" }
        ],
    });
};

// =========================
// Get Question By ID
// =========================
const getQuestionById = async (questionId) => {
    if (!questionId) {
        const error = new Error("questionId is required");
        error.statusCode = 400;
        throw error;
    }

    const question = await prisma.question.findUnique({
        where: { id: questionId },
    });

    if (!question) {
        const error = new Error(`Question with ID '${questionId}' not found`);
        error.statusCode = 404;
        throw error;
    }

    return question;
};

// =========================
// Create Single Question
// =========================
const createQuestion = async (data) => {
    const normalized = normalizeQuestion(data);

    if (!normalized.quizId) {
        const error = new Error("quizId is required");
        error.statusCode = 400;
        throw error;
    }

    await verifyQuizExists(normalized.quizId);

    const validation = validateQuestion(normalized);
    if (!validation.isValid) {
        const error = new Error(`Validation failed: ${validation.errors.join(", ")}`);
        error.statusCode = 400;
        throw error;
    }

    return prisma.question.create({
        data: {
            quizId: normalized.quizId,
            question: normalized.question,
            questionType: normalized.questionType,
            options: normalized.options,
            correctAnswer: normalized.correctAnswer,
            explanation: normalized.explanation,
            marks: normalized.marks,
            negativeMarks: normalized.negativeMarks,
            difficulty: normalized.difficulty,
            isRequired: normalized.isRequired,
            isPublished: normalized.isPublished,
            order: normalized.order
        },
    });
};

// =========================
// Bulk Create Questions
// =========================
const bulkCreateQuestions = async (questionsPayload, rootQuizId) => {
    let rawQuestions = questionsPayload;
    if (questionsPayload && !Array.isArray(questionsPayload) && Array.isArray(questionsPayload.questions)) {
        rawQuestions = questionsPayload.questions;
        if (!rootQuizId && questionsPayload.quizId) {
            rootQuizId = questionsPayload.quizId;
        }
    }

    if (!Array.isArray(rawQuestions) || !rawQuestions.length) {
        const error = new Error("Questions array must not be empty.");
        error.statusCode = 400;
        throw error;
    }

    const formattedQuestions = rawQuestions.map((q) => {
        const norm = normalizeQuestion(q);
        if (!norm.quizId && rootQuizId) {
            norm.quizId = rootQuizId;
        }
        return norm;
    });

    for (const q of formattedQuestions) {
        if (!q.quizId) {
            const error = new Error("quizId is required for each question or at root level.");
            error.statusCode = 400;
            throw error;
        }
    }

    // Verify all unique quizIds exist
    const quizIds = [...new Set(formattedQuestions.map((q) => q.quizId))];
    for (const qId of quizIds) {
        await verifyQuizExists(qId);
    }

    const { validQuestions, failedQuestions } = validateQuestions(formattedQuestions);

    if (validQuestions.length === 0) {
        return {
            total: rawQuestions.length,
            inserted: 0,
            failed: failedQuestions.length,
            errors: failedQuestions,
        };
    }

    const result = await prisma.question.createMany({
        data: validQuestions.map((q) => ({
            quizId: q.quizId,
            question: q.question,
            questionType: q.questionType,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            marks: q.marks,
            negativeMarks: q.negativeMarks,
            difficulty: q.difficulty,
            isRequired: q.isRequired,
            isPublished: q.isPublished,
            order: q.order
        })),
        skipDuplicates: true,
    });

    return {
        total: rawQuestions.length,
        inserted: result.count,
        failed: failedQuestions.length,
        errors: failedQuestions,
    };
};

// =========================
// Import Questions
// =========================
const importQuestions = async (file, quizId) => {
    if (!quizId) {
        const error = new Error("quizId is required for importing questions.");
        error.statusCode = 400;
        throw error;
    }

    await verifyQuizExists(quizId);

    const { questions, report } = await importService.parseFile(file, quizId);

    if (questions.length === 0) {
        return report;
    }

    const result = await prisma.question.createMany({
        data: questions.map((q) => ({
            quizId: q.quizId,
            question: q.question,
            questionType: q.questionType,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            marks: q.marks,
            negativeMarks: q.negativeMarks,
            difficulty: q.difficulty,
            isRequired: q.isRequired,
            isPublished: q.isPublished,
            order: q.order
        })),
        skipDuplicates: true,
    });

    report.inserted = result.count;
    return report;
};

// =========================
// Update Question
// =========================
const updateQuestion = async (questionId, data) => {
    await getQuestionById(questionId);

    const updateData = {};

    if (data.question !== undefined) updateData.question = String(data.question).trim();
    if (data.options !== undefined) updateData.options = data.options;
    if (data.correctAnswer !== undefined) updateData.correctAnswer = data.correctAnswer;
    if (data.explanation !== undefined) updateData.explanation = data.explanation ? String(data.explanation).trim() : null;
    if (data.marks !== undefined) updateData.marks = Math.max(0, Number(data.marks));
    if (data.negativeMarks !== undefined) updateData.negativeMarks = Math.max(0, Number(data.negativeMarks));
    if (data.questionType !== undefined) updateData.questionType = String(data.questionType).toUpperCase();
    if (data.difficulty !== undefined) updateData.difficulty = String(data.difficulty).toUpperCase();
    if (data.isRequired !== undefined) updateData.isRequired = Boolean(data.isRequired);
    if (data.isPublished !== undefined) updateData.isPublished = Boolean(data.isPublished);
    if (data.order !== undefined) updateData.order = data.order !== null && !isNaN(Number(data.order)) ? Number(data.order) : null;
    if (data.quizId !== undefined) {
        await verifyQuizExists(data.quizId);
        updateData.quizId = data.quizId;
    }

    return prisma.question.update({
        where: { id: questionId },
        data: updateData,
    });
};

// =========================
// Delete Question
// =========================
const deleteQuestion = async (questionId) => {
    await getQuestionById(questionId);

    return prisma.question.delete({
        where: { id: questionId },
    });
};

module.exports = {
    getQuestions,
    getQuestionsByQuizId,
    getQuestionById,
    createQuestion,
    bulkCreateQuestions,
    importQuestions,
    updateQuestion,
    deleteQuestion,
};