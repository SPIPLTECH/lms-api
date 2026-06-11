import { Request, Response } from "express";

import {
  getStudentAnalytics,
  getTeacherAnalytics,
  getAdminAnalytics,
} from "../services/analytics.service";

export const studentDashboard =
  async (
    req: Request,
    res: Response
  ) => {

    const userId =
      (req as any).user.userId;

    const analytics =
      await getStudentAnalytics(
        userId
      );

    res.json({
      success: true,
      analytics,
    });
  };

export const teacherDashboard =
  async (
    req: Request,
    res: Response
  ) => {

    const teacherId =
      (req as any).user.userId;

    const analytics =
      await getTeacherAnalytics(
        teacherId
      );

    res.json({
      success: true,
      analytics,
    });
  };

export const adminDashboard =
  async (
    req: Request,
    res: Response
  ) => {

    const analytics =
      await getAdminAnalytics();

    res.json({
      success: true,
      analytics,
    });
  };