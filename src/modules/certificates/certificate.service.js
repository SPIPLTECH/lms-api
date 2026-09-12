const prisma = require("../../config/database");

const getCertificates = async (
  requester,
  studentId,
  courseId
) => {
  const where = {};

  if (
    requester.role === "ADMIN" ||
    requester.role === "INSTRUCTOR"
  ) {
    if (studentId) {
      where.studentId = studentId;
    }
  } else {
    where.studentId = studentId;
  }

  if (courseId) {
    where.courseId = courseId;
  }

  return prisma.certificate.findMany({
    where,
    include: {
      student: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      },
      course: {
        select: {
          id: true,
          title: true
        }
      }
    },
    orderBy: {
      issuedAt: "desc"
    }
  });
};

const getCertificateById = async (
  certificateId
) => {
  return prisma.certificate.findUnique({
    where: {
      id: certificateId
    },
    include: {
      student: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      },
      course: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
};

const deleteCertificate = async (
  certificateId
) => {
  const existing = await prisma.certificate.findUnique({ where: { id: certificateId } });
  if (!existing) {
    const error = new Error("Certificate not found");
    error.statusCode = 404;
    throw error;
  }

  return prisma.certificate.delete({
    where: {
      id: certificateId
    }
  });
};

const createCertificate = async (data) => {
  return prisma.certificate.create({
    data
  });
};

const updateCertificate = async (certificateId, data) => {
  const existing = await prisma.certificate.findUnique({ where: { id: certificateId } });
  if (!existing) {
    const error = new Error("Certificate not found");
    error.statusCode = 404;
    throw error;
  }

  return prisma.certificate.update({
    where: { id: certificateId },
    data
  });
};

module.exports = {
  getCertificates,
  getCertificateById,
  deleteCertificate,
  createCertificate,
  updateCertificate
};