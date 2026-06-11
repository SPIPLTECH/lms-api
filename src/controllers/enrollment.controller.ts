import { Request, Response } from "express";

import {
  enrollStudent,
  getMyCourses,
} from "../services/enrollment.service";

export const enroll = async (
  req: Request,
  res: Response
) => {

  try {

    const userId = (req as any).user.userId;

    const { courseId } = req.body;

    const enrollment =
      await enrollStudent(
        userId,
        courseId
      );

    res.status(201).json({
      success: true,
      enrollment,
    });

  } catch (error: any) {

    res.status(400).json({
      success: false,
      message: error.message,
    });

  }
};

export const myCourses = async (
  req: Request,
  res: Response
) => {

  const userId =
    (req as any).user.userId;

  const courses =
    await getMyCourses(userId);

  res.json({
    success: true,
    courses,
  });
};