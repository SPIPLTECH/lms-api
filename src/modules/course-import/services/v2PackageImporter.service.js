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

/**
 * Validates Canonical Course JSON v2 schema structure.
 * 
 * @param {Object} courseJson Parsed course.json object
 * @returns {{ isValid: boolean, errors: Array<string> }}
 */
function validateV2Manifest(courseJson) {
  const errors = [];

  if (!courseJson || typeof courseJson !== "object") {
    return { isValid: false, errors: ["Manifest course.json must be a JSON object."] };
  }

  if (courseJson.version !== "2.0" && (!courseJson.$schema || !courseJson.$schema.includes("course-v2.json"))) {
    errors.push("Invalid manifest version: expected version '2.0' or v2 $schema.");
  }

  if (!courseJson.metadata || typeof courseJson.metadata !== "object" || !courseJson.metadata.title) {
    errors.push("Missing or invalid metadata.title in course.json.");
  }

  if (!courseJson.settings || typeof courseJson.settings !== "object") {
    errors.push("Missing or invalid settings object in course.json.");
  }

  if (!Array.isArray(courseJson.modules)) {
    errors.push("Missing or invalid modules array in course.json.");
  } else {
    courseJson.modules.forEach((mod, mi) => {
      if (!mod || typeof mod !== "object" || !mod.title) {
        errors.push(`Module at index ${mi} is missing a title.`);
      }
      if (!Array.isArray(mod.lessons)) {
        errors.push(`Module '${mod?.title || mi}' lessons must be an array.`);
      } else {
        mod.lessons.forEach((les, li) => {
          if (!les || typeof les !== "object" || !les.title) {
            errors.push(`Lesson at index ${li} in Module '${mod.title}' is missing a title.`);
          }
          if (!Array.isArray(les.topics)) {
            errors.push(`Lesson '${les?.title || li}' topics must be an array.`);
          } else {
            les.topics.forEach((top, ti) => {
              if (!top || typeof top !== "object" || !top.title) {
                errors.push(`Topic at index ${ti} in Lesson '${les.title}' is missing a title.`);
              }
              if (!Array.isArray(top.contents)) {
                errors.push(`Topic '${top?.title || ti}' contents must be an array.`);
              } else {
                top.contents.forEach((cnt, ci) => {
                  if (!cnt || typeof cnt !== "object" || !cnt.type) {
                    errors.push(`Content at index ${ci} in Topic '${top.title}' is missing a type.`);
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
 * Preserves full 5-layer hierarchy: Course -> Module -> Lesson -> Topic -> Content.
 *
 * Module/Lesson/Topic/Content rows are batched one createMany() per level instead of one
 * create() per row. Module/Lesson/Topic ids are generated client-side (crypto.randomUUID)
 * so each child row's foreign key is already known before its parent's batch insert runs —
 * Content keeps its normal Prisma-generated cuid() id since nothing references it as a
 * parent. This turns an O(course+modules+lessons+topics+contents) sequence of round trips
 * into a fixed 5 round trips regardless of course size, which is what actually made large
 * packages exceed the transaction timeout (see investigation: ~150ms/round-trip against the
 * remote Postgres instance, so a few hundred sequential creates alone can take well over a
 * minute).
 *
 * @param {Object} job CourseImportJob Prisma model object
 * @param {string} instructorId Authenticated user ID importing the course
 * @returns {Promise<Object>} Created course database object
 */
async function importV2Job(job, instructorId) {
  const canonical = job.canonicalJson;
  if (!canonical || canonical.version !== "2.0") {
    throw new ApiError(400, "Job canonicalJson is missing or not a valid V2 package.");
  }

  const { metadata, settings, modules } = canonical;
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

      // 2-5. Walk the Module -> Lesson -> Topic -> Content hierarchy once, building one flat
      // row array per level (Explicit Topic Preservation - NO artificial "General" topic
      // injection, same as before). Module/Lesson/Topic ids are minted here so a child's
      // foreign key is ready before that parent level is actually inserted below.
      const moduleRows = [];
      const lessonRows = [];
      const topicRows = [];
      const contentRows = [];

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
                type: contentDef.type,
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

      // One batched insert per level (parent before child) instead of one round trip per row.
      if (moduleRows.length > 0) await tx.module.createMany({ data: moduleRows });
      if (lessonRows.length > 0) await tx.lesson.createMany({ data: lessonRows });
      if (topicRows.length > 0) await tx.topic.createMany({ data: topicRows });
      if (contentRows.length > 0) await tx.content.createMany({ data: contentRows });

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
