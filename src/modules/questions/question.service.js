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
// Helper: Verify Course Exists
// =========================
const verifyCourseExists = async (courseId) => {
    if (!courseId) {
        const error = new Error("courseId is required");
        error.statusCode = 400;
        throw error;
    }

    const course = await prisma.course.findUnique({
        where: { id: courseId },
    });

    if (!course) {
        const error = new Error(`Course with ID '${courseId}' not found`);
        error.statusCode = 404;
        throw error;
    }

    return course;
};

// =========================
// Helper: Verify Module Exists (and belongs to the given course, if provided)
// =========================
const verifyModuleExists = async (moduleId, courseId) => {
    if (!moduleId) return null;

    const module = await prisma.module.findUnique({
        where: { id: moduleId },
    });

    if (!module) {
        const error = new Error(`Module with ID '${moduleId}' not found`);
        error.statusCode = 404;
        throw error;
    }

    if (courseId && module.courseId !== courseId) {
        const error = new Error(`Module '${moduleId}' does not belong to course '${courseId}'`);
        error.statusCode = 400;
        throw error;
    }

    return module;
};

// =========================
// Get All Questions
// =========================
const getQuestions = async (filters = {}) => {
    const { quizId, courseId, moduleId } = filters;
    const where = {};
    if (quizId) where.quizId = quizId;
    if (courseId) where.courseId = courseId;
    if (moduleId) where.moduleId = moduleId;

    const questions = await prisma.question.findMany({
        where,
        include: {
            course: { select: { id: true, title: true } },
            module: { select: { id: true, title: true } },
            _count: { select: { quizQuestions: true } },
        },
        orderBy: [
            { order: "asc" },
            { createdAt: "asc" }
        ],
    });

    return questions.map(({ _count, ...q }) => ({
        ...q,
        usedInQuizzesCount: _count.quizQuestions,
    }));
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
        include: {
            course: { select: { id: true, title: true } },
            module: { select: { id: true, title: true } },
        },
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

    // A question always relates to a course; the quiz link is optional (a
    // repository question may not be attached to any quiz yet).
    if (!normalized.courseId) {
        const error = new Error("courseId is required");
        error.statusCode = 400;
        throw error;
    }
    await verifyCourseExists(normalized.courseId);
    await verifyModuleExists(normalized.moduleId, normalized.courseId);

    if (normalized.quizId) {
        await verifyQuizExists(normalized.quizId);
    }

    const validation = validateQuestion(normalized);
    if (!validation.isValid) {
        const error = new Error(`Validation failed: ${validation.errors.join(", ")}`);
        error.statusCode = 400;
        throw error;
    }

    return prisma.question.create({
        data: {
            quizId: normalized.quizId || null,
            courseId: normalized.courseId,
            moduleId: normalized.moduleId || null,
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

    // Verify all unique quizIds exist, and use them to default courseId
    // for any question that didn't explicitly specify one.
    const quizIds = [...new Set(formattedQuestions.map((q) => q.quizId))];
    const quizCourseMap = {};
    for (const qId of quizIds) {
        const quiz = await verifyQuizExists(qId);
        quizCourseMap[qId] = quiz.courseId;
    }
    formattedQuestions.forEach((q) => {
        if (!q.courseId) q.courseId = quizCourseMap[q.quizId];
    });

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
            quizId: q.quizId,
            courseId: q.courseId,
            moduleId: q.moduleId || null,
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

    const quiz = await verifyQuizExists(quizId);

    const { questions, report } = await importService.parseFile(file, quizId);

    if (questions.length === 0) {
        return report;
    }

    const inserted = await prisma.question.createManyAndReturn({
        data: questions.map((q) => ({
            quizId: q.quizId,
            courseId: q.courseId || quiz.courseId,
            moduleId: q.moduleId || null,
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
    if (data.quizId !== undefined) {
        if (data.quizId) await verifyQuizExists(data.quizId);
        updateData.quizId = data.quizId || null;
    }
    if (data.courseId !== undefined) {
        await verifyCourseExists(data.courseId);
        updateData.courseId = data.courseId;
    }
    if (data.moduleId !== undefined) {
        const courseIdForCheck = data.courseId !== undefined ? data.courseId : (await getQuestionById(questionId)).courseId;
        await verifyModuleExists(data.moduleId, courseIdForCheck);
        updateData.moduleId = data.moduleId || null;
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
    attachQuestionsToQuiz,
};