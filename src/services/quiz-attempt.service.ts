import { prisma } from "../config/database";

export const submitQuiz = async (
  userId: string,
  quizId: string,
  answers: any[]
) => {

  const questions =
    await prisma.question.findMany({
      where: {
        quizId,
      },
    });

  let score = 0;

  for (const question of questions) {

    const submittedAnswer =
      answers.find(
        (a) => a.questionId === question.id
      );

    if (
      submittedAnswer &&
      submittedAnswer.answer ===
        question.correctAnswer
    ) {
      score++;
    }
  }

  const attempt =
    await prisma.quizAttempt.create({
      data: {
        userId,
        quizId,
        score,
      },
    });

  return {
    score,
    totalQuestions:
      questions.length,
    attempt,
  };
};