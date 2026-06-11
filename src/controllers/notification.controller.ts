import { Request, Response } from "express";

import {
  getMyNotifications,
} from "../services/notification.service";

export const myNotifications =
  async (
    req: Request,
    res: Response
  ) => {

    const userId =
      (req as any).user.userId;

    const notifications =
      await getMyNotifications(
        userId
      );

    res.json({
      success: true,
      notifications,
    });
  };