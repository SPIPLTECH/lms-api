const courseImporterService = require("../services/courseImporter.service");
const ApiError = require("../../../utils/ApiError");

const uploadPackage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Please upload a .zip course package." });
    }

    const job = await courseImporterService.createJob({
      instructorId: req.user.id,
      sourceFileName: req.file.originalname,
      zipFilePath: req.file.path,
    });

    res.status(201).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const processJob = async (req, res, next) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const job = await courseImporterService.processJob(req.params.jobId, baseUrl);
    res.json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const getJob = async (req, res, next) => {
  try {
    const job = await courseImporterService.getJob(req.params.jobId);
    if (!job) throw new ApiError(404, "Import job not found.");
    res.json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const listJobs = async (req, res, next) => {
  try {
    const jobs = await courseImporterService.listJobs(req.user.id);
    res.json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
};

const updateJob = async (req, res, next) => {
  try {
    const job = await courseImporterService.updateCanonicalJson(req.params.jobId, req.body.canonicalJson);
    res.json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const importJob = async (req, res, next) => {
  try {
    const job = await courseImporterService.importJob(req.params.jobId, req.user.id);
    res.json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const deleteJob = async (req, res, next) => {
  try {
    await courseImporterService.deleteJob(req.params.jobId);
    res.json({ success: true, message: "Import job deleted." });
  } catch (error) {
    next(error);
  }
};

module.exports = { uploadPackage, processJob, getJob, listJobs, updateJob, importJob, deleteJob };
