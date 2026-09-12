const prisma = require("../../config/database");
const achievementService = require("./achievement.service");

const getAchievements = async (req, res, next) => {
  try {
    const achievements = await achievementService.getAchievements(req.query.type);
    res.json({ success: true, data: achievements });
  } catch (error) {
    next(error);
  }
};

const getMyAchievements = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: "Student profile not found" });
    }

    const result = await achievementService.getStudentAchievements(student.id);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const createAchievement = async (req, res, next) => {
  try {
    const achievement = await achievementService.createAchievement(req.body);

    res.status(201).json({
      success: true,
      message: "Achievement created successfully",
      data: achievement,
    });
  } catch (error) {
    next(error);
  }
};

const awardAchievement = async (req, res, next) => {
  try {
    const result = await achievementService.awardAchievement(
      req.params.studentProfileId,
      req.params.achievementId
    );

    res.status(201).json({
      success: true,
      message: "Achievement awarded successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const checkAndAwardAchievements = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: "Student profile not found" });
    }

    const awarded = await achievementService.checkAndAwardAchievements(student.id);

    res.json({
      success: true,
      message: `${awarded.length} new achievement(s) awarded`,
      data: awarded,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAchievements,
  getMyAchievements,
  createAchievement,
  awardAchievement,
  checkAndAwardAchievements,
};
