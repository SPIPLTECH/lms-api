import { Request, Response } from "express";

import {
  createQuiz,
  getQuiz,
} from "../services/quiz.service";

export const create = async (
  req: Request,
  res: Response
) => {

  const { title, courseId } =
    req.body;

  const quiz =
    await createQuiz(
      title,
      courseId
    );

  res.status(201).json({
    success: true,
    quiz,
  });
};

export const getOne = async (
  req: Request,
  res: Response
) => {

 const quiz =
  await getQuiz(
    String(req.params.id)
  );

  res.json({
    success: true,
    quiz,
  });
};