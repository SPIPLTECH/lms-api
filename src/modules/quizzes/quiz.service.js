const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");

const isAnswerCorrect = (selectedOption, correctAnswer, questionType) => {
  if (selectedOption === undefined || selectedOption === null) {
    return false;
  }

  const type = String(questionType || '').toUpperCase();

  // 1. MATCH_PAIRS (Object mapping match)
  if (type === "MATCH_PAIRS" || (typeof correctAnswer === "object" && correctAnswer !== null && !Array.isArray(correctAnswer))) {
    if (typeof selectedOption !== "object" || selectedOption === null || Array.isArray(selectedOption)) {
      return false;
    }
    const keysA = Object.keys(selectedOption);
    const keysB = Object.keys(correctAnswer);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => 
      Object.prototype.hasOwnProperty.call(correctAnswer, key) && 
      String(selectedOption[key]).trim().toLowerCase() === String(correctAnswer[key]).trim().toLowerCase()
    );
  }

  // 2. ARRANGE_TOKENS (Ordered Array match)
  if (type === "ARRANGE_TOKENS") {
    if (!Array.isArray(selectedOption) || !Array.isArray(correctAnswer)) return false;
    if (selectedOption.length !== correctAnswer.length) return false;
    return selectedOption.every((val, idx) => 
      String(val).trim().toLowerCase() === String(correctAnswer[idx]).trim().toLowerCase()
    );
  }

  // 3. MCQ_MULTI / MULTIPLE_CORRECT (Order-independent Array match)
  if (type === "MCQ_MULTI" || type === "MULTIPLE_CORRECT" || Array.isArray(correctAnswer) || Array.isArray(selectedOption)) {
    const selArr = Array.isArray(selectedOption)
      ? selectedOption.map(s => String(s).trim().toLowerCase())
      : [String(selectedOption).trim().toLowerCase()];
    const corrArr = Array.isArray(correctAnswer)
      ? correctAnswer.map(c => String(c).trim().toLowerCase())
      : [String(correctAnswer).trim().toLowerCase()];

    if (selArr.length !== corrArr.length) return false;
    selArr.sort();
    corrArr.sort();
    return selArr.every((val, idx) => val === corrArr[idx]);
  }

  // 4. Primitive types (MCQ_SINGLE, MCQ, TRUE_FALSE, FILL_BLANK, SHORT_ANSWER, LONG_ANSWER)
  const selStr = String(selectedOption).trim().toLowerCase();
  const corrStr = String(correctAnswer).trim().toLowerCase();
  return selStr === corrStr;
};

const calculateSubmissionResult = (quiz, answers = []) => {
  const questions = quiz.questions || [];
  const totalMarks = questions.reduce((sum, question) => sum + (question.marks || 1), 0);
  const answerMap = new Map((answers || []).map((answer) => [answer.questionId, answer.selectedOption]));

  let score = 0;

  questions.forEach((question) => {
    const selectedOption = answerMap.get(question.id);

    if (selectedOption !== undefined && selectedOption !== null && selectedOption !== "") {
      const qType = question.questionType || question.type;
      const correct = isAnswerCorrect(selectedOption, question.correctAnswer, qType);
      if (correct) {
        score += question.marks !== undefined ? Number(question.marks) : 1;
      } else if (question.negativeMarks && Number(question.negativeMarks) > 0) {
        score -= Number(question.negativeMarks);
      }
    }
  });

  const finalScore = Math.max(0, Number(score.toFixed(2)));
  const percentage = totalMarks === 0 ? 0 : Math.round((finalScore / totalMarks) * 100);

  return {
    score: finalScore,
    totalMarks,
    percentage,
    passed: percentage >= (quiz.passingScore || 0)
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

    if (course && quiz.isPublished) {
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