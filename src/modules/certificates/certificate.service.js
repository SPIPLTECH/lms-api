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

const createCertificate = async (data) => {
  return prisma.certificate.create({
    data
  });
};

module.exports = {
  getCertificates,
  createCertificate,
};