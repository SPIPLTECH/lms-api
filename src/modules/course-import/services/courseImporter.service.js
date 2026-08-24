const fs = require("fs");
const path = require("path");
const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const { extractZip } = require("../utils/zip.util");
const { scanDirectory } = require("./fileScanner.service");
const { buildCanonicalCourse } = require("./jsonTransformer.service");
const { validateCourse } = require("./validator.service");
const composerMapper = require("./composerMapper.service");
const serverQuizMapper = require("./serverQuizMapper.service");

const v2PackageImporter = require("./v2PackageImporter.service");
const courseService = require("../../courses/course.service");
const moduleService = require("../../modules/module.service");
const lessonService = require("../../lessons/lesson.service");
const topicService = require("../../topics/topic.service");
const contentService = require("../../contents/content.service");
const quizService = require("../../quizzes/quiz.service");
const questionService = require("../../questions/question.service");
const assignmentService = require("../../assignments/assignment.service");

const UPLOAD_ROOT = path.join(__dirname, "../../../../uploads/course-imports");

const createJob = async ({ instructorId, sourceFileName, zipFilePath }) => {
  const job = await prisma.courseImportJob.create({
    data: { instructorId, sourceFileName, sourcePath: "", status: "UPLOADED" },
  });

  const jobDir = path.join(UPLOAD_ROOT, job.id);

  try {
    extractZip(zipFilePath, jobDir);
  } catch (error) {
    await prisma.courseImportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorMessage: error.message } });
    throw new ApiError(400, `Could not extract package: ${error.message}`);
  } finally {
    try { fs.unlinkSync(zipFilePath); } catch (error) { /* best-effort cleanup of the ephemeral upload */ }
  }

  return prisma.courseImportJob.update({
    where: { id: job.id },
    data: { sourcePath: `course-imports/${job.id}` },
  });
};

const createJsonJob = async ({ instructorId, canonicalJson, sourceFileName }) => {
  const { validateV2Manifest } = require("./v2PackageImporter.service");
  const validation = validateV2Manifest(canonicalJson);

  const title = canonicalJson?.metadata?.title || "Course JSON Package";
  const name = sourceFileName || `${title.toLowerCase().replace(/[^a-z0-9]/g, "_")}.json`;

  const validationReport = {
    isValid: validation.isValid,
    errors: validation.errors,
    warnings: [],
    info: validation.isValid
      ? ["Course JSON schema validation passed successfully."]
      : ["Course JSON validation failed."]
  };

  const job = await prisma.courseImportJob.create({
    data: {
      instructorId,
      sourceFileName: name,
      sourcePath: "json-import",
      status: validation.isValid ? "READY" : "FAILED",
      canonicalJson,
      validationReport,
      errorMessage: validation.isValid ? null : validation.errors.join("; ")
    }
  });

  return job;
};

const getJob = async (jobId) => prisma.courseImportJob.findUnique({ where: { id: jobId } });

const listJobs = async (instructorId) => prisma.courseImportJob.findMany({ where: { instructorId }, orderBy: { createdAt: "desc" } });

const processJob = async (jobId, baseUrl) => {
  const job = await getJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.");

  await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "EXTRACTING" } });

  const jobDir = path.join(UPLOAD_ROOT, jobId);

  // Check for V2 Canonical Package Manifest (course.json)
  const courseJsonPath = path.join(jobDir, "course.json");
  if (fs.existsSync(courseJsonPath)) {
    let rawCourseJson;
    try {
      rawCourseJson = JSON.parse(fs.readFileSync(courseJsonPath, "utf8"));
    } catch (parseErr) {
      return prisma.courseImportJob.update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage: `Invalid course.json format: ${parseErr.message}` },
      });
    }

    if (rawCourseJson && (rawCourseJson.version === "2.0" || rawCourseJson.$schema?.includes("course-v2.json"))) {
      await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "ANALYZING" } });
      try {
        const v2Result = await v2PackageImporter.processV2Package(jobDir, jobId, rawCourseJson);
        return await prisma.courseImportJob.update({
          where: { id: jobId },
          data: { status: "READY", canonicalJson: v2Result.canonicalJson, validationReport: v2Result.validationReport },
        });
      } catch (v2Err) {
        return prisma.courseImportJob.update({
          where: { id: jobId },
          data: { status: "FAILED", errorMessage: v2Err.message },
        });
      }
    }
  }

  // Fallback to V1 folder/file scanning processing path
  const files = scanDirectory(jobDir);

  await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "ANALYZING" } });

  try {
    const canonical = await buildCanonicalCourse({ files, jobId, baseUrl, sourceFileName: job.sourceFileName });
    const validationReport = validateCourse(canonical.course);

    return await prisma.courseImportJob.update({
      where: { id: jobId },
      data: { status: "READY", canonicalJson: canonical, validationReport },
    });
  } catch (error) {
    return prisma.courseImportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMessage: error.message },
    });
  }
};

const updateCanonicalJson = async (jobId, canonicalJson) => {
  const job = await getJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.");
  if (!canonicalJson) throw new ApiError(400, "canonicalJson is required.");

  return prisma.courseImportJob.update({
    where: { id: jobId },
    data: { canonicalJson, status: "READY" },
  });
};

