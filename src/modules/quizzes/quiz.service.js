const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");

const evaluateAnswer = (answer, correctAnswer, questionType) => {
  if (answer === undefined || answer === null || answer === "") {
    return 0;
  }

  const type = String(questionType || '').toUpperCase();

  // 1. MATCH_PAIRS (Object mapping match)
  if (type === "MATCH_PAIRS" || (typeof correctAnswer === "object" && correctAnswer !== null && !Array.isArray(correctAnswer))) {
    if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
      return 0;
    }
    const keysA = Object.keys(answer);
    const keysB = Object.keys(correctAnswer);
    if (keysB.length === 0) return 0;
    
    let correctCount = 0;
    keysA.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(correctAnswer, key) && 
          String(answer[key]).trim().toLowerCase() === String(correctAnswer[key]).trim().toLowerCase()) {
        correctCount++;
      }
    });
    return Math.max(0, correctCount / keysB.length);
  }

  // 2. ARRANGE_TOKENS (Ordered Array match)
  if (type === "ARRANGE_TOKENS") {
    if (!Array.isArray(answer) || !Array.isArray(correctAnswer)) return 0;
    if (correctAnswer.length === 0) return 0;
    
    let correctCount = 0;
    answer.forEach((val, idx) => {
      if (idx < correctAnswer.length && String(val).trim().toLowerCase() === String(correctAnswer[idx]).trim().toLowerCase()) {
        correctCount++;
      }
    });
    return Math.max(0, correctCount / correctAnswer.length);
  }

  // 3. MCQ_MULTI / MULTIPLE_CORRECT (Order-independent Array match)
  if (type === "MCQ_MULTI" || type === "MULTIPLE_CORRECT" || Array.isArray(correctAnswer) || Array.isArray(answer)) {
    const selArr = Array.isArray(answer)
      ? answer.map(s => String(s).trim().toLowerCase())
      : [String(answer).trim().toLowerCase()];
    const corrArr = Array.isArray(correctAnswer)
      ? correctAnswer.map(c => String(c).trim().toLowerCase())
      : [String(correctAnswer).trim().toLowerCase()];

    if (corrArr.length === 0) return 0;
    
    let correctCount = 0;
    let incorrectCount = 0;

    selArr.forEach((val) => {
      if (corrArr.includes(val)) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    });
    
    const score = (correctCount - incorrectCount) / corrArr.length;
    return Math.max(0, score);
  }

  // 4. Primitive types (MCQ_SINGLE, MCQ, TRUE_FALSE, FILL_BLANK, SHORT_ANSWER, LONG_ANSWER)
  const selStr = String(answer).trim().toLowerCase();
  const corrStr = String(correctAnswer).trim().toLowerCase();
  return selStr === corrStr ? 1 : 0;
};

const calculateSubmissionResult = (quiz, answers = []) => {
  const rawQuestions = quiz.quizQuestions ? quiz.quizQuestions.map(qq => ({
    ...qq.question,
    marks: qq.marks ?? qq.question?.marks ?? 1,
    negativeMarks: qq.question?.negativeMarks ?? 0
  })) : [];
  
  const totalMarks = rawQuestions.reduce((sum, question) => sum + (question.marks || 1), 0);
  const answerMap = new Map((answers || []).map((ans) => [ans.questionId, ans.answer]));

  let score = 0;

  rawQuestions.forEach((question) => {
    const answer = answerMap.get(question.id);

    if (answer !== undefined && answer !== null && answer !== "") {
      const qType = question.questionType || question.type;
      const scoreMultiplier = evaluateAnswer(answer, question.correctAnswer, qType);
      
      const questionMarks = question.marks !== undefined ? Number(question.marks) : 1;
      const negativeMarks = question.negativeMarks ? Number(question.negativeMarks) : 0;
      
      if (scoreMultiplier > 0) {
        score += scoreMultiplier * questionMarks;
      } else if (scoreMultiplier === 0 && negativeMarks > 0) {
        score -= negativeMarks;
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
  courseId,
  role,
  userId
) => {
  const where = {};

  if (courseId) {
    where.courseId = courseId;
  } else if (role === "INSTRUCTOR") {
    // No specific course requested: scope to this instructor's own courses only.
    where.course = { creatorId: userId };
  }

  return prisma.quiz.findMany({
    where,
    include: {
      _count: {
        select: {
          quizQuestions: true
        }
      }
    }
  });
};

const getQuizById = async (
  quizId,
  role
) => {
  const quiz = await prisma.quiz.findUnique({
    where: {
      id: quizId
    },
    include: {
      quizQuestions: {
        orderBy: { order: "asc" },
        include: { question: true }
      }
    }
  });

  if (!quiz) return null;

  const junctionQuestions = (quiz.quizQuestions || []).map((qq) => ({
    ...qq.question,
    marks: qq.marks ?? qq.question?.marks ?? 1,
    order: qq.order,
    isMandatory: qq.isMandatory,
    quizQuestionId: qq.id
  }));

  let allQuestions = [...junctionQuestions];

  // Students attempting the quiz should not receive the answer key up front.
  if (role === "STUDENT" || role === "GUEST") {
    allQuestions = allQuestions.map(
      ({ correctAnswer, explanation, ...rest }) => rest
    );
  }

  return {
    ...quiz,
    questions: allQuestions
  };
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
    include: { quizQuestions: { include: { question: true } } }
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
  evaluateAnswer,
  calculateSubmissionResult,
  getQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  submitQuiz
};