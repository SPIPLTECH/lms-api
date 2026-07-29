/**
 * quizImport.service.js
 * Business logic service for importing repository questions into Quizzes via QuizQuestion junction table.
 */

const prisma = require("../../../config/database");

class QuizImportService {
  /**
   * Import selected question IDs from repository into a quiz
   * @param {string} quizId 
   * @param {Array<string>} questionIds 
   * @param {Object} user 
   */
  async importQuestionsToQuiz(quizId, questionIds = [], user = {}) {
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new Error("Quiz not found.");

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      throw new Error("No questions selected for import.");
    }

    // Find existing question links for this quiz
    const existingLinks = await prisma.quizQuestion.findMany({
      where: { quizId },
      select: { questionId: true, order: true },
    });

    const linkedQuestionIdSet = new Set(existingLinks.map((l) => l.questionId));
    let maxOrder = existingLinks.reduce((max, l) => Math.max(max, l.order || 0), 0);

    // Filter out questionIds already linked to this quiz
    const newQuestionIds = questionIds.filter((qId) => !linkedQuestionIdSet.has(qId));

    if (newQuestionIds.length === 0) {
      return {
        success: true,
        message: "Selected questions are already imported into this quiz.",
        importedCount: 0,
        totalQuizQuestions: existingLinks.length,
      };
    }

    // Fetch repository questions to inherit marks
    const questionsToImport = await prisma.question.findMany({
      where: { id: { in: newQuestionIds } },
    });

    // Create junction records in transaction
    await prisma.$transaction(
      questionsToImport.map((q) => {
        maxOrder++;
        return prisma.quizQuestion.create({
          data: {
            quizId,
            questionId: q.id,
            order: maxOrder,
            marks: q.marks || 1,
            isMandatory: true,
          },
        });
      }),
      {
        maxWait: 20000,
        timeout: 60000,
      }
    );

    const totalCount = await prisma.quizQuestion.count({ where: { quizId } });

    return {
      success: true,
      message: `Successfully imported ${questionsToImport.length} questions into quiz.`,
      importedCount: questionsToImport.length,
      totalQuizQuestions: totalCount,
    };
  }

  /**
   * Remove a question link from quiz (does NOT delete repository question)
   * @param {string} quizId 
   * @param {string} questionId 
   */
  async removeQuestionFromQuiz(quizId, questionId) {
    const link = await prisma.quizQuestion.findUnique({
      where: {
        quizId_questionId: { quizId, questionId },
      },
    });

    if (!link) {
      throw new Error("Question is not linked to this quiz.");
    }

    await prisma.quizQuestion.delete({
      where: {
        quizId_questionId: { quizId, questionId },
      },
    });

    return { success: true, message: "Question removed from quiz." };
  }

  /**
   * Reorder questions inside quiz
   * @param {string} quizId 
   * @param {Array<string>} orderedQuestionIds Array of question IDs in desired order
   */
  async reorderQuizQuestions(quizId, orderedQuestionIds = []) {
    if (!Array.isArray(orderedQuestionIds)) return;

    await prisma.$transaction(
      orderedQuestionIds.map((qId, idx) =>
        prisma.quizQuestion.update({
          where: {
            quizId_questionId: { quizId, questionId: qId },
          },
          data: { order: idx + 1 },
        })
      ),
      {
        maxWait: 20000,
        timeout: 60000,
      }
    );

    return { success: true, message: "Question order updated." };
  }

  /**
   * Override question marks inside quiz
   * @param {string} quizId 
   * @param {string} questionId 
   * @param {number} marks 
   */
  async updateQuizQuestionMarks(quizId, questionId, marks) {
    const marksNum = parseInt(marks, 10);
    if (isNaN(marksNum) || marksNum <= 0) {
      throw new Error("Marks must be a positive integer.");
    }

    return await prisma.quizQuestion.update({
      where: {
        quizId_questionId: { quizId, questionId },
      },
      data: { marks: marksNum },
    });
  }
}

module.exports = new QuizImportService();
