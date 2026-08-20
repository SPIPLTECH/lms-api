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
    if (req.body?.canonicalJson) {
      await courseImporterService.updateCanonicalJson(req.params.jobId, req.body.canonicalJson);
    }
    const job = await courseImporterService.importJob(req.params.jobId, req.user.id);
    res.json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

function stripMarkdownCodeFences(str) {
  if (typeof str !== "string") return str;
  let trimmed = str.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return trimmed;
}

const processJsonJob = async (req, res, next) => {
  try {
    let canonicalJson = null;
    let sourceFileName = "course.json";

    if (req.file) {
      sourceFileName = req.file.originalname;
      const rawText = stripMarkdownCodeFences(req.file.buffer.toString("utf-8"));
      try {
        canonicalJson = JSON.parse(rawText);
      } catch (parseErr) {
        return res.status(400).json({
          success: false,
          message: `Invalid JSON syntax in file '${sourceFileName}'`,
          errors: [`File '${sourceFileName}' is not valid JSON: ${parseErr.message}`],
        });
      }
    } else if (req.body?.canonicalJson) {
      const raw = typeof req.body.canonicalJson === "string" 
        ? stripMarkdownCodeFences(req.body.canonicalJson) 
        : req.body.canonicalJson;
      sourceFileName = req.body.sourceFileName || "course.json";
      try {
        canonicalJson = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch (parseErr) {
        const isNaturalLanguage = typeof raw === "string" && !raw.trim().startsWith("{") && !raw.trim().startsWith("[");
        return res.status(400).json({
          success: false,
          message: isNaturalLanguage 
            ? "Input does not appear to be JSON."
            : `Invalid JSON text syntax: ${parseErr.message}`,
          errors: [
            isNaturalLanguage 
              ? "This doesn't appear to be JSON. If you want to generate course JSON, use ChatGPT, Claude, Gemini, or another AI assistant and ask it to follow the Orange Tree LMS Course JSON v2 format."
              : `JSON Syntax Error: ${parseErr.message}`
          ],
        });
      }
    } else if (req.body?.metadata) {
      canonicalJson = req.body;
      sourceFileName = req.body.sourceFileName || "course.json";
    } else {
      return res.status(400).json({
        success: false,
        message: "No course JSON provided. Upload a .json file or submit JSON text.",
        errors: ["Missing course JSON payload."],
      });
    }

    const job = await courseImporterService.createJsonJob({
      instructorId: req.user.id,
      canonicalJson,
      sourceFileName,
    });

    if (job.status === "FAILED") {
      return res.status(400).json({
        success: false,
        message: "Course JSON validation failed.",
        errors: job.validationReport?.errors || [job.errorMessage],
        data: job,
      });
    }

    res.status(201).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const getTemplate = async (req, res, next) => {
  try {
    const template = {
      metadata: {
        title: "Course Title Here",
        description: "Course description here.",
        category: "General",
        level: "BEGINNER",
        thumbnail: null,
        language: "English",
        tags: ["sample", "template"],
        estimatedLearningHours: 10,
        price: 0
      },
      settings: {
        visibility: "PUBLIC",
        certificatesEnabled: true,
        discussionEnabled: true,
        dripContentEnabled: false
      },
      modules: [
        {
          title: "Module 1: Getting Started",
          description: "First module description.",
          order: 1,
          isPublished: true,
          lessons: [
            {
              title: "Lesson 1: Introduction",
              description: "First lesson description.",
              order: 1,
              isPublished: true,
              topics: [
                {
                  title: "Topic 1: Overview",
                  description: "Topic overview description.",
                  order: 1,
                  isPublished: true,
                  contents: [
                    {
                      type: "HTML",
                      title: "Welcome Note",
                      order: 1,
                      htmlContent: "<h1>Welcome to the course!</h1><p>Start your learning journey here.</p>"
                    },
                    {
                      type: "VIDEO",
                      title: "Introductory Video",
                      order: 2,
                      duration: 300,
                      videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    res.json({ success: true, data: template });
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

module.exports = { uploadPackage, processJsonJob, getTemplate, processJob, getJob, listJobs, updateJob, importJob, deleteJob };
