import { Request, Response } from "express";
import { registerUser } from "../services/auth.service";
import { loginUser } from "../services/auth.service";
import { prisma } from "../config/database";
import {
  registerSchema,
  loginSchema,
} from "../validators/auth.validator";

export const register = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {

    const { name, email, password } = req.body;

    const user = await registerUser(
      name,
      email,
      password
    );

    res.status(201).json({
      success: true,
      user,
    });

  } catch (error: any) {

    res.status(400).json({
      success: false,
      message: error.message,
    });
const data =
  registerSchema.parse(
    req.body
  );

const user =
  await registerUser(
    data.name,
    data.email,
    data.password
  );
  }
};
export const login = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {

    const { email, password } = req.body;

    const data = await loginUser(
      email,
      password
    );

    res.status(200).json({
      success: true,
      ...data,
    });

  } catch (error: any) {

    res.status(401).json({
      success: false,
      message: error.message,
    });
const data =
  loginSchema.parse(
    req.body
  );

const result =
  await loginUser(
    data.email,
    data.password
  );
  }
};
export const getProfile = async (
  req: Request,
  res: Response
): Promise<void> => {

  const userId = (req as any).user.userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  res.status(200).json({
    success: true,
    user,
  });
};
