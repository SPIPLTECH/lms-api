import { Request, Response } from "express";
import {
  createLesson,
  getLessonsByCourse,
} from "../services/lesson.service";

export const create = async (
  req: Request,
  res: Response
) => {

  const {
    title,
    description,
    videoUrl,
    pdfUrl,
    order,
    courseId,
  } = req.body;

  const lesson = await createLesson(
    title,
    description,
    videoUrl,
    pdfUrl,
    Number(order),
    courseId
  );

  res.status(201).json({
    success: true,
    lesson,
  });
};

export const getByCourse = async (
  req: Request,
  res: Response
) => {

const courseId = req.params.courseId as string;

const lessons = await getLessonsByCourse(courseId);
  res.json({
    success: true,
    lessons,
  });
};