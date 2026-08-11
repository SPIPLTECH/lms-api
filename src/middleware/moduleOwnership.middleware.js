const prisma = require("../config/database");

const verifyModuleOwnership = async (
  req,
  res,
  next
) => {
  try {
    const module =
      await prisma.module.findUnique({
        where: {
          id: req.params.moduleId
        },
        include: {
          course: true
        }
      });

    if (!module) {
      return res.status(404).json({
        message: "Module not found"
      });
    }

    if (
      req.user.role !== "ADMIN" &&
      module.course.creatorId !==
        req.user.id
    ) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports =
  verifyModuleOwnership;