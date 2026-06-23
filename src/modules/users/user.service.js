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
const updateUserRole = async (
  userId,
  role
) => {
  return await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      role
    }
  });
};

const getUserById = async (userId) => {
  return await prisma.user.findUnique({
    where: {
      id: userId
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status : true,
      createdAt: true
    }
  });
};

const updateUser = async (
  userId,
  data
) => {
  return await prisma.user.update({
    where: {
      id: userId
    },
    data
  });
};
const updateUserStatus = async (
  userId,
  status
) => {
  return await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      status
    }
  });
};

const deleteUser = async (
  userId
) => {
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