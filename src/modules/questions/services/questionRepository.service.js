/**
 * questionRepository.service.js
 * Business logic service for Question Repository (Question Bank).
 */

const prisma = require("../../../config/database");
const QuestionUploadParser = require("./QuestionUploadParser");

class QuestionRepositoryService {
  /**
   * Search and filter paginated repository questions
   * @param {Object} params Filter & pagination options
   * @param {Object} user Logged in user (role, id)
   */
  async getQuestions(params = {}, user = {}) {
    const {
      search = "",
      subject = "",
      topic = "",
      difficulty = "",
      questionType = "",
      tags = "",
      status = "",
      instructorId = "",
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = params;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    // Role Scoping
    if (user.role === "ADMIN") {
      if (instructorId) {
        where.createdBy = instructorId;
      }
    } else {
      // INSTRUCTOR: see own created questions or system/legacy questions
      where.OR = [
        { createdBy: user.id },
        { createdBy: null },
      ];
    }

    // Status filter
    if (status) {
      where.status = status;
    } else {
      // By default show ACTIVE questions unless specifically requesting ARCHIVED
      where.status = { not: "DELETED" };
    }

    // Filters
    if (search) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { question: { contains: search, mode: "insensitive" } },
          { tags: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    if (subject) {
      where.subject = { equals: subject, mode: "insensitive" };
    }

    if (topic) {
      where.topic = { equals: topic, mode: "insensitive" };
    }

    if (difficulty) {
      where.difficulty = difficulty.toUpperCase();
    }

    if (questionType) {
      where.questionType = questionType.toUpperCase();
    }

    if (tags) {
      where.tags = { contains: tags, mode: "insensitive" };
    }

    const [total, items] = await Promise.all([
      prisma.question.count({ where }),
      prisma.question.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [sortBy]: sortOrder },
        include: {
          creator: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { quizQuestions: true },
          },
        },
      }),
    ]);

    // Format usedInQuizzes count for easy consumption
    const formattedItems = items.map((item) => ({
      ...item,
      usedInQuizzesCount: item._count.quizQuestions,
    }));

    return {
      data: formattedItems,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get single repository question by ID
   * @param {string} id 
   * @param {Object} user 
   */
  async getQuestionById(id, user) {
    const question = await prisma.question.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        quizQuestions: {
          include: {
            quiz: {
              select: { id: true, title: true, courseId: true },
            },
          },
        },
      },
    });

    if (!question) return null;

    // Check permission
    if (user.role !== "ADMIN" && question.createdBy && question.createdBy !== user.id) {
      const error = new Error("Access denied: You can only view your own questions.");
      error.statusCode = 403;
      throw error;
    }

    return {
      ...question,
      usedInQuizzes: question.quizQuestions.map((qq) => ({
        quizId: qq.quiz.id,
        quizTitle: qq.quiz.title,
        courseId: qq.quiz.courseId,
      })),
      usedInQuizzesCount: question.quizQuestions.length,
    };
  }

  /**
   * Create a single repository question manually
   * @param {Object} data 
   * @param {string} userId 
   */
  async createQuestion(data, userId) {
    if (!data.question || !data.question.trim()) {
      const error = new Error("Question text is required.");
      error.statusCode = 400;
      throw error;
    }
    if (!data.marks || data.marks <= 0) {
      const error = new Error("Marks must be greater than zero.");
      error.statusCode = 400;
      throw error;
    }

    return await prisma.question.create({
      data: {
        title: data.title || data.question.slice(0, 50),
        question: data.question.trim(),
        questionType: data.questionType || "MCQ_SINGLE",
        options: data.options || [],
        correctAnswer: data.correctAnswer || null,
        explanation: data.explanation || "",
        subject: data.subject || "General",
        topic: data.topic || "General",
        difficulty: data.difficulty || "MEDIUM",
        marks: parseInt(data.marks, 10) || 1,
        negativeMarks: parseFloat(data.negativeMarks) || 0,
        tags: Array.isArray(data.tags) ? data.tags.join(", ") : (data.tags || ""),
        status: "ACTIVE",
        createdBy: userId,
      },
    });
  }

  /**
   * Update repository question
   * @param {string} id 
   * @param {Object} data 
   * @param {Object} user 
   */
  async updateQuestion(id, data, user) {
    const existing = await prisma.question.findUnique({ where: { id } });
    if (!existing) {
      const error = new Error("Question not found.");
      error.statusCode = 404;
      throw error;
    }

    if (user.role !== "ADMIN" && existing.createdBy && existing.createdBy !== user.id) {
      const error = new Error("Access denied: You can only edit your own questions.");
      error.statusCode = 403;
      throw error;
    }

    const updateData = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.question !== undefined) updateData.question = data.question.trim();
    if (data.questionType !== undefined) updateData.questionType = data.questionType;
    if (data.options !== undefined) updateData.options = data.options;
    if (data.correctAnswer !== undefined) updateData.correctAnswer = data.correctAnswer;
    if (data.explanation !== undefined) updateData.explanation = data.explanation;
    if (data.subject !== undefined) updateData.subject = data.subject;
    if (data.topic !== undefined) updateData.topic = data.topic;
    if (data.difficulty !== undefined) updateData.difficulty = data.difficulty;
    if (data.marks !== undefined) updateData.marks = parseInt(data.marks, 10);
    if (data.negativeMarks !== undefined) updateData.negativeMarks = parseFloat(data.negativeMarks);
    if (data.tags !== undefined) {
      updateData.tags = Array.isArray(data.tags) ? data.tags.join(", ") : data.tags;
    }
    if (data.status !== undefined) updateData.status = data.status;

    return await prisma.question.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Delete or soft-delete repository question
   * @param {string} id 
   * @param {Object} user 
   */
  async deleteQuestion(id, user) {
    const existing = await prisma.question.findUnique({
      where: { id },
      include: { _count: { select: { quizQuestions: true } } },
    });

    if (!existing) {
      const error = new Error("Question not found.");
      error.statusCode = 404;
      throw error;
    }

    if (user.role !== "ADMIN" && existing.createdBy && existing.createdBy !== user.id) {
      const error = new Error("Access denied: You can only delete your own questions.");
      error.statusCode = 403;
      throw error;
    }

    // If question is used in quizzes, archive it instead of hard deleting to preserve quiz integrity
    if (existing._count.quizQuestions > 0) {
      return await prisma.question.update({
        where: { id },
        data: { status: "ARCHIVED" },
      });
    }

    return await prisma.question.delete({ where: { id } });
  }

  /**
   * Archive repository question
   * @param {string} id 
   * @param {Object} user 
   */
  async archiveQuestion(id, user) {
    const existing = await prisma.question.findUnique({ where: { id } });
    if (!existing) {
      const error = new Error("Question not found.");
      error.statusCode = 404;
      throw error;
    }

    if (user.role !== "ADMIN" && existing.createdBy && existing.createdBy !== user.id) {
      const error = new Error("Access denied.");
      error.statusCode = 403;
      throw error;
    }

    return await prisma.question.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });
  }

  /**
   * Duplicate repository question
   * @param {string} id 
   * @param {Object} user 
   */
  async duplicateQuestion(id, user) {
    const existing = await prisma.question.findUnique({ where: { id } });
    if (!existing) {
      const error = new Error("Question not found.");
      error.statusCode = 404;
      throw error;
    }

    return await prisma.question.create({
      data: {
        title: `${existing.title || "Question"} (Copy)`,
        question: existing.question,
        questionType: existing.questionType,
        options: existing.options,
        correctAnswer: existing.correctAnswer,
        explanation: existing.explanation,
        subject: existing.subject,
        topic: existing.topic,
        difficulty: existing.difficulty,
        marks: existing.marks,
        negativeMarks: existing.negativeMarks,
        tags: existing.tags,
        status: "ACTIVE",
        createdBy: user.id,
      },
    });
  }

  /**
   * Bulk upload questions from Excel, CSV, or JSON
   * @param {Buffer} buffer 
   * @param {string} filename 
   * @param {string} userId 
   */
  async bulkUploadQuestions(buffer, filename, userId) {
    const report = await QuestionUploadParser.parseAndValidate(buffer, filename, userId);

    if (report.validQuestions.length > 0) {
      await prisma.question.createMany({
        data: report.validQuestions,
      });
    }

    return {
      success: true,
      total: report.total,
      importedCount: report.successCount,
      failedCount: report.failedCount,
      duplicateCount: report.duplicateCount,
      errors: report.errors,
    };
  }
}

module.exports = new QuestionRepositoryService();
