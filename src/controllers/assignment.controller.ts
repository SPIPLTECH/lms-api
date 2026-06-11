import { Request, Response } from "express";
import {
  createAssignment,
  getAssignments,
} from "../services/assignment.service";

export const create = async (
  req: Request,
  res: Response
) => {

  const {
    title,
    description,
    courseId,
  } = req.body;

  const assignment =
    await createAssignment(
      title,
      description,
      courseId
    );

  res.status(201).json({
    success: true,
    assignment,
  });
};

export const getAll = async (
  req: Request,
  res: Response
) => {

  const courseId =
    req.params.courseId;

  const assignments =
    await getAssignments(
      String(courseId)
    );

  res.json({
    success: true,
    assignments,
  });
};