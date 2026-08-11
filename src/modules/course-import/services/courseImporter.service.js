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

const courseService = require("../../courses/course.service");
const moduleService = require("../../modules/module.service");
const lessonService = require("../../lessons/lesson.service");
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

const getJob = async (jobId) => prisma.courseImportJob.findUnique({ where: { id: jobId } });

const listJobs = async (instructorId) => prisma.courseImportJob.findMany({ where: { instructorId }, orderBy: { createdAt: "desc" } });

const processJob = async (jobId, baseUrl) => {
  const job = await getJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.");

  await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "EXTRACTING" } });

  const jobDir = path.join(UPLOAD_ROOT, jobId);
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
  if (!canonicalJson?.course) throw new ApiError(400, "canonicalJson.course is required.");

  const validationReport = validateCourse(canonicalJson.course);

  return prisma.courseImportJob.update({
    where: { id: jobId },
    data: { canonicalJson, validationReport, status: "READY" },
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

const importJob = async (jobId, instructorId) => {
  const job = await getJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.");
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

        let contentOrder = 1;
        for (const block of lessonDef.content || []) {
          if (block.blockType === "quiz") {
            await attachGradableQuestion(block, {
              courseId: createdCourseId,
              moduleId: createdModule.id,
              lessonId: createdLesson.id,
              lessonTitle: createdLesson.title,
              quizIdByLesson,
            });
          }

          const payload = composerMapper.toContentPayload(block, { lessonId: createdLesson.id, order: contentOrder });
          await contentService.createContent(payload);
          contentOrder += 1;
        }

        // Modules/lessons can't be published at creation time (createLesson/
        // createModule both reject isPublished:true until they have
        // children) — clicking "Import Course" is the instructor's
        // deliberate approval of the reviewed preview, so every lesson with
        // real content is published immediately after, same as a course the
        // instructor finishes authoring by hand. The Course itself still
        // stays DRAFT — publishing the course is a separate, bigger action
        // the instructor takes explicitly, same as any hand-built course.
        if (contentOrder > 1) {
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

module.exports = { createJob, getJob, listJobs, processJob, updateCanonicalJson, importJob, deleteJob };
