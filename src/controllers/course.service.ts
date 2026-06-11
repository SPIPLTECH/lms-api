import { Request, Response } from "express";
import {
  createCourse,
  getCourses,
} from "../services/course.service";

export const create = async (
  req: Request,
  res: Response
) => {

  try {

    const { title, description, price } = req.body;

    const teacherId = (req as any).user.userId;

    const course = await createCourse(
      title,
      description,
      Number(price),
      teacherId
    );

    res.status(201).json({
      success: true,
      course,
    });

  } catch (error: any) {

    res.status(400).json({
      success: false,
      message: error.message,
    });

  }
};

export const getAll = async (
  req: Request,
  res: Response
) => {

  const courses = await getCourses();

  res.json({
    success: true,
    courses,
  });
};