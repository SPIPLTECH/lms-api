const prisma = require("../../../config/database");

const verifyCourseImportOwnership = async (req, res, next) => {
  try {
    const jobId = req.params.jobId;
    if (jobId && (jobId.startsWith("draft-") || jobId === "draft")) {
      return next();
    }

    const job = await prisma.courseImportJob.findUnique({ where: { id: jobId } });

    if (!job) {
      return res.status(404).json({ success: false, message: "Import job not found." });
    }

    if (req.user.role !== "ADMIN" && job.instructorId !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = verifyCourseImportOwnership;