/** Creates one gradable Question (lazily creating one Quiz per Lesson, same idempotency as ContentBlockCard.handleSave) for a quiz block, or returns null if the block isn't backend-gradable or creation fails — a failed question never aborts the whole import, the block is still preserved as a Content row either way. */
const attachGradableQuestion = async (block, { courseId, moduleId, lessonId, lessonTitle, quizIdByLesson }) => {
  if (!serverQuizMapper.isBackendGradable(block)) return;

  try {
    if (!quizIdByLesson.has(lessonId)) {
      const quiz = await quizService.createQuiz(serverQuizMapper.buildQuizPayload(block, { courseId, lessonTitle }));
      quizIdByLesson.set(lessonId, quiz.id);
    }
    const quizId = quizIdByLesson.get(lessonId);

    const questionPayload = serverQuizMapper.buildQuestionPayload(block, { courseId, moduleId, quizId });
    const question = await questionService.createQuestion(questionPayload);

    block.attributes = { ...(block.attributes || {}), quizLinkage: { quizId, questionId: question.id } };
  } catch (error) {
    block.attributes = { ...(block.attributes || {}), quizLinkageError: error.message };
  }
};

const importJob = async (jobId, instructorId, fallbackCanonicalJson = null) => {
  const job = await getJob(jobId);
  if (!job) {
    if (fallbackCanonicalJson || (jobId && (jobId.startsWith("draft-") || jobId === "draft"))) {
      return await v2PackageImporter.importV2Manifest(fallbackCanonicalJson || {}, instructorId);
    }
    throw new ApiError(404, "Import job not found.");
  }

  if (job.status === "COMPLETED") {
    return job;
  }
  if (job.status === "IMPORTING") {
    return job;
  }

  // Check for V2 Package canonicalJson (has metadata, modules, or version)
  if (job.canonicalJson?.metadata || job.canonicalJson?.modules || job.canonicalJson?.version === "2.0") {
    await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "IMPORTING" } });
    return await v2PackageImporter.importV2Job(job, instructorId);
  }

  // Fallback to V1 import execution
  if (!job.canonicalJson?.course) throw new ApiError(400, "This job has no processed course to import yet — run /process first.");

  await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "IMPORTING" } });

  const { course } = job.canonicalJson;
  let createdCourseId = null;

  try {
    const createdCourse = await courseService.createCourse(
      {
        title: course.title || "Imported Course",
        description: course.description || "",
        category: course.category || undefined,
        level: course.level || undefined,
      },
      instructorId
    );
    createdCourseId = createdCourse.id;

    const quizIdByLesson = new Map();

    for (const moduleDef of course.modules || []) {
      const createdModule = await moduleService.createModule({
        title: moduleDef.title || "Untitled Module",
        description: moduleDef.description || "",
        order: moduleDef.order,
        courseId: createdCourseId,
      });

      for (const lessonDef of moduleDef.lessons || []) {
        const createdLesson = await lessonService.createLesson({
          title: lessonDef.title || "Untitled Lesson",
          description: lessonDef.description || "",
          order: lessonDef.order,
          moduleId: createdModule.id,
        });

        const topicsToImport = (lessonDef.topics && lessonDef.topics.length > 0)
          ? lessonDef.topics
          : [{ title: "General", order: 1, contents: lessonDef.content || [] }];

        let lessonHasContent = false;

        for (const topicDef of topicsToImport) {
          const createdTopic = await topicService.createTopic({
            title: topicDef.title || "General",
            order: topicDef.order || 1,
            isPublished: true,
            lessonId: createdLesson.id,
          });

          let contentOrder = 1;
          const contentsToImport = topicDef.contents || topicDef.content || [];

          for (const block of contentsToImport) {
            if (block.blockType === "quiz") {
              await attachGradableQuestion(block, {
                courseId: createdCourseId,
                moduleId: createdModule.id,
                lessonId: createdLesson.id,
                lessonTitle: createdLesson.title,
                quizIdByLesson,
              });
            }

            const payload = composerMapper.toContentPayload(block, { topicId: createdTopic.id, order: contentOrder });
            await contentService.createContent(payload);
            contentOrder += 1;
            lessonHasContent = true;
          }
        }

        if (lessonHasContent) {
          await lessonService.updateLesson(createdLesson.id, { isPublished: true });
        }
      }

      const moduleLessonCount = await prisma.lesson.count({ where: { moduleId: createdModule.id } });
      if (moduleLessonCount > 0) {
        await moduleService.updateModule(createdModule.id, { isPublished: true });
      }
    }

    for (const assignmentDef of course.unmappedAssignments || []) {
      await assignmentService.createAssignment({
        title: assignmentDef.title || "Imported Assignment",
        description: assignmentDef.description || "",
        dueDate: assignmentDef.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        courseId: createdCourseId,
        isPublished: false,
      });
    }

    return await prisma.courseImportJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", courseId: createdCourseId },
    });
  } catch (error) {
    if (createdCourseId) {
      try { await courseService.deleteCourse(createdCourseId); } catch (cleanupError) { /* best-effort compensating cleanup, no true cross-table transaction available */ }
    }
    await prisma.courseImportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMessage: error.message, courseId: null },
    });
    throw error;
  }
};

const deleteJob = async (jobId) => {
  const job = await getJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.");

  const jobDir = path.join(UPLOAD_ROOT, jobId);
  if (fs.existsSync(jobDir)) {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }

  return prisma.courseImportJob.delete({ where: { id: jobId } });
};

module.exports = { createJob, createJsonJob, getJob, listJobs, processJob, updateCanonicalJson, importJob, deleteJob };
