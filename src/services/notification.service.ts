import { prisma } from "../config/database";

export const createNotification = async (
  userId: string,
  title: string,
  message: string
) => {

  return prisma.notification.create({
    data: {
      userId,
      title,
      message,
    },
  });
};

export const getMyNotifications =
  async (userId: string) => {

    return prisma.notification.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  };