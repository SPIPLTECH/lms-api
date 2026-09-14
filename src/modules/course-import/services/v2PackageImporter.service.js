const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const { parseCourseJson, buildValidationReport, toDbQuizTag, LEVELS } = require("./flexibleCourseJson.service");

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

/**
 * Validates course JSON in either the template or the V2 spelling. Every
 * level and element is optional — see flexibleCourseJson.service.js.
 *
 * @param {Object} courseJson Parsed course.json object
 * @returns {{ isValid: boolean, errors: Array<string>, warnings: Array<string> }}
 */
function validateV2Manifest(courseJson) {
  const { isValid, errors, warnings } = parseCourseJson(courseJson);
  return { isValid, errors, warnings };
}

/** Calls `visit(entity, level)` for the course and every module, lesson and topic of a canonical course. */
function forEachLevel(canonical, visit) {
  const walk = (entity, level) => {
    visit(entity, level);
    const { childKey, childLevel } = LEVELS[level];
    if (childKey) (entity[childKey] || []).forEach((child) => walk(child, childLevel));
  };
  walk(canonical, "course");
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
    if (relPkgPath.startsWith("/uploads/")) return; // already stored on this server

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

  // 1. Check Thumbnail (URLs are skipped by processLocalFile)
  processLocalFile(courseJson.metadata?.thumbnail, "thumbnails");
  processLocalFile(courseJson.metadata?.thumbnailUrl, "thumbnails");

  // 2. Check Content Media Files, wherever the content sits
  forEachLevel(courseJson, (entity) => {
    for (const cnt of entity.contents || []) {
      if (cnt && cnt.mediaFile) {
        processLocalFile(cnt.mediaFile, "contents");
      }
    }
  });

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
  const parsed = parseCourseJson(rawCourseJson);
  if (!parsed.isValid) {
    throw new ApiError(400, `Invalid course.json package: ${parsed.errors.join("; ")}`, undefined, parsed.errors);
  }

  const assetPrep = prepareV2Assets(jobDir, parsed.canonical);
  if (assetPrep.errors.length > 0) {
    throw new ApiError(400, `V2 Package Asset Error: ${assetPrep.errors.join("; ")}`);
  }

  // Convert map to plain object for Prisma JSON storage
  const assetMapObj = {};
  for (const [k, v] of assetPrep.assetMap.entries()) {
    assetMapObj[k] = v;
  }

  const canonicalJson = { ...parsed.canonical, assetMap: assetMapObj };

  const validationReport = buildValidationReport(parsed);
  validationReport.info.push(`Package processed with ${Object.keys(assetMapObj).length} local asset(s).`);

  return { canonicalJson, validationReport };
}

/**
 * Imports course JSON into the database inside an ATOMIC PRISMA TRANSACTION.
 * Content, quizzes and assignments are written at whichever level they sit —
 * course, module, lesson or topic — and nothing is created that the JSON does
 * not contain.
 *
 * @param {Object} canonicalJson Course JSON (template or V2 spelling)
 * @param {string} instructorId Authenticated user ID importing the course
 * @returns {Promise<Object>} Created course database object
 */
