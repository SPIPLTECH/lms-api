const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

exports.pingVideoProgress = async (req, res, next) => {
  try {
    const studentProfileId = req.user.studentProfileId;
    if (!studentProfileId) {
      return res.status(403).json({ success: false, message: "Only students can track video progress" });
    }

    let { lessonId, courseId, watchTime, completed } = req.body;

    if (!lessonId) {
      return res.status(400).json({ success: false, message: "lessonId is required" });
    }

    if (!courseId) {
       const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: true } });
       if (lesson && lesson.module) courseId = lesson.module.courseId;
    }

    const analytics = await prisma.videoAnalytics.upsert({
      where: {
        studentId_lessonId: {
          studentId: studentProfileId,
          lessonId,
        },
      },
      update: {
        watchTime: { increment: watchTime || 10 },
        completed: completed !== undefined ? completed : undefined,
        lastPing: new Date(),
      },
      create: {
        studentId: studentProfileId,
        lessonId,
        courseId,
        watchTime: watchTime || 10,
        completed: completed || false,
      },
    });

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    next(error);
  }
};
