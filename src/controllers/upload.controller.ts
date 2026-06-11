import { Request, Response } from "express";

export const uploadFile = async (
  req: Request,
  res: Response
) => {

  const file = req.file as any;

  res.json({
    success: true,
    url: file.path,
  });
};