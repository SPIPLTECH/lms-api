import { Request, Response } from "express";

import {
  submitQuiz,
} from "../services/quiz-attempt.service";

export const submit = async (
  req: Request,
  res: Response
) => {

  try {

    const userId =
      (req as any).user.userId;

    const {
      quizId,
      answers,
    } = req.body;

    const result =
      await submitQuiz(
        userId,
        quizId,
        answers
      );

    res.status(201).json({
      success: true,
      ...result,
    });

  } catch (error: any) {

    res.status(400).json({
      success: false,
      message: error.message,
    });

  }
};