const prisma = require("../../config/database");
const bcrypt = require("bcrypt");

/* Dashboard */
const getDashboardStats = async () => {
  const totalUsers = await prisma.user.count();
  const totalStudents =
    await prisma.studentProfile.count();
  const totalTeachers =
    await prisma.teacherProfile.count();
  const totalAdmins =
    await prisma.adminProfile.count();

  const totalCourses =
    await prisma.course.count();

  const publishedCourses =
    await prisma.course.count({
      where: { status: "PUBLISHED" }
    });

  const draftCourses =
    await prisma.course.count({
      where: { status: "DRAFT" }
    });

  const archivedCourses =
    await prisma.course.count({
      where: { status: "ARCHIVED" }
    });

  const totalEnrollments =
    await prisma.enrollment.count();

  const totalReviews =
    await prisma.review.count();

  const totalCertificates =
    await prisma.certificate.count();

  return {
    totalUsers,
    totalStudents,
    totalTeachers,
    totalAdmins,
    totalCourses,
    publishedCourses,
    draftCourses,
    archivedCourses,
    totalEnrollments,
    totalReviews,
    totalCertificates
  };
};

/* User Management */
const getUsers = async () => {
  return await prisma.user.findMany({
    include: {
      studentProfile: true,
      teacherProfile: true,
      adminProfile: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const getUserById = async (id) => {
  const user =
    await prisma.user.findUnique({
      where: { id },
      include: {
        studentProfile: true,
        teacherProfile: true,
        adminProfile: true
      }
    });

  if (!user)
    throw new Error("User not found");

  return user;
};
const updateUser = async (id, data) => {
  const user =
    await prisma.user.update({
      where: { id },
      data
    });

  return user;
};


const updateUserStatus = async (id, status) => {
  return await prisma.user.update({
    where: { id },
    data: { status }
  });
};

const deleteUser = async (id) => {
  return await prisma.user.delete({
    where: { id }
  });
};

/* Admin Management */
const createAdmin = async (data) => {
  const {
    name,
    email,
    password,
    phoneNumber,
    address,
    department,
    designation
  } = data;

  const existingUser =
    await prisma.user.findUnique({
      where: { email }
    });

  if (existingUser) {
    throw new Error(
      "Admin with this email already exists"
    );
  }

  const hashedPassword =
    await bcrypt.hash(password, 10);

  const admin =
    await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phoneNumber,
        address,
        role: "ADMIN",
        status: "ACTIVE",
        isVerified: true,

        adminProfile: {
          create: {
            department,
            designation
          }
        }
      },
      include: {
        adminProfile: true
      }
    });

  return admin;
};

const getAdmins = async () => {
  return await prisma.user.findMany({
    where: {
      role: "ADMIN"
    },
    include: {
      adminProfile: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

/* Course Management */
const getCourses = async () => {
  return await prisma.course.findMany({
    include: {
      creator: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const publishCourse = async (id) => {
  return await prisma.course.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date()
    }
  });
};

const archiveCourse = async (id) => {
  return await prisma.course.update({
    where: { id },
    data: {
      status: "ARCHIVED"
    }
  });
};

const deleteCourse = async (id) => {
  return await prisma.course.delete({
    where: { id }
  });
};

/* Teacher Management */
const getTeachers = async () => {
  return await prisma.teacherProfile.findMany({
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phoneNumber: true,
          status: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const getTeacherById = async (id) => {
  const teacher =
    await prisma.teacherProfile.findUnique({
      where: { id },
      include: {
        user: true,
        courses: true
      }
    });

  if (!teacher) {
    throw new Error("Teacher not found");
  }

  return teacher;
};

/* Monitoring */
const getEnrollments = async () => {
  return await prisma.enrollment.findMany({
    include: {
      student: {
        include: {
          user: true
        }
      },
      course: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const getReviews = async () => {
  return await prisma.review.findMany({
    include: {
      student: {
        include: {
          user: true
        }
      },
      course: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const deleteReview = async (id) => {
  return await prisma.review.delete({
    where: { id }
  });
};

const getCertificates = async () => {
  return await prisma.certificate.findMany({
    include: {
      student: {
        include: {
          user: true
        }
      },
      course: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

/* Reports */
const getReports = async () => {
  const totalUsers =
    await prisma.user.count();

  const totalCourses =
    await prisma.course.count();

  const totalEnrollments =
    await prisma.enrollment.count();

  const publishedCourses =
    await prisma.course.count({
      where: {
        status: "PUBLISHED"
      }
    });

  return {
    totalUsers,
    totalCourses,
    totalEnrollments,
    publishedCourses
  };
};

module.exports = {
  getDashboardStats,

  getUsers,
  getUserById,
  updateUser,
  updateUserStatus,
  deleteUser,

  createAdmin,
  getAdmins,

  getCourses,
  publishCourse,
  archiveCourse,
  deleteCourse,

  getTeachers,
  getTeacherById,

  getEnrollments,

  getReviews,
  deleteReview,

  getCertificates,

  getReports
};