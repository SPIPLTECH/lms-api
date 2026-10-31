const prisma = require("../../config/database");
const sessionService = require("../sessions/session.service");

const toNullableString = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value;
};

const getUserById = async (userId) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId
    },
    include: {
      studentProfile: true,
      teacherProfile: true,
      adminProfile: true
    }
  });

  // The "institution" field the student profile form reads/writes is stored
  // under the studentProfile.collegeName column (see updateMyProfile) —
  // aliased here so it round-trips back to the frontend under the name it sent.
  if (user?.studentProfile) {
    user.studentProfile.institution = toNullableString(user.studentProfile.collegeName);
  }

  return user;
};

const updateUser = async (userId, data) => {
  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (!existing) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  return await prisma.user.update({
    where: {
      id: userId
    },
    data
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

  // Access tokens carry the role, so a session signed in under the old role
  // would keep its old permissions until the token expired. End it.
  if (user.role !== role) {
    await sessionService.revokeUserSessions(userId, sessionService.END_REASONS.ROLE_CHANGED);
  }

  return updatedUser;
};

const deleteUser = async (userId) => {
  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (!existing) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

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
  // Normalize blank strings to null so unfilled optional fields stay null (and
  // User.phoneNumber @unique never collides on "").
  const userUpdate = {};
  if (data.name !== undefined) {
    userUpdate.name = typeof data.name === "string" ? data.name.trim() : data.name;
  }
  if (data.phoneNumber !== undefined) userUpdate.phoneNumber = toNullableString(data.phoneNumber);
  if (data.address !== undefined) userUpdate.address = toNullableString(data.address);
  if (data.avatar !== undefined) userUpdate.avatar = toNullableString(data.avatar);

  // Update User base fields
  if (Object.keys(userUpdate).length > 0) {
    await prisma.user.update({ where: { id: userId }, data: userUpdate });
  }

  // Update role-specific profile fields
  if (user.role === "STUDENT" && user.studentProfile) {
    const profileUpdate = {};
    if (data.education !== undefined) profileUpdate.education = toNullableString(data.education);
    if (data.institution !== undefined) {
      profileUpdate.collegeName = toNullableString(data.institution);
    } else if (data.collegeName !== undefined) {
      profileUpdate.collegeName = toNullableString(data.collegeName);
    }
    if (data.gender !== undefined) profileUpdate.gender = toNullableString(data.gender);
    if (data.dateOfBirth !== undefined) {
      profileUpdate.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
    }
    if (data.guardianName !== undefined) profileUpdate.guardianName = toNullableString(data.guardianName);
    if (data.phone !== undefined) profileUpdate.phone = toNullableString(data.phone);
    
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

    // AI Student Entry Phase fields (see schema.prisma's StudentProfile
    // extension) — same explicit whitelist as the fields above, never a
    // raw spread of req.body.
    if (data.country !== undefined) profileUpdate.country = toNullableString(data.country);
    if (data.state !== undefined) profileUpdate.state = toNullableString(data.state);
    if (data.city !== undefined) profileUpdate.city = toNullableString(data.city);
    if (data.highestQualification !== undefined) profileUpdate.highestQualification = toNullableString(data.highestQualification);
    if (data.currentQualification !== undefined) profileUpdate.currentQualification = toNullableString(data.currentQualification);
    if (data.branchOrStream !== undefined) profileUpdate.branchOrStream = toNullableString(data.branchOrStream);
    if (data.graduationYear !== undefined) {
      const rawYear = typeof data.graduationYear === "string" ? data.graduationYear.trim() : data.graduationYear;
      profileUpdate.graduationYear = rawYear === null || rawYear === "" ? null : parseInt(rawYear, 10);
    }
    if (data.semester !== undefined) profileUpdate.semester = data.semester;
    if (data.cgpaOrPercentage !== undefined) {
      profileUpdate.cgpaOrPercentage = data.cgpaOrPercentage === null || data.cgpaOrPercentage === "" ? null : parseFloat(data.cgpaOrPercentage);
    }
    if (data.employmentStatus !== undefined) profileUpdate.employmentStatus = data.employmentStatus;
    if (data.yearsOfExperience !== undefined) {
      profileUpdate.yearsOfExperience = data.yearsOfExperience === null || data.yearsOfExperience === "" ? 0 : parseFloat(data.yearsOfExperience);
    }
    if (data.currentJobRole !== undefined) profileUpdate.currentJobRole = data.currentJobRole;
    if (data.careerGoalText !== undefined) profileUpdate.careerGoalText = data.careerGoalText;
    if (data.preferredLearningStyle !== undefined) profileUpdate.preferredLearningStyle = data.preferredLearningStyle;
    if (data.weeklyStudyHours !== undefined) {
      profileUpdate.weeklyStudyHours = data.weeklyStudyHours === null || data.weeklyStudyHours === "" ? null : parseInt(data.weeklyStudyHours, 10);
    }
    if (data.preferredStudyTime !== undefined) profileUpdate.preferredStudyTime = data.preferredStudyTime;
    if (data.technicalSkills !== undefined) {
      profileUpdate.technicalSkills = Array.isArray(data.technicalSkills) ? data.technicalSkills.filter(Boolean) : [];
    }

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
  return getUserById(userId);
};

module.exports = {
  getUserById,
  updateUser,
  deleteUser,
  updateUserRole,
  updateMyProfile,
};