import { prisma } from "../config/database";
import { hashPassword } from "../utils/hash";
import { comparePassword } from "../utils/hash";
import { generateToken } from "../utils/jwt";

export const registerUser = async (
  name: string,
  email: string,
  password: string
) => {

  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    throw new Error("User already exists");
  }

  const hashedPassword = await hashPassword(password);

 const user = await prisma.user.create({
  data: {
    name,
    email,
    password: hashedPassword,
  },
  select: {
    id: true,
    name: true,
    email: true,
    role: true,
    createdAt: true,
  },
});

return user;
};
export const loginUser = async (
  email: string,
  password: string
) => {

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("Invalid credentials");
  }

  const isPasswordValid = await comparePassword(
    password,
    user.password
  );

  if (!isPasswordValid) {
    throw new Error("Invalid credentials");
  }

 const token = generateToken(
  user.id,
  user.role
);

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };

};