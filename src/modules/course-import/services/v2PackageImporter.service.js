const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Validates that a relative package path is safe and does not escape the extracted job directory.
 * 
 * @param {string} pkgPath Relative package path string
 * @returns {boolean} True if safe
 */
function isSafePackagePath(pkgPath) {
  if (!pkgPath || typeof pkgPath !== "string") return false;

  const trimmed = pkgPath.trim();
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    trimmed.includes("../") ||
    trimmed.includes("..\\") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\")
  ) {
    return false;
  }

  return true;
}

const VALID_CONTENT_TYPES = new Set([
  "VIDEO",
  "DOCUMENT",
  "TEXT",
  "LINK",
  "PRESENTATION",
  "IMAGE",
  "PDF",
  "FILE",
  "EXTERNAL_LINK",
  "HTML",
  "CODE",
  "ASSIGNMENT",
  "CODING_EXERCISE",
  "SCORM",
  "INTERACTIVE_LAB",
  "AUDIO",
  "EMBED",
  "SLIDE"
]);

function validateQuizDef(quiz, prefix = "quiz") {
  const quizErrors = [];
  if (!quiz || typeof quiz !== "object") {
    quizErrors.push(`${prefix}: Quiz item must be an object.`);
    return quizErrors;
  }
  if (!quiz.title || typeof quiz.title !== "string" || !quiz.title.trim()) {
    quizErrors.push(`${prefix}.title is required.`);
  }
  if (quiz.passingScore !== undefined && (typeof quiz.passingScore !== "number" || quiz.passingScore < 0 || quiz.passingScore > 100)) {
    quizErrors.push(`${prefix}.passingScore must be a number between 0 and 100.`);
  }
  if (quiz.timeLimit !== undefined && quiz.timeLimit !== null && (typeof quiz.timeLimit !== "number" || quiz.timeLimit < 0)) {
    quizErrors.push(`${prefix}.timeLimit must be a non-negative number.`);
  }
  if (quiz.questions !== undefined) {
    if (!Array.isArray(quiz.questions)) {
      quizErrors.push(`${prefix}.questions must be an array.`);
    } else {
      quiz.questions.forEach((q, qIndex) => {
        const qPrefix = `${prefix}.questions[${qIndex}]`;
        if (!q || typeof q !== "object") {
          quizErrors.push(`${qPrefix}: Question item must be an object.`);
          return;
        }
        if (!q.question || typeof q.question !== "string" || !q.question.trim()) {
          quizErrors.push(`${qPrefix}.question is required.`);
        }
        if (!q.questionType || typeof q.questionType !== "string") {
          quizErrors.push(`${qPrefix}.questionType is required.`);
        } else {
          const validTypes = new Set([
            "MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE", "FILL_BLANK",
            "SHORT_ANSWER", "LONG_ANSWER", "ARRANGE_TOKENS", "MATCH_PAIRS", "SELF_ASSESSMENT"
          ]);
          if (!validTypes.has(q.questionType.toUpperCase())) {
            quizErrors.push(`${qPrefix}.questionType "${q.questionType}" is not supported.`);
          }
        }
        if (q.options !== undefined && q.options !== null && typeof q.options !== "object") {
          quizErrors.push(`${qPrefix}.options must be an array or object.`);
        }
      });
    }
  }
  return quizErrors;
}

/**
 * Validates Canonical Course JSON v2 schema structure.
 * 
 * @param {Object} courseJson Parsed course.json object
 * @returns {{ isValid: boolean, errors: Array<string> }}
 */
