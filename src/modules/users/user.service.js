const prisma = require("../../config/database");

const getUsers = async () => {
  return await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true
    }
  });
};

const getUserById = async (userId) => {
  return await prisma.user.findUnique({
    where: {
      id: userId
    },
    include: {
      studentProfile: true,
      teacherProfile: true,
      adminProfile: true
    }
  });
};

const updateUser = async (userId, data) => {
  return await prisma.user.update({
    where: {
      id: userId
    },
    data
  });
};

const updateUserStatus = async (userId, status) => {
  return await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      status
    }
  });
};

const updateUserRole = async (userId, role) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      studentProfile: true,
      teacherProfile: true,
      adminProfile: true
    }
  });

  if (!user) {
    throw new Error("User not found");
  }

  const updatedUser = await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      role
    }
  });

  // If role changed to STUDENT
  if (role === "STUDENT" && !user.studentProfile) {
    await prisma.studentProfile.create({
      data: {
        userId
      }
    });
  }

  // If role changed to INSTRUCTOR
  if (role === "INSTRUCTOR" && !user.teacherProfile) {
    await prisma.teacherProfile.create({
      data: {
        userId
      }
    });
  }

  // If role changed to ADMIN
  if (role === "ADMIN" && !user.adminProfile) {
    await prisma.adminProfile.create({
      data: {
        userId
      }
    });
  }

  return updatedUser;
};

const deleteUser = async (userId) => {
  return await prisma.user.delete({
    where: {
      id: userId
    }
  });
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  updateUserRole,
  updateUserStatus
};