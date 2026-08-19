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
      throw new Error("Access denied: You can only view your own questions.");
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
      throw new Error("Question text is required.");
    }
    if (!data.marks || data.marks <= 0) {
      throw new Error("Marks must be greater than zero.");
    }

    // QuestionForm.jsx sends the selected type under `type`; other callers
    // (bulk import, course importer) send `questionType` — accept either.
    const questionType = data.questionType || data.type || "MCQ_SINGLE";
    // "Category / Concept tag" in QuestionForm.jsx has no dedicated column;
    // it's folded into `tags` alongside any tags explicitly supplied.
    const tagList = [
      ...(Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : []),
      ...(data.concept ? [data.concept] : []),
    ];

    const question = await prisma.question.create({
      data: {
        question: data.question.trim(),
        questionType,
        options: data.options ?? [],
        // correctAnswer is a required Json column — an empty string is a
        // valid JSON value, unlike a bare `null` on a non-nullable field.
        correctAnswer: data.correctAnswer ?? "",
        explanation: data.explanation || "",
        subject: data.subject || "General",
        topic: data.topic || "General",
        difficulty: String(data.difficulty || "MEDIUM").toUpperCase(),
        marks: parseInt(data.marks, 10) || 1,
        negativeMarks: parseFloat(data.negativeMarks) || 0,
        tags: tagList.join(", "),
        status: "ACTIVE",
        createdBy: userId,
      },
    });

    if (data.quizId) {
      const existingMax = await prisma.quizQuestion.aggregate({
        where: { quizId: data.quizId },
        _max: { order: true },
      });

      await prisma.quizQuestion.create({
        data: {
          quizId: data.quizId,
          questionId: question.id,
          order: (existingMax._max.order || 0) + 1,
          marks: question.marks,
        },
      });
    }

    return question;
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
      throw new Error("Question not found.");
    }

    if (user.role !== "ADMIN" && existing.createdBy && existing.createdBy !== user.id) {
      throw new Error("Access denied: You can only edit your own questions.");
    }

    const updateData = {};
    if (data.question !== undefined) updateData.question = data.question.trim();
    const questionType = data.questionType !== undefined ? data.questionType : data.type;
    if (questionType !== undefined) updateData.questionType = questionType;
    if (data.options !== undefined) updateData.options = data.options;
    if (data.correctAnswer !== undefined) updateData.correctAnswer = data.correctAnswer;
    if (data.explanation !== undefined) updateData.explanation = data.explanation;
    if (data.subject !== undefined) updateData.subject = data.subject;
    if (data.topic !== undefined) updateData.topic = data.topic;
    if (data.difficulty !== undefined) updateData.difficulty = String(data.difficulty).toUpperCase();
    if (data.marks !== undefined) updateData.marks = parseInt(data.marks, 10);
    if (data.negativeMarks !== undefined) updateData.negativeMarks = parseFloat(data.negativeMarks);
    if (data.tags !== undefined || data.concept !== undefined) {
      const tagList = [
        ...(Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : []),
        ...(data.concept ? [data.concept] : []),
      ];
      updateData.tags = tagList.join(", ");
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
      throw new Error("Question not found.");
    }

    if (user.role !== "ADMIN" && existing.createdBy && existing.createdBy !== user.id) {
      throw new Error("Access denied: You can only delete your own questions.");
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
    if (!existing) throw new Error("Question not found.");

    if (user.role !== "ADMIN" && existing.createdBy && existing.createdBy !== user.id) {
      throw new Error("Access denied.");
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
    if (!existing) throw new Error("Question not found.");

    return await prisma.question.create({
      data: {
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
