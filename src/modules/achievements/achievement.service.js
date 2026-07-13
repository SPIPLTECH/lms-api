const prisma = require("../../config/database");

const getAchievements = async (type) => {
  const where = {};

  if (type) {
    where.type = type;
  }

  return prisma.achievement.findMany({
    where,
    include: {
      _count: { select: { earned: true } },
    },
    orderBy: { xpReward: "desc" },
  });
};

const getStudentAchievements = async (studentId) => {
  const [earned, all] = await Promise.all([
    prisma.studentAchievement.findMany({
      where: { studentId },
      include: {
        achievement: true,
      },
      orderBy: { earnedAt: "desc" },
    }),
    prisma.achievement.findMany({ orderBy: { xpReward: "desc" } }),
  ]);

  const earnedIds = new Set(earned.map((e) => e.achievementId));
  const totalXp = earned.reduce((sum, e) => sum + (e.achievement?.xpReward || 0), 0);

  // Enrich all achievements with whether the student earned them
  const catalog = all.map((a) => ({
    ...a,
    earned: earnedIds.has(a.id),
    earnedAt: earned.find((e) => e.achievementId === a.id)?.earnedAt || null,
  }));

  return {
    totalXp,
    earnedCount: earned.length,
    totalCount: all.length,
    achievements: catalog,
  };
};

const createAchievement = async (data) => {
  return prisma.achievement.create({
    data: {
      name: data.name,
      description: data.description,
      icon: data.icon,
      xpReward: data.xpReward ? parseInt(data.xpReward) : 0,
      type: data.type || "GENERAL",
    },
  });
};

const awardAchievement = async (studentId, achievementId) => {
  // Check both exist
  const [student, achievement] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { id: studentId } }),
    prisma.achievement.findUnique({ where: { id: achievementId } }),
  ]);

  if (!student) {
    const error = new Error("Student not found");
    error.statusCode = 404;
    throw error;
  }

  if (!achievement) {
    const error = new Error("Achievement not found");
    error.statusCode = 404;
    throw error;
  }

  // Upsert to avoid duplicates
  return prisma.studentAchievement.upsert({
    where: { studentId_achievementId: { studentId, achievementId } },
    update: {},
    create: { studentId, achievementId },
    include: { achievement: true },
  });
};

/**
 * Auto-check rules and award unlocked achievements for the given student.
 * Called internally after key events (quiz submit, lesson complete, note create, etc.)
 */
const checkAndAwardAchievements = async (studentId) => {
  const [
    completedLessons,
    completedCourses,
    quizSubmissions,
    notes,
    alreadyEarned,
    allAchievements,
  ] = await Promise.all([
    prisma.progress.count({ where: { studentId, completed: true } }),
    prisma.enrollment.count({ where: { studentId } }),
    prisma.quizSubmission.findMany({ where: { studentId } }),
    prisma.note.count({ where: { studentId } }),
    prisma.studentAchievement.findMany({ where: { studentId }, select: { achievementId: true } }),
    prisma.achievement.findMany(),
  ]);

  const earnedIds = new Set(alreadyEarned.map((e) => e.achievementId));
  const avgScore =
    quizSubmissions.length > 0
      ? Math.round(quizSubmissions.reduce((s, q) => s + q.percentage, 0) / quizSubmissions.length)
      : 0;

  // Define rules: maps achievement name patterns to unlock conditions
  const rules = {
    "Quick Learner": completedLessons >= 5,
    "Quiz Master": avgScore >= 90 && quizSubmissions.length >= 5,
    "Note Taker": notes >= 10,
    "Knowledge Seeker": completedCourses >= 10,
    "First Step": completedLessons >= 1,
    "Course Champion": completedCourses >= 1,
  };

  const newlyAwarded = [];

  for (const achievement of allAchievements) {
    if (earnedIds.has(achievement.id)) continue; // Already earned

    const rule = rules[achievement.name];
    if (rule === true) {
      const awarded = await prisma.studentAchievement.create({
        data: { studentId, achievementId: achievement.id },
        include: { achievement: true },
      });
      newlyAwarded.push(awarded);
    }
  }

  return newlyAwarded;
};

module.exports = {
  getAchievements,
  getStudentAchievements,
  createAchievement,
  awardAchievement,
  checkAndAwardAchievements,
};