function validateV2Manifest(courseJson) {
  const errors = [];

  if (!courseJson || typeof courseJson !== "object") {
    return { isValid: false, errors: ["Course JSON must be a valid object."] };
  }

  if (!courseJson.metadata || typeof courseJson.metadata !== "object") {
    errors.push("metadata: Missing or invalid metadata object.");
  } else if (!courseJson.metadata.title || typeof courseJson.metadata.title !== "string" || !courseJson.metadata.title.trim()) {
    errors.push("metadata.title: Course title is required and cannot be empty.");
  }

  if (!courseJson.settings || typeof courseJson.settings !== "object") {
    errors.push("settings: Missing or invalid settings object.");
  }

  // Validate Course-Level Quizzes (when present)
  if (courseJson.quizzes !== undefined) {
    if (!Array.isArray(courseJson.quizzes)) {
      errors.push("quizzes: Must be an array.");
    } else {
      courseJson.quizzes.forEach((qz, qi) => {
        errors.push(...validateQuizDef(qz, `quizzes[${qi}]`));
      });
    }
  }

  if (!Array.isArray(courseJson.modules)) {
    errors.push("modules: Missing or invalid modules array.");
  } else if (courseJson.modules.length === 0) {
    errors.push("modules: At least one module is required in the course.");
  } else {
    courseJson.modules.forEach((mod, mi) => {
      if (!mod || typeof mod !== "object") {
        errors.push(`modules[${mi}]: Module item must be an object.`);
        return;
      }
      if (!mod.title || typeof mod.title !== "string" || !mod.title.trim()) {
        errors.push(`modules[${mi}].title is required.`);
      }

      // Validate Module-Level Quizzes (when present)
      if (mod.quizzes !== undefined) {
        if (!Array.isArray(mod.quizzes)) {
          errors.push(`modules[${mi}].quizzes: Must be an array.`);
        } else {
          mod.quizzes.forEach((qz, qi) => {
            errors.push(...validateQuizDef(qz, `modules[${mi}].quizzes[${qi}]`));
          });
        }
      }

      if (!Array.isArray(mod.lessons)) {
        errors.push(`modules[${mi}].lessons: Lessons must be an array.`);
      } else {
        mod.lessons.forEach((les, li) => {
          if (!les || typeof les !== "object") {
            errors.push(`modules[${mi}].lessons[${li}]: Lesson item must be an object.`);
            return;
          }
          if (!les.title || typeof les.title !== "string" || !les.title.trim()) {
            errors.push(`modules[${mi}].lessons[${li}].title is required.`);
          }

          if (!Array.isArray(les.topics)) {
            errors.push(`modules[${mi}].lessons[${li}].topics: Topics must be an array.`);
          } else {
            les.topics.forEach((top, ti) => {
              if (!top || typeof top !== "object") {
                errors.push(`modules[${mi}].lessons[${li}].topics[${ti}]: Topic item must be an object.`);
                return;
              }
              if (!top.title || typeof top.title !== "string" || !top.title.trim()) {
                errors.push(`modules[${mi}].lessons[${li}].topics[${ti}].title is required.`);
              }

              if (!Array.isArray(top.contents)) {
                errors.push(`modules[${mi}].lessons[${li}].topics[${ti}].contents: Contents must be an array.`);
              } else {
                top.contents.forEach((cnt, ci) => {
                  if (!cnt || typeof cnt !== "object") {
                    errors.push(`modules[${mi}].lessons[${li}].topics[${ti}].contents[${ci}]: Content item must be an object.`);
                    return;
                  }
                  if (!cnt.type || typeof cnt.type !== "string") {
                    errors.push(`modules[${mi}].lessons[${li}].topics[${ti}].contents[${ci}].type is required.`);
                  } else {
                    const upperType = cnt.type.toUpperCase();
                    if (!VALID_CONTENT_TYPES.has(upperType)) {
                      errors.push(
                        `modules[${mi}].lessons[${li}].topics[${ti}].contents[${ci}].type "${cnt.type}" is not a supported content type.`
                      );
                    }
                  }
                });
              }
            });
          }
        });
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Resolves and validates local package asset files on disk within extracted job directory.
 * Copies verified files to permanent uploads storage (/uploads/thumbnails/, /uploads/contents/).
 * 
 * @param {string} jobDir Extracted job directory path
 * @param {Object} courseJson Validated canonical course JSON v2
 * @returns {{ copiedAssets: Array<{ targetPath: string }>, assetMap: Map<string, string>, errors: Array<string> }}
 */
function prepareV2Assets(jobDir, courseJson) {
  const errors = [];
  const copiedAssets = [];
  const assetMap = new Map(); // raw packagePath -> server URL path (/uploads/...)

  const uploadsRoot = path.resolve(__dirname, "../../../../uploads");
  const thumbsTargetDir = path.join(uploadsRoot, "thumbnails");
  const contentsTargetDir = path.join(uploadsRoot, "contents");

  if (!fs.existsSync(thumbsTargetDir)) fs.mkdirSync(thumbsTargetDir, { recursive: true });
  if (!fs.existsSync(contentsTargetDir)) fs.mkdirSync(contentsTargetDir, { recursive: true });

  const processLocalFile = (relPkgPath, subfolder) => {
    if (!relPkgPath || typeof relPkgPath !== "string") return;
    if (relPkgPath.startsWith("http://") || relPkgPath.startsWith("https://")) return;

    if (!isSafePackagePath(relPkgPath)) {
      errors.push(`Security error: Dangerous asset package path '${relPkgPath}'`);
      return;
    }

    const sourceFilePath = path.resolve(jobDir, relPkgPath);
    const normalizedJobDir = path.normalize(jobDir) + path.sep;
    if (!path.normalize(sourceFilePath).startsWith(normalizedJobDir)) {
      errors.push(`Security error: Asset '${relPkgPath}' escapes extraction directory`);
      return;
    }

    if (!fs.existsSync(sourceFilePath)) {
      errors.push(`Missing file asset in package: '${relPkgPath}'`);
      return;
    }

    if (!assetMap.has(relPkgPath)) {
      const ext = path.extname(relPkgPath);
      const uniqueName = `${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
      const targetDir = subfolder === "thumbnails" ? thumbsTargetDir : contentsTargetDir;
      const targetFilePath = path.join(targetDir, uniqueName);

      fs.copyFileSync(sourceFilePath, targetFilePath);
      copiedAssets.push({ targetPath: targetFilePath });

      const serverUrl = `/uploads/${subfolder}/${uniqueName}`;
      assetMap.set(relPkgPath, serverUrl);
    }
  };

  // 1. Check Thumbnail
  if (courseJson.metadata && courseJson.metadata.thumbnail) {
    processLocalFile(courseJson.metadata.thumbnail, "thumbnails");
  }

  // 2. Check Content Media Files
  const modules = Array.isArray(courseJson.modules) ? courseJson.modules : [];
  for (const mod of modules) {
    for (const les of mod.lessons || []) {
      for (const top of les.topics || []) {
        for (const cnt of top.contents || []) {
          if (cnt.mediaFile) {
            processLocalFile(cnt.mediaFile, "contents");
          }
        }
      }
    }
  }

  return { copiedAssets, assetMap, errors };
}

/**
 * Processes an extracted V2 package job directory during /process.
 * 
 * @param {string} jobDir Extracted job directory
 * @param {string} jobId Course import job ID
 * @param {Object} rawCourseJson Parsed course.json object
 * @returns {Promise<{ canonicalJson: Object, validationReport: Object }>}
 */
async function processV2Package(jobDir, jobId, rawCourseJson) {
  const validation = validateV2Manifest(rawCourseJson);
  if (!validation.isValid) {
    throw new ApiError(400, `Invalid V2 course.json package: ${validation.errors.join("; ")}`);
  }

  const assetPrep = prepareV2Assets(jobDir, rawCourseJson);
  if (assetPrep.errors.length > 0) {
    throw new ApiError(400, `V2 Package Asset Error: ${assetPrep.errors.join("; ")}`);
  }

  // Convert map to plain object for Prisma JSON storage
  const assetMapObj = {};
  for (const [k, v] of assetPrep.assetMap.entries()) {
    assetMapObj[k] = v;
  }

  const canonicalJson = {
    version: "2.0",
    $schema: rawCourseJson.$schema,
    metadata: rawCourseJson.metadata,
    settings: rawCourseJson.settings,
    quizzes: Array.isArray(rawCourseJson.quizzes) ? rawCourseJson.quizzes : [],
    modules: rawCourseJson.modules,
    assetMap: assetMapObj
  };

  const validationReport = {
    isValid: true,
    errors: [],
    warnings: [],
    info: [`V2 Package processed successfully with ${Object.keys(assetMapObj).length} local asset(s).`]
  };

  return { canonicalJson, validationReport };
}

/**
 * Imports a processed V2 CoursePackage into the database inside an ATOMIC PRISMA TRANSACTION.
 * Preserves full hierarchy: Course -> Module -> Lesson -> Topic -> Content + Course/Module Quizzes & Questions.
 *
 * @param {Object} job CourseImportJob Prisma model object
 * @param {string} instructorId Authenticated user ID importing the course
 * @returns {Promise<Object>} Created course database object
 */
async function importV2Job(job, instructorId) {
  const canonical = job.canonicalJson;
  if (!canonical) {
    throw new ApiError(400, "Job canonicalJson is missing.");
  }

  const metadata = canonical.metadata || {};
  const settings = canonical.settings || {};
  const modules = Array.isArray(canonical.modules) ? canonical.modules : [];
  const courseQuizzes = Array.isArray(canonical.quizzes) ? canonical.quizzes : [];
  const assetMap = canonical.assetMap || {};

  // Resolve thumbnail server URL
  let thumbnailUrl = null;
  if (metadata.thumbnail) {
    thumbnailUrl = assetMap[metadata.thumbnail] || null;
  }

  const rawModules = Array.isArray(modules) ? modules : [];

  // Execute database creation inside ATOMIC Prisma transaction
  let createdCourse;
  try {
    createdCourse = await prisma.$transaction(async (tx) => {
      // 1. Create Course
      const courseRecord = await tx.course.create({
        data: {
          title: metadata.title || "Imported Course",
          description: metadata.description ?? null,
          category: metadata.category ?? null,
          level: metadata.level ?? null,
          thumbnailUrl,
          status: "DRAFT",
          visibility: settings?.visibility || "PUBLIC",
          language: metadata.language ?? null,
          tags: Array.isArray(metadata.tags) ? metadata.tags : [],
          certificatesEnabled: Boolean(settings?.certificatesEnabled),
          discussionEnabled: Boolean(settings?.discussionEnabled),
          dripContentEnabled: Boolean(settings?.dripContentEnabled),
          estimatedLearningHours: metadata.estimatedLearningHours ?? null,
          creatorId: instructorId
        }
      });

      // 2-5. Walk the Module -> Lesson -> Topic -> Content hierarchy once
      const moduleRows = [];
      const lessonRows = [];
      const topicRows = [];
      const contentRows = [];

      // Quizzes & Questions collectors
      const quizRows = [];
      const questionRows = [];
      const quizQuestionRows = [];

      const processQuizDef = (quizDef, targetModuleId = null) => {
        const quizId = crypto.randomUUID();
        quizRows.push({
          id: quizId,
          title: quizDef.title || "Imported Quiz",
          description: quizDef.description ?? null,
          passingScore: quizDef.passingScore !== undefined && quizDef.passingScore !== null ? Number(quizDef.passingScore) : 50,
          timeLimit: quizDef.timeLimit !== undefined && quizDef.timeLimit !== null ? Number(quizDef.timeLimit) : null,
          isPublished: quizDef.isPublished !== undefined ? Boolean(quizDef.isPublished) : true,
          status: "ACTIVE",
          courseId: courseRecord.id,
          moduleId: targetModuleId,
          batchId: null
        });

        const questions = Array.isArray(quizDef.questions) ? quizDef.questions : [];
        questions.forEach((qDef, qIdx) => {
          const questionId = crypto.randomUUID();
          questionRows.push({
            id: questionId,
            quizId: null,
            courseId: courseRecord.id,
            moduleId: targetModuleId,
            question: qDef.question || "",
            questionType: (qDef.questionType || "MCQ_SINGLE").toUpperCase(),
            options: qDef.options ?? [],
            correctAnswer: qDef.correctAnswer ?? "",
            explanation: qDef.explanation ?? null,
            marks: qDef.marks ? Number(qDef.marks) : 1,
            negativeMarks: qDef.negativeMarks ? Number(qDef.negativeMarks) : 0,
            difficulty: (qDef.difficulty || "MEDIUM").toUpperCase(),
            createdBy: instructorId
          });

          quizQuestionRows.push({
            id: crypto.randomUUID(),
            quizId,
            questionId,
            order: qIdx + 1,
            marks: qDef.marks ? Number(qDef.marks) : 1,
            isMandatory: true
          });
        });
      };

      // Process Course-Level Quizzes
      for (const courseQuizDef of courseQuizzes) {
        processQuizDef(courseQuizDef, null);
      }

      for (const moduleDef of rawModules) {
        const moduleId = crypto.randomUUID();
        moduleRows.push({
          id: moduleId,
          title: moduleDef.title || "Untitled Module",
          description: moduleDef.description ?? null,
          order: moduleDef.order ?? 0,
          isPublished: Boolean(moduleDef.isPublished),
          courseId: courseRecord.id
        });

        // Process Module-Level Quizzes
        const modQuizzes = Array.isArray(moduleDef.quizzes) ? moduleDef.quizzes : [];
        for (const modQuizDef of modQuizzes) {
          processQuizDef(modQuizDef, moduleId);
        }

        const rawLessons = Array.isArray(moduleDef.lessons) ? moduleDef.lessons : [];
        for (const lessonDef of rawLessons) {
          const lessonId = crypto.randomUUID();
          lessonRows.push({
            id: lessonId,
            title: lessonDef.title || "Untitled Lesson",
            description: lessonDef.description ?? null,
            order: lessonDef.order ?? 0,
            isPublished: Boolean(lessonDef.isPublished),
            moduleId
          });

          const rawTopics = Array.isArray(lessonDef.topics) ? lessonDef.topics : [];
          for (const topicDef of rawTopics) {
            const topicId = crypto.randomUUID();
            topicRows.push({
              id: topicId,
              title: topicDef.title || "Untitled Topic",
              description: topicDef.description ?? null,
              order: topicDef.order ?? 0,
              isPublished: Boolean(topicDef.isPublished),
              lessonId
            });

            const rawContents = Array.isArray(topicDef.contents) ? topicDef.contents : [];
            for (const contentDef of rawContents) {
              let videoUrl = contentDef.videoUrl ?? null;
              let fileUrl = contentDef.externalUrl ?? null;
              const externalUrl = contentDef.externalUrl ?? null;

              if (contentDef.mediaFile) {
                const serverAssetUrl = assetMap[contentDef.mediaFile] || null;
                if (contentDef.type === "VIDEO") {
                  videoUrl = serverAssetUrl;
                } else {
                  fileUrl = serverAssetUrl;
                }
              }

              contentRows.push({
                type: contentDef.type || contentDef.contentType || "TEXT",
                title: contentDef.title ?? null,
                order: contentDef.order ?? 0,
                duration: contentDef.duration ?? null,
                htmlContent: contentDef.htmlContent ?? null,
                videoUrl,
                fileUrl,
                externalUrl,
                data: contentDef.data ?? undefined,
                topicId
              });
            }
          }
        }
      }

      // One batched insert per level
      if (moduleRows.length > 0) await tx.module.createMany({ data: moduleRows });
      if (lessonRows.length > 0) await tx.lesson.createMany({ data: lessonRows });
      if (topicRows.length > 0) await tx.topic.createMany({ data: topicRows });
      if (contentRows.length > 0) await tx.content.createMany({ data: contentRows });

      // Insert Quiz, Question, and QuizQuestion rows
      if (quizRows.length > 0) await tx.quiz.createMany({ data: quizRows });
      if (questionRows.length > 0) await tx.question.createMany({ data: questionRows });
      if (quizQuestionRows.length > 0) await tx.quizQuestion.createMany({ data: quizQuestionRows });

      return courseRecord;
    }, {
      maxWait: 20000,
      timeout: 60000
    });

    // Update job status to COMPLETED
    await prisma.courseImportJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", courseId: createdCourse.id }
    });

    return createdCourse;
  } catch (error) {
    // Update job status to FAILED
    await prisma.courseImportJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: error.message, courseId: null }
    });
    throw error;
  }
}

module.exports = {
  isSafePackagePath,
  validateV2Manifest,
  prepareV2Assets,
  processV2Package,
  importV2Job
};
