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

const updateMyProfile = async (userId, data) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { studentProfile: true, teacherProfile: true },
  });

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  // Fields allowed to be updated on the User model
  const userUpdate = {};
  if (data.name !== undefined) userUpdate.name = data.name;
  if (data.phoneNumber !== undefined) userUpdate.phoneNumber = data.phoneNumber;
  if (data.address !== undefined) userUpdate.address = data.address;
  if (data.avatar !== undefined) userUpdate.avatar = data.avatar;

  // Update User base fields
  if (Object.keys(userUpdate).length > 0) {
    await prisma.user.update({ where: { id: userId }, data: userUpdate });
  }

  // Update role-specific profile fields
  if (user.role === "STUDENT" && user.studentProfile) {
    const profileUpdate = {};
    if (data.education !== undefined) profileUpdate.education = data.education;
    if (data.institution !== undefined) profileUpdate.institution = data.institution;
    if (data.graduationYear !== undefined) profileUpdate.graduationYear = data.graduationYear;
    if (data.gender !== undefined) profileUpdate.gender = data.gender;
    if (data.dateOfBirth !== undefined) {
      profileUpdate.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
    }
    if (data.guardianName !== undefined) profileUpdate.guardianName = data.guardianName;
    if (data.phone !== undefined) profileUpdate.phone = data.phone;
    
    if (data.profileVisibility !== undefined) profileUpdate.profileVisibility = data.profileVisibility;
    if (data.focusTopics !== undefined) profileUpdate.focusTopics = data.focusTopics;
    if (data.interests !== undefined) profileUpdate.interests = data.interests;
    if (data.learningGoals !== undefined) profileUpdate.learningGoals = data.learningGoals;
    if (data.videoQuality !== undefined) profileUpdate.videoQuality = data.videoQuality;
    if (data.downloadOverWifi !== undefined) {
      profileUpdate.downloadOverWifi = data.downloadOverWifi === true || data.downloadOverWifi === 'true';
    }
    if (data.language !== undefined) profileUpdate.language = data.language;
    if (data.timezone !== undefined) profileUpdate.timezone = data.timezone;
    if (data.themeMode !== undefined) profileUpdate.themeMode = data.themeMode;
    if (data.plan !== undefined) profileUpdate.plan = data.plan;

    if (Object.keys(profileUpdate).length > 0) {
      await prisma.studentProfile.update({
        where: { userId },
        data: profileUpdate,
      });
    }
  }

  if (user.role === "INSTRUCTOR" && user.teacherProfile) {
    const profileUpdate = {};
    if (data.specialization !== undefined) profileUpdate.specialization = data.specialization;
    if (data.qualification !== undefined) profileUpdate.qualification = data.qualification;
    if (data.experience !== undefined) profileUpdate.experience = parseInt(data.experience);
    if (data.bio !== undefined) profileUpdate.bio = data.bio;
    if (data.notificationPreferences !== undefined) profileUpdate.notificationPreferences = data.notificationPreferences;
    if (data.language !== undefined) profileUpdate.language = data.language;
    if (data.timezone !== undefined) profileUpdate.timezone = data.timezone;

    if (Object.keys(profileUpdate).length > 0) {
      await prisma.teacherProfile.update({
        where: { userId },
        data: profileUpdate,
      });
    }
  }

  // Return the fully updated user with profile
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      studentProfile: true,
      teacherProfile: true,
      adminProfile: true,
    },
  });
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  updateUserRole,
  updateUserStatus,
  updateMyProfile,
};