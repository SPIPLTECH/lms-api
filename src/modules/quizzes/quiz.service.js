const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");

const calculateSubmissionResult = (quiz, answers = []) => {
  const totalMarks = quiz.questions.reduce((sum, question) => sum + (question.marks || 1), 0);
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.selectedOption]));

  let score = 0;

  quiz.questions.forEach((question) => {
    const selectedOption = answerMap.get(question.id);

    if (selectedOption === question.correctAnswer) {
      score += question.marks || 1;
    }
  });

  const percentage = totalMarks === 0 ? 0 : Math.round((score / totalMarks) * 100);

  return {
    score,
    totalMarks,
    percentage,
    passed: percentage >= quiz.passingScore
  };
};

const getQuizzes = async (
  courseId
) => {
  const where = {};

  if (courseId) {
    where.courseId = courseId;
  }

  return prisma.quiz.findMany({
    where,
    include: {
      _count: {
        select: {
          questions: true
        }
      }
    }
  });
};

const getQuizById = async (
  quizId
) => {
  return prisma.quiz.findUnique({
    where: {
      id: quizId
    },
    include: {
      questions: true
    }
  });
};

const createQuiz = async (
  data
) => {
  const quiz = await prisma.quiz.create({
    data
  });

  try {
    const course = await prisma.course.findUnique({
      where: { id: quiz.courseId },
      select: { title: true }
    });

    if (course) {
      await notificationService.notifyEnrolledStudents(quiz.courseId, {
        title: "New Quiz Available 📝",
        message: `A new quiz "${quiz.title}" has been added to your course "${course.title}".`,
        type: "QUIZ_PUBLISHED",
        link: `/courses/${quiz.courseId}/quizzes`
      });
    }
  } catch (error) {
    console.error("Error sending quiz creation notification:", error.message);
  }

  return quiz;
};

const updateQuiz = async (
  quizId,
  data
) => {
  return prisma.quiz.update({
    where: {
      id: quizId
    },
    data
  });
};

const deleteQuiz = async (
  quizId
) => {
  return prisma.quiz.delete({
    where: {
      id: quizId
    }
  });
};

const submitQuiz = async (studentId, quizId, answers = []) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: true }
  });

  if (!quiz) {
    const error = new Error("Quiz not found");
    error.statusCode = 404;
    throw error;
  }

  const result = calculateSubmissionResult(quiz, answers);

  const submission = await prisma.quizSubmission.upsert({
    where: {
      studentId_quizId: {
        studentId,
        quizId
      }
    },
    update: {
      answers,
      score: result.score,
      totalMarks: result.totalMarks,
      percentage: result.percentage,
      passed: result.passed,
      submittedAt: new Date()
    },
    create: {
      studentId,
      quizId,
      answers,
      score: result.score,
      totalMarks: result.totalMarks,
      percentage: result.percentage,
      passed: result.passed
    }
  });

  // Notify the instructor
  try {
    const course = await prisma.course.findUnique({
      where: { id: quiz.courseId },
      select: { title: true, creatorId: true }
    });

    const student = await prisma.studentProfile.findUnique({
      where: { id: studentId },
      include: {
        user: {
          select: {
            name: true
          }
        }
      }
    });

    if (course && student) {
      await notificationService.createNotification(course.creatorId, {
        title: "Quiz Submitted 📝",
        message: `${student.user.name} submitted the quiz "${quiz.title}" for "${course.title}" (Score: ${result.percentage}%).`,
        type: "QUIZ_SUBMISSION",
        link: `/courses/${quiz.courseId}/quizzes`
      });
    }
  } catch (error) {
    console.error("Error creating quiz submission notification:", error.message);
  }

  return submission;
};

module.exports = {
  calculateSubmissionResult,
  getQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  submitQuiz
};