import { Request, Response } from "express";

import {
  generateCertificate,
  getMyCertificates,
} from "../services/certificate.service";

export const generate = async (
  req: Request,
  res: Response
) => {

  const userId =
    (req as any).user.userId;

  const { courseId } =
    req.body;

  const certificate =
    await generateCertificate(
      userId,
      courseId
    );

  res.status(201).json({
    success: true,
    certificate,
  });
};

export const myCertificates =
  async (
    req: Request,
    res: Response
  ) => {

    const userId =
      (req as any).user.userId;

    const certificates =
      await getMyCertificates(
        userId
      );

    res.json({
      success: true,
      certificates,
    });
  };