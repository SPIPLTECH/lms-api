import { Request, Response } from "express";
import { addQuestion } from "../services/question.service";

export const create = async (
  req: Request,
  res: Response
) => {
  try {
    const question = await addQuestion(req.body);

    res.status(201).json({
      success: true,
      question,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};