const courseImporterService = require("../services/courseImporter.service");
const aiCourseGeneratorService = require("../services/aiCourseGenerator.service");
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
    const jobId = req.params.jobId;
    const canonicalJson = req.body?.canonicalJson;
    if (canonicalJson && jobId && !jobId.startsWith("draft-") && jobId !== "draft") {
      try {
        await courseImporterService.updateCanonicalJson(jobId, canonicalJson);
      } catch (ignoredErr) {}
    }
    const result = await courseImporterService.importJob(jobId, req.user.id, canonicalJson);
    res.json({ success: true, data: result });
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
  const reqStartTime = Date.now();
  console.log("[AI DEBUG] REQUEST RECEIVED");
  try {
    let canonicalJson = null;
    let sourceFileName = "course.json";

    if (req.body?.prompt && typeof req.body.prompt === "string" && req.body.prompt.trim()) {
      sourceFileName = "ai_generated_course.json";
      console.log("[AI DEBUG] AI GENERATION START");
      const aiStart = Date.now();
      canonicalJson = await aiCourseGeneratorService.generateCourseFromPrompt({
        prompt: req.body.prompt,
        scope: req.body.scope || "COURSE",
        context: req.body.context || {},
      });
      console.log(`[AI DEBUG] AI GENERATION END: ${Date.now() - aiStart} ms`);

      // For entity-level scope generations (MODULE, LESSON, TOPIC, CONTENT, QUIZ),
      // return the generated JSON directly to the frontend without validating against full course schema.
      if (req.body?.scope && req.body.scope !== "COURSE") {
        console.log(`[AI DEBUG] AI ENTITY GENERATION SUCCESS | TOTAL REQUEST: ${Date.now() - reqStartTime} ms`);
        return res.status(200).json({
          success: true,
          data: canonicalJson,
          canonicalJson,
        });
      }
    } else if (req.file) {
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

    console.log("[AI DEBUG] JOB CREATION START");
    const jobStart = Date.now();
    let job = null;
    try {
      job = await courseImporterService.createJsonJob({
        instructorId: req.user.id,
        canonicalJson,
        sourceFileName,
      });
      console.log(`[AI DEBUG] JOB CREATION END: ${Date.now() - jobStart} ms`);
    } catch (jobErr) {
      console.warn("[AI DEBUG] Could not persist import job record to database:", jobErr.message);
      if (req.body?.prompt) {
        return res.status(200).json({
          success: true,
          data: canonicalJson,
          canonicalJson,
        });
      }
      throw jobErr;
    }

    if (job && job.status === "FAILED") {
      if (req.body?.prompt) {
        console.log(`[AI DEBUG] AI GENERATION SUCCESS (PROMPT FALLBACK) | TOTAL REQUEST: ${Date.now() - reqStartTime} ms`);
        return res.status(200).json({
          success: true,
          data: canonicalJson,
          canonicalJson,
        });
      }
      console.log(`[AI DEBUG] RESPONSE SEND (FAILED) | TOTAL REQUEST: ${Date.now() - reqStartTime} ms`);
      return res.status(400).json({
        success: false,
        message: "Course JSON validation failed.",
        errors: job.validationReport?.errors || [job.errorMessage],
        data: job,
      });
    }

    console.log(`[AI DEBUG] RESPONSE SEND | TOTAL REQUEST: ${Date.now() - reqStartTime} ms`);
    res.status(201).json({ success: true, data: job, canonicalJson });
  } catch (error) {
    console.error(`[AI DEBUG] REQUEST ERROR after ${Date.now() - reqStartTime} ms:`, error);
    next(error);
  }
};

const getTemplate = async (req, res, next) => {
  try {
    const template = {
      metadata: {
        title: "C Programming Fundamentals",
        description: "Master C programming concepts from basic syntax to memory pointers.",
        category: "Computer Science",
        level: "BEGINNER",
        language: "English",
        tags: ["c", "programming", "coding"],
        estimatedLearningHours: 10,
        price: 0
      },
      settings: {
        visibility: "PUBLIC",
        certificatesEnabled: true,
        discussionEnabled: true,
        dripContentEnabled: false
      },
      quizzes: [
        {
          title: "C Programming Final Assessment",
          description: "Comprehensive course-level assessment covering C fundamentals.",
          passingScore: 60,
          timeLimit: 30,
          isPublished: true,
          questions: [
            {
              question: "Which header file is required for printf()?",
              questionType: "MCQ_SINGLE",
              options: ["<stdio.h>", "<stdlib.h>", "<string.h>", "<math.h>"],
              correctAnswer: "<stdio.h>",
              explanation: "printf() is declared in stdio.h.",
              marks: 1,
              negativeMarks: 0,
              difficulty: "EASY"
            },
            {
              question: "Is C a compiled programming language?",
              questionType: "TRUE_FALSE",
              options: ["True", "False"],
              correctAnswer: "True",
              explanation: "C code is directly compiled into machine executable binaries.",
              marks: 1,
              difficulty: "EASY"
            }
          ]
        }
      ],
      modules: [
        {
          title: "C Fundamentals",
          description: "First steps in writing C programs.",
          order: 1,
          isPublished: true,
          quizzes: [
            {
              title: "Module 1 Quick Check",
              description: "Check understanding of basic C concepts.",
              passingScore: 60,
              timeLimit: 15,
              isPublished: true,
              questions: [
                {
                  question: "What is the entry point of a C program?",
                  questionType: "MCQ_SINGLE",
                  options: ["start()", "main()", "run()", "execute()"],
                  correctAnswer: "main()",
                  explanation: "Execution of a C program always begins from main().",
                  marks: 1,
                  difficulty: "EASY"
                }
              ]
            }
          ],
          lessons: [
            {
              title: "Introduction to C",
              description: "Understanding compilation and basic structure.",
              order: 1,
              isPublished: true,
              topics: [
                {
                  title: "What is C?",
                  description: "Overview of procedural programming.",
                  order: 1,
                  isPublished: true,
                  contents: [
                    {
                      type: "HTML",
                      title: "Introduction to C Language",
                      order: 1,
                      htmlContent: "<h2>What is C?</h2><p>C is a low-level, high-efficiency compiled programming language.</p>"
                    },
                    {
                      type: "VIDEO",
                      title: "Writing Your First Hello World",
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