async function importV2Manifest(canonicalJson, instructorId) {
  if (!canonicalJson) {
    throw new ApiError(400, "canonicalJson is missing.");
  }

  // The job was fully validated when it was ingested. What arrives here may be
  // the draft Composer's edited copy, which owns its own IDs, so references and
  // answer keys are not re-checked — only what the database itself requires.
  const parsed = parseCourseJson(canonicalJson, { checkReferences: false, checkAnswerKeys: false });
  if (!parsed.isValid) {
    const shown = parsed.errors.slice(0, 3).join("; ");
    const more = parsed.errors.length > 3 ? ` (and ${parsed.errors.length - 3} more)` : "";
    throw new ApiError(400, `Course JSON validation failed: ${shown}${more}`, "COURSE_JSON_INVALID", parsed.errors);
  }

  const course = parsed.canonical;
  const { metadata, settings } = course;
  const assetMap = course.assetMap || {};

  // A package-relative path resolves through the asset map; a URL, or a file
  // already stored on this server, is kept as given.
  const resolveAssetRef = (ref) => {
    if (typeof ref !== "string" || !ref.trim()) return null;
    if (assetMap[ref]) return assetMap[ref];
    return /^https?:\/\//i.test(ref) || ref.startsWith("/uploads/") ? ref : null;
  };

  return await prisma.$transaction(async (tx) => {
    // 1. Create Course
    const courseRecord = await tx.course.create({
      data: {
        title: metadata.title,
        description: metadata.description ?? null,
        category: metadata.category ?? null,
        level: metadata.level ?? null,
        thumbnailUrl: resolveAssetRef(metadata.thumbnailUrl) || resolveAssetRef(metadata.thumbnail),
        status: "DRAFT",
        visibility: settings.visibility || "PUBLIC",
        language: metadata.language ?? null,
        tags: Array.isArray(metadata.tags) ? metadata.tags : [],
        certificatesEnabled: settings.certificatesEnabled ?? false,
        discussionEnabled: settings.discussionEnabled ?? true,
        estimatedLearningHours: metadata.estimatedLearningHours ?? null,
        creatorId: instructorId
      }
    });

    // 2. Walk the hierarchy once, collecting one batch per table
    const moduleRows = [];
    const lessonRows = [];
    const topicRows = [];
    const contentRows = [];
    const quizRows = [];
    const questionRows = [];
    const quizQuestionRows = [];
    const assignmentRows = [];

    // Content and assignments attach to exactly one parent (see
    // contents/content.service.js and assignments/assignment.service.js).
    const addContent = (contentDef, parent) => {
      const mediaUrl = contentDef.mediaFile ? assetMap[contentDef.mediaFile] || null : null;
      const isVideo = contentDef.type === "VIDEO";
      contentRows.push({
        type: contentDef.type,
        title: contentDef.title ?? null,
        order: contentDef.order,
        duration: contentDef.duration ?? null,
        htmlContent: contentDef.htmlContent ?? null,
        videoUrl: mediaUrl && isVideo ? mediaUrl : contentDef.videoUrl ?? null,
        fileUrl: mediaUrl && !isVideo ? mediaUrl : contentDef.fileUrl ?? contentDef.externalUrl ?? null,
        externalUrl: contentDef.externalUrl ?? null,
        data: contentDef.data ?? undefined,
        ...parent
      });
    };

    const addAssignment = (assignmentDef, parent) => {
      const toDate = (value) => (value ? new Date(value) : null);
      assignmentRows.push({
        title: assignmentDef.title,
        description: assignmentDef.description ?? null,
        dueDate: new Date(assignmentDef.dueDate),
        startDate: toDate(assignmentDef.startDate),
        availableFrom: toDate(assignmentDef.availableFrom),
        availableUntil: toDate(assignmentDef.availableUntil),
        marks: assignmentDef.marks ?? null,
        estimatedTime: assignmentDef.estimatedTime ?? 0,
        totalQuestions: assignmentDef.totalQuestions ?? 0,
        resources: assignmentDef.resources ?? 0,
        assessmentType: assignmentDef.assessmentType ?? null,
        attachments: assignmentDef.attachments ?? undefined,
        isPublished: assignmentDef.isPublished ?? true,
        ...parent
      });
    };

    const addQuiz = (quizDef, { moduleId = null, lessonId = null, topicId = null }) => {
      const quizId = crypto.randomUUID();
      // SELF_TEST stays a Self-Test; every assessment tag (and no tag, as in
      // packages authored before tags existed) is FINAL, which keeps timers.
      const quizTag = toDbQuizTag(quizDef.quizTag);
      quizRows.push({
        id: quizId,
        title: quizDef.title,
        description: quizDef.description ?? null,
        quizTag,
        ...(Number.isInteger(quizDef.order) && { order: quizDef.order }),
        passingScore: quizDef.passingScore ?? 50,
        // A Self-Test is never timed, whatever the package claims.
        timeLimit: quizTag === "SELF_TEST" ? null : quizDef.timeLimit ?? null,
        isPublished: quizDef.isPublished ?? true,
        status: "ACTIVE",
        courseId: courseRecord.id,
        moduleId,
        lessonId,
        topicId,
        batchId: null
      });

      (quizDef.questions || []).forEach((qDef, qIdx) => {
        const questionId = crypto.randomUUID();
        questionRows.push({
          id: questionId,
          quizId: null,
          courseId: courseRecord.id,
          moduleId,
          question: qDef.question || "",
          questionType: (qDef.questionType || "MCQ_SINGLE").toUpperCase(),
          options: qDef.options ?? [],
          correctAnswer: qDef.correctAnswer ?? "",
          explanation: qDef.explanation ?? null,
          marks: qDef.marks ?? 1,
          negativeMarks: qDef.negativeMarks ?? 0,
          difficulty: (qDef.difficulty || "MEDIUM").toUpperCase(),
          createdBy: instructorId
        });

        quizQuestionRows.push({
          id: crypto.randomUUID(),
          quizId,
          questionId,
          order: qIdx + 1,
          marks: qDef.marks ?? 1,
          isMandatory: true
        });
      });
    };

    const addLevelItems = (entity, parent, quizScope) => {
      entity.contents.forEach((contentDef) => addContent(contentDef, parent));
      entity.quizzes.forEach((quizDef) => addQuiz(quizDef, quizScope));
      entity.assignments.forEach((assignmentDef) => addAssignment(assignmentDef, parent));
    };

    addLevelItems(course, { courseId: courseRecord.id }, {});

    for (const moduleDef of course.modules) {
      const moduleId = crypto.randomUUID();
      moduleRows.push({
        id: moduleId,
        title: moduleDef.title,
        description: moduleDef.description ?? null,
        order: moduleDef.order,
        isPublished: moduleDef.isPublished ?? false,
        courseId: courseRecord.id
      });
      addLevelItems(moduleDef, { moduleId }, { moduleId });

      for (const lessonDef of moduleDef.lessons) {
        const lessonId = crypto.randomUUID();
        lessonRows.push({
          id: lessonId,
          title: lessonDef.title,
          description: lessonDef.description ?? null,
          order: lessonDef.order,
          isPublished: lessonDef.isPublished ?? false,
          moduleId
        });
        addLevelItems(lessonDef, { lessonId }, { moduleId, lessonId });

        for (const topicDef of lessonDef.topics) {
          const topicId = crypto.randomUUID();
          topicRows.push({
            id: topicId,
            title: topicDef.title,
            description: topicDef.description ?? null,
            order: topicDef.order,
            isPublished: topicDef.isPublished ?? false,
            lessonId
          });
          addLevelItems(topicDef, { topicId }, { moduleId, lessonId, topicId });
        }
      }
    }

    // 3. One batched insert per table, parents before children
    if (moduleRows.length > 0) await tx.module.createMany({ data: moduleRows });
    if (lessonRows.length > 0) await tx.lesson.createMany({ data: lessonRows });
    if (topicRows.length > 0) await tx.topic.createMany({ data: topicRows });
    if (contentRows.length > 0) await tx.content.createMany({ data: contentRows });
    if (quizRows.length > 0) await tx.quiz.createMany({ data: quizRows });
    if (questionRows.length > 0) await tx.question.createMany({ data: questionRows });
    if (quizQuestionRows.length > 0) await tx.quizQuestion.createMany({ data: quizQuestionRows });
    if (assignmentRows.length > 0) await tx.assignment.createMany({ data: assignmentRows });

    return courseRecord;
  }, {
    maxWait: 20000,
    timeout: 60000
  });
}

async function importV2Job(job, instructorId) {
  const canonical = job.canonicalJson;
  if (!canonical) {
    throw new ApiError(400, "Job canonicalJson is missing.");
  }

  let createdCourse;
  try {
    createdCourse = await importV2Manifest(canonical, instructorId);

    // Update job status to COMPLETED if job exists
    if (job.id && !job.id.startsWith("draft-")) {
      await prisma.courseImportJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", courseId: createdCourse.id }
      });
    }

    return createdCourse;
  } catch (error) {
    if (job.id && !job.id.startsWith("draft-")) {
      await prisma.courseImportJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: error.message, courseId: null }
      });
    }
    throw error;
  }
}

module.exports = {
  isSafePackagePath,
  validateV2Manifest,
  prepareV2Assets,
  processV2Package,
  importV2Manifest,
  importV2Job
};
