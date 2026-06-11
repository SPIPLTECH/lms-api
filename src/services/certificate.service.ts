import { prisma } from "../config/database";

export const generateCertificate = async (
  userId: string,
  courseId: string
) => {

  const certificateNo =
    `CERT-${Date.now()}`;

  return prisma.certificate.create({
    data: {
      certificateNo,
      userId,
      courseId,
    },
  });
};

export const getMyCertificates =
  async (userId: string) => {

    return prisma.certificate.findMany({
      where: {
        userId,
      },
      include: {
        course: true,
      },
    });
};