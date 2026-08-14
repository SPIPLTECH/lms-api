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
    if (quizId) {
        return getQuestionsByQuizId(quizId);
    }

    return prisma.question.findMany({
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

    const quizQuestions = await prisma.quizQuestion.findMany({
        where: { quizId },
        orderBy: { order: "asc" },
        include: { question: true }
    });

    return quizQuestions.map(qq => ({
        ...qq.question,
        marks: qq.marks,
        order: qq.order,
        quizQuestionId: qq.id
    }));
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

    const validation = validateQuestion(normalized);
    if (!validation.isValid) {
        const error = new Error(`Validation failed: ${validation.errors.join(", ")}`);
        error.statusCode = 400;
        throw error;
    }

    return prisma.question.create({
        data: {
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
// Attach newly-created questions to a quiz, appended after whatever
// questions the quiz already has.
// =========================
const attachQuestionsToQuiz = async (quizId, questionIds) => {
    if (!quizId || questionIds.length === 0) return;

    await verifyQuizExists(quizId);

    const existingMax = await prisma.quizQuestion.aggregate({
        where: { quizId },
        _max: { order: true },
    });
    let nextOrder = (existingMax._max.order || 0) + 1;

    await prisma.quizQuestion.createMany({
        data: questionIds.map((questionId) => ({
            quizId,
            questionId,
            order: nextOrder++,
        })),
        skipDuplicates: true,
    });
};

// =========================
// Bulk Create Questions
// =========================
const bulkCreateQuestions = async (questionsPayload, quizId = null) => {
    let rawQuestions = questionsPayload;
    if (questionsPayload && !Array.isArray(questionsPayload) && Array.isArray(questionsPayload.questions)) {
        rawQuestions = questionsPayload.questions;
    }

    if (!Array.isArray(rawQuestions) || !rawQuestions.length) {
        const error = new Error("Questions array must not be empty.");
        error.statusCode = 400;
        throw error;
    }

    if (quizId) {
        await verifyQuizExists(quizId);
    }

    const formattedQuestions = rawQuestions.map((q) => normalizeQuestion(q));

    const { validQuestions, failedQuestions } = validateQuestions(formattedQuestions);

    if (validQuestions.length === 0) {
        return {
            total: rawQuestions.length,
            inserted: 0,
            failed: failedQuestions.length,
            errors: failedQuestions,
        };
    }

    const inserted = await prisma.question.createManyAndReturn({
        data: validQuestions.map((q) => ({
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
            order: q.order,
            topic: q.topic || null
        })),
        skipDuplicates: true,
        select: { id: true },
    });

    await attachQuestionsToQuiz(quizId, inserted.map((q) => q.id));

    return {
        total: rawQuestions.length,
        inserted: inserted.length,
        failed: failedQuestions.length,
        errors: failedQuestions,
    };
};

// =========================
// Import Questions
// =========================
const importQuestions = async (file, quizId = null) => {
    if (quizId) {
        await verifyQuizExists(quizId);
    }

    const { questions, report } = await importService.parseFile(file);

    if (questions.length === 0) {
        return report;
    }

    const inserted = await prisma.question.createManyAndReturn({
        data: questions.map((q) => ({
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
            order: q.order,
            topic: q.topic || null
        })),
        skipDuplicates: true,
        select: { id: true },
    });

    await attachQuestionsToQuiz(quizId, inserted.map((q) => q.id));

    report.inserted = inserted.length;
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