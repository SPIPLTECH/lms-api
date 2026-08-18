const path = require("path");

/**
 * Helper to identify whether a URL is external or a local upload,
 * and transform local server paths to package-relative paths.
 * If an authoritative assetMap/urlMap is provided (from assetCollector),
 * it uses the resolved package path to guarantee collision consistency.
 * 
 * @param {string|null} url Path or URL string from database
 * @param {string} targetSubfolder Subfolder inside package ("contents", "thumbnails")
 * @param {Map|Object|null} assetMap Optional authoritative URL-to-packagePath map
 * @returns {{ isExternal: boolean, packagePath: string|null }}
 */
function mapAssetReference(url, targetSubfolder = "contents", assetMap = null) {
  if (!url || typeof url !== "string") {
    return { isExternal: false, packagePath: null };
  }

  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { isExternal: true, packagePath: trimmed };
  }

  if (assetMap) {
    if (typeof assetMap.get === "function" && assetMap.has(trimmed)) {
      return { isExternal: false, packagePath: assetMap.get(trimmed) };
    }
    if (assetMap[trimmed]) {
      return { isExternal: false, packagePath: assetMap[trimmed] };
    }
  }

  // Fallback path generation if no assetMap passed
  const filename = path.basename(trimmed);
  if (targetSubfolder === "thumbnails") {
    return { isExternal: false, packagePath: filename };
  }

  return { isExternal: false, packagePath: `${targetSubfolder}/${filename}` };
}

/**
 * Maps Content model instance to Canonical JSON Content object.
 * 
 * @param {Object} content Content Prisma model object
 * @param {Object} [options] Optional mapping configuration (e.g. { assetMap })
 * @returns {Object} Canonical Content object
 */
function mapContentToPackageData(content, options = {}) {
  if (!content) return null;
  const assetMap = options.assetMap || null;

  const result = {
    type: content.type,
    title: content.title ?? null,
    order: content.order,
    duration: content.duration ?? null,
    htmlContent: content.htmlContent ?? null,
    mediaFile: null,
    videoUrl: null,
    externalUrl: content.externalUrl ?? null,
    data: content.data ?? null
  };

  // Process videoUrl
  if (content.videoUrl) {
    const assetRef = mapAssetReference(content.videoUrl, "contents", assetMap);
    if (assetRef.isExternal) {
      result.videoUrl = assetRef.packagePath;
    } else {
      result.mediaFile = assetRef.packagePath;
    }
  }

  // Process fileUrl
  if (content.fileUrl) {
    const assetRef = mapAssetReference(content.fileUrl, "contents", assetMap);
    if (assetRef.isExternal) {
      if (!result.externalUrl) {
        result.externalUrl = assetRef.packagePath;
      }
    } else {
      result.mediaFile = assetRef.packagePath;
    }
  }

  return result;
}

/**
 * Maps Topic model instance to Canonical JSON Topic object.
 * 
 * @param {Object} topic Topic Prisma model object
 * @param {Object} [options] Optional mapping configuration
 * @returns {Object} Canonical Topic object
 */
function mapTopicToPackageData(topic, options = {}) {
  if (!topic) return null;

  const rawContents = Array.isArray(topic.contents) ? topic.contents : [];
  const sortedContents = [...rawContents].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return {
    title: topic.title,
    description: topic.description ?? null,
    order: topic.order,
    isPublished: Boolean(topic.isPublished),
    contents: sortedContents.map((c) => mapContentToPackageData(c, options)).filter(Boolean)
  };
}

/**
 * Maps Lesson model instance to Canonical JSON Lesson object.
 * 
 * @param {Object} lesson Lesson Prisma model object
 * @param {Object} [options] Optional mapping configuration
 * @returns {Object} Canonical Lesson object
 */
function mapLessonToPackageData(lesson, options = {}) {
  if (!lesson) return null;

  const rawTopics = Array.isArray(lesson.topics) ? lesson.topics : [];
  const sortedTopics = [...rawTopics].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return {
    title: lesson.title,
    description: lesson.description ?? null,
    order: lesson.order,
    isPublished: Boolean(lesson.isPublished),
    topics: sortedTopics.map((t) => mapTopicToPackageData(t, options)).filter(Boolean)
  };
}

/**
 * Maps Module model instance to Canonical JSON Module object.
 * 
 * @param {Object} moduleObj Module Prisma model object
 * @param {Object} [options] Optional mapping configuration
 * @returns {Object} Canonical Module object
 */
function mapModuleToPackageData(moduleObj, options = {}) {
  if (!moduleObj) return null;

  const rawLessons = Array.isArray(moduleObj.lessons) ? moduleObj.lessons : [];
  const sortedLessons = [...rawLessons].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return {
    title: moduleObj.title,
    description: moduleObj.description ?? null,
    order: moduleObj.order,
    isPublished: Boolean(moduleObj.isPublished),
    lessons: sortedLessons.map((l) => mapLessonToPackageData(l, options)).filter(Boolean)
  };
}

/**
 * Maps Course metadata attributes.
 * 
 * @param {Object} course Course Prisma model object
 * @param {Object} [options] Optional mapping configuration
 * @returns {Object} Metadata object
 */
function mapCourseMetadata(course, options = {}) {
  const assetMap = options.assetMap || null;
  let thumbnailPath = null;
  if (course.thumbnailUrl) {
    const assetRef = mapAssetReference(course.thumbnailUrl, "thumbnails", assetMap);
    thumbnailPath = assetRef.packagePath;
  }

  return {
    title: course.title,
    description: course.description ?? null,
    category: course.category ?? null,
    level: course.level ?? null,
    thumbnail: thumbnailPath,
    language: course.language ?? null,
    tags: Array.isArray(course.tags) ? course.tags : [],
    estimatedLearningHours: course.estimatedLearningHours ?? null
  };
}

/**
 * Maps Course settings attributes.
 * 
 * @param {Object} course Course Prisma model object
 * @returns {Object} Settings object
 */
function mapCourseSettings(course) {
  return {
    visibility: course.visibility ?? "PUBLIC",
    certificatesEnabled: Boolean(course.certificatesEnabled),
    discussionEnabled: Boolean(course.discussionEnabled),
    dripContentEnabled: Boolean(course.dripContentEnabled)
  };
}

/**
 * Maps a full LMS Course database object to Canonical Course JSON v2.
 * 
 * Pure transformation function: does NOT perform database queries, file writes,
 * or API network calls. Accepts options.assetMap to guarantee 100% collision consistency
 * with the Asset Collector.
 * 
 * @param {Object} course Full 5-layer Course database object
 * @param {Object} [options] Optional configuration object (e.g. { assetMap })
 * @returns {Object} Canonical Course JSON v2 object
 */
function mapCourseToPackageData(course, options = {}) {
  if (!course) {
    throw new Error("Course object is required for mapping.");
  }

  const rawModules = Array.isArray(course.modules) ? course.modules : [];
  const sortedModules = [...rawModules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return {
    $schema: "https://orangetree.lms/schemas/course-v2.json",
    version: "2.0",
    metadata: mapCourseMetadata(course, options),
    settings: mapCourseSettings(course),
    modules: sortedModules.map((m) => mapModuleToPackageData(m, options)).filter(Boolean)
  };
}

module.exports = {
  mapAssetReference,
  mapContentToPackageData,
  mapTopicToPackageData,
  mapLessonToPackageData,
  mapModuleToPackageData,
  mapCourseMetadata,
  mapCourseSettings,
  mapCourseToPackageData
};
