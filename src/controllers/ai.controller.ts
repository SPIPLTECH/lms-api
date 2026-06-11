import { Request, Response } from "express";
import { chatWithAI, courseChat, generateQuizAI } from "../services/ai.service";
import { explainLesson } from "../services/ai.service";

export const chat = async (
  req: Request,
  res: Response
) => {

  try {

    const { message } = req.body;

    const answer =
      await chatWithAI(message);

    res.json({
      success: true,
      answer,
    });

  } catch (error: any) {

    res.status(500).json({
      success: false,
      message: error.message,
    });

  }
};
export const explain = async (
  req: Request,
  res: Response
) => {

  try {

    const { lessonId } = req.body;

    const explanation =
      await explainLesson(
        lessonId
      );

    res.json({
      success: true,
      explanation,
    });

  } catch (error: any) {

    res.status(500).json({
      success: false,
      message: error.message,
    });

  }
};
export const generateQuiz =
  async (
    req: Request,
    res: Response
  ) => {

    const { lessonId } =
      req.body;

    const quiz =
      await generateQuizAI(
        lessonId
      );

    res.json({
      success: true,
      quiz,
    });
  };
  export const askCourse =
  async (
    req: Request,
    res: Response
  ) => {

    const {
      courseId,
      question,
    } = req.body;

    const answer =
      await courseChat(
        courseId,
        question
      );

    res.json({
      success: true,
      answer,
    });
  };