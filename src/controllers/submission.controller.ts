import { Request, Response } from "express";

import {
  submitAssignment,
  getMySubmissions,
} from "../services/submission.service";

export const submit = async (
  req: Request,
  res: Response
) => {

  const userId =
    (req as any).user.userId;

  const {
    assignmentId,
    content,
  } = req.body;

  const submission =
    await submitAssignment(
      userId,
      assignmentId,
      content
    );

  res.status(201).json({
    success: true,
    submission,
  });
};

export const mySubmissions = async (
  req: Request,
  res: Response
) => {

  const userId =
    (req as any).user.userId;

  const submissions =
    await getMySubmissions(
      userId
    );

  res.json({
    success: true,
    submissions,
  });
};