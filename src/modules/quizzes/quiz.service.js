const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");

const arraysEqual = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, index) => val === sortedB[index]);
};

const arraysEqualOrdered = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((val, index) => val === b[index]);
};

const objectsEqual = (objA, objB) => {
  if (typeof objA !== "object" || typeof objB !== "object" || !objA || !objB) return false;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(objB, key) && String(objA[key]) === String(objB[key]));
};

const calculateSubmissionResult = (quiz, answers = []) => {
  const totalMarks = quiz.questions.reduce((sum, question) => sum + (question.marks || 1), 0);
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.selectedOption]));

  let score = 0;
  const conceptsMap = {};

  quiz.questions.forEach((question) => {
    const selectedOption = answerMap.get(question.id);
    let isCorrect = false;

    const type = question.type || "MCQ_SINGLE";
    const corr = question.correctAnswer;
    const marks = question.marks || 1;

    if (selectedOption !== undefined && selectedOption !== null) {
      if (type === "MCQ_SINGLE") {
        isCorrect = (selectedOption === corr);
      } else if (type === "MCQ_MULTI") {
        isCorrect = arraysEqual(selectedOption, corr);
      } else if (type === "ARRANGE_TOKENS") {
        isCorrect = arraysEqualOrdered(selectedOption, corr);
      } else if (type === "MATCH_PAIRS") {
        isCorrect = objectsEqual(selectedOption, corr);
      } else if (type === "SELF_ASSESSMENT") {
        isCorrect = (typeof selectedOption === "string" && selectedOption.trim().length > 0);
      }
    }

    if (isCorrect) {
      score += marks;
    }

    if (question.concept) {
      const concept = question.concept.trim();
      if (!conceptsMap[concept]) {
        conceptsMap[concept] = { score: 0, total: 0 };
      }
      conceptsMap[concept].total += marks;
      if (isCorrect) {
        conceptsMap[concept].score += marks;
      }
    }
  });

  const conceptScores = {};
  Object.keys(conceptsMap).forEach((concept) => {
    const c = conceptsMap[concept];
    conceptScores[concept] = {
      score: c.score,
      total: c.total,
      percentage: c.total === 0 ? 0 : Math.round((c.score / c.total) * 100)
    };
  });

  const percentage = totalMarks === 0 ? 0 : Math.round((score / totalMarks) * 100);

  return {
    score,
    totalMarks,
    percentage,
    passed: percentage >= quiz.passingScore,
    conceptScores
  };
};

const getQuizzes = async (
  courseId,
  studentId
) => {
  const where = {};

  if (courseId) {
    where.courseId = courseId;
  }

<<<<<<< HEAD
  return prisma.quiz.findMany({
    where,
    include: {
      _count: {
        select: {
          questions: true,
          quizSubmissions: true
        }
      },
      course: {
        select: {
          title: true,
          category: true
        }
=======
  const include = {
    _count: {
      select: {
        questions: true
>>>>>>> 20f0f63ec84a0523853ff57971d50f2a4da7b04e
      }
    }
  };

  if (studentId) {
    include.quizSubmissions = {
      where: {
        studentId
      }
    };
  }

  return prisma.quiz.findMany({
    where,
    include
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

const sanitizeQuizData = (data) => {
  const sanitized = {};
  
  if (data.title !== undefined) sanitized.title = data.title;
  if (data.description !== undefined) sanitized.description = data.description;
  if (data.passingScore !== undefined) sanitized.passingScore = Number(data.passingScore);
  if (data.timeLimit !== undefined) {
    sanitized.timeLimit = (data.timeLimit !== null && data.timeLimit !== "") ? Number(data.timeLimit) : null;
  }
  if (data.startDate !== undefined) {
    sanitized.startDate = data.startDate ? new Date(data.startDate) : null;
  }
  if (data.courseId !== undefined) sanitized.courseId = data.courseId;
  
  return sanitized;
};

const createQuiz = async (
  data
) => {
  const sanitized = sanitizeQuizData(data);
  const quiz = await prisma.quiz.create({
    data: sanitized
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
  const sanitized = sanitizeQuizData(data);
  return prisma.quiz.update({
    where: {
      id: quizId
    },
    data: sanitized
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
      conceptScores: result.conceptScores,
      submittedAt: new Date()
    },
    create: {
      studentId,
      quizId,
      answers,
      score: result.score,
      totalMarks: result.totalMarks,
      percentage: result.percentage,
      passed: result.passed,
      conceptScores: result.conceptScores
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

const getQuizResult = async (studentId, quizId) => {
  return prisma.quizSubmission.findUnique({
    where: {
      studentId_quizId: {
        studentId,
        quizId
      }
    },
    include: {
      quiz: {
        include: {
          questions: true
        }
      }
    }
  });
};

module.exports = {
  calculateSubmissionResult,
  getQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  submitQuiz,
  getQuizResult
};