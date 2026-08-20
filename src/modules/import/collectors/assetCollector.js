const path = require("path");
const fs = require("fs");

/**
 * Returns the resolved uploads root directory on local disk.
 * e.g., <project-root>/uploads
 */
function getUploadsRootDir() {
  return path.resolve(__dirname, "../../../../uploads");
}

/**
 * Validates that a resolved absolute target path is strictly contained within
 * the uploads root directory to prevent path traversal security vulnerabilities.
 * 
 * @param {string} targetPath Absolute target filesystem path
 * @param {string} uploadsDir Absolute uploads root directory
 * @returns {boolean} True if safely contained within uploadsDir
 */
function isSafelyContained(targetPath, uploadsDir = getUploadsRootDir()) {
  const normalizedUploads = path.normalize(uploadsDir) + path.sep;
  const normalizedTarget = path.normalize(targetPath);
  return normalizedTarget.startsWith(normalizedUploads);
}

/**
 * Classifies an asset URL into LOCAL, EXTERNAL, or INVALID.
 * 
 * @param {string|null} url Database URL string
 * @returns {{ isExternal: boolean, isLocal: boolean, rawUrl: string|null }}
 */
function classifyAssetUrl(url) {
  if (!url || typeof url !== "string") {
    return { isExternal: false, isLocal: false, rawUrl: null };
  }

  const trimmed = url.trim();

  // Reject suspicious path traversal attempts immediately
  if (
    trimmed.includes("../") ||
    trimmed.includes("..\\") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\")
  ) {
    return { isExternal: false, isLocal: true, rawUrl: trimmed, isTraversalAttempt: true };
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { isExternal: true, isLocal: false, rawUrl: trimmed };
  }

  return { isExternal: false, isLocal: true, rawUrl: trimmed };
}

/**
 * Resolves a database local upload URL to an absolute filesystem path.
 * 
 * @param {string} rawUrl Database URL (e.g. "/uploads/contents/video.mp4")
 * @param {string} uploadsDir Absolute uploads root directory
 * @returns {{ absolutePath: string, isValid: boolean, error?: string }}
 */
function resolveLocalPath(rawUrl, uploadsDir = getUploadsRootDir()) {
  // Strip leading slash or /uploads/ prefix
  let relativePath = rawUrl.replace(/\\/g, "/");
  if (relativePath.startsWith("/uploads/")) {
    relativePath = relativePath.slice("/uploads/".length);
  } else if (relativePath.startsWith("uploads/")) {
    relativePath = relativePath.slice("uploads/".length);
  } else if (relativePath.startsWith("/")) {
    relativePath = relativePath.slice(1);
  }

  const resolvedPath = path.resolve(uploadsDir, relativePath);

  if (!isSafelyContained(resolvedPath, uploadsDir)) {
    return {
      absolutePath: resolvedPath,
      isValid: false,
      error: `Path traversal attempt detected: ${rawUrl}`
    };
  }

  return {
    absolutePath: resolvedPath,
    isValid: true
  };
}

/**
 * Generates POSIX-compliant package path for an asset.
 * Handles filename collisions by appending sequential index when needed.
 * 
 * @param {string} rawUrl Database URL
 * @param {string} assetType Asset category ("thumbnail" | "content")
 * @param {Set<string>} usedPackagePaths Set of package paths already assigned
 * @returns {string} POSIX relative package path (e.g. "thumbnail.png" or "contents/video.mp4")
 */
function generatePackagePath(rawUrl, assetType, usedPackagePaths) {
  const filename = path.basename(rawUrl.trim());

  if (assetType === "thumbnail") {
    let candidate = filename;
    if (usedPackagePaths.has(candidate)) {
      const ext = path.extname(filename);
      const name = path.basename(filename, ext);
      let counter = 1;
      while (usedPackagePaths.has(`${name}_${counter}${ext}`)) {
        counter++;
      }
      candidate = `${name}_${counter}${ext}`;
    }
    usedPackagePaths.add(candidate);
    return candidate;
  }

  // Content asset
  let candidate = `contents/${filename}`;
  if (usedPackagePaths.has(candidate)) {
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    let counter = 1;
    while (usedPackagePaths.has(`contents/${name}_${counter}${ext}`)) {
      counter++;
    }
    candidate = `contents/${name}_${counter}${ext}`;
  }
  usedPackagePaths.add(candidate);
  return candidate;
}

/**
 * Collects all physical local filesystem assets required by a course.
 * Also returns an authoritative urlMap (Map<rawUrl, packagePath>) to guarantee
 * 100% reference consistency with courseMapper.js when collisions occur.
 * 
 * @param {Object} course Full 5-layer course database object
 * @param {Object} options Optional config overrides (e.g. uploadsDir for testing)
 * @returns {{
 *   success: boolean,
 *   assets: Array<{ sourcePath: string, packagePath: string, type: string }>,
 *   externalUrls: Array<string>,
 *   missingAssets: Array<{ rawUrl: string, expectedPath: string, reason: string, context?: string }>,
 *   errors: Array<string>,
 *   assetMap: Map<string, string>
 * }}
 */
function collectCourseAssets(course, options = {}) {
  const uploadsDir = options.uploadsDir || getUploadsRootDir();

  const collectedAssetsMap = new Map(); // Key: normalized absolute source path -> Asset Object
  const urlToPackagePathMap = new Map(); // Key: rawUrl -> packagePath
  const externalUrlsSet = new Set();
  const missingAssets = [];
  const errors = [];
  const usedPackagePaths = new Set();

  if (!course) {
    return {
      success: false,
      assets: [],
      externalUrls: [],
      missingAssets: [],
      errors: [],
      assetMap: urlToPackagePathMap
    };
  }

  // 1. Process Thumbnail
  if (course.thumbnailUrl) {
    const classification = classifyAssetUrl(course.thumbnailUrl);

    if (classification.isTraversalAttempt) {
      errors.push(`Security error: Path traversal attempt in course thumbnail: ${course.thumbnailUrl}`);
    } else if (classification.isExternal) {
      externalUrlsSet.add(classification.rawUrl);
    } else if (classification.isLocal) {
      const resolved = resolveLocalPath(classification.rawUrl, uploadsDir);
      if (!resolved.isValid) {
        errors.push(`Security error: ${resolved.error}`);
      } else {
        const normPath = path.normalize(resolved.absolutePath);
        if (!fs.existsSync(normPath)) {
          missingAssets.push({
            rawUrl: classification.rawUrl,
            expectedPath: normPath,
            reason: "Thumbnail file does not exist on disk",
            context: "Course.thumbnailUrl"
          });
        } else {
          if (!collectedAssetsMap.has(normPath)) {
            const pkgPath = generatePackagePath(classification.rawUrl, "thumbnail", usedPackagePaths);
            collectedAssetsMap.set(normPath, {
              sourcePath: normPath,
              packagePath: pkgPath,
              type: "thumbnail"
            });
          }
          const assignedAsset = collectedAssetsMap.get(normPath);
          urlToPackagePathMap.set(course.thumbnailUrl, assignedAsset.packagePath);
        }
      }
    }
  }

  // Helper to process content URLs
  const processContentUrl = (url, contentTitle, contextLabel) => {
    if (!url) return;

    const classification = classifyAssetUrl(url);

    if (classification.isTraversalAttempt) {
      errors.push(`Security error: Path traversal attempt in ${contextLabel}: ${url}`);
      return;
    }

    if (classification.isExternal) {
      externalUrlsSet.add(classification.rawUrl);
      return;
    }

    if (classification.isLocal) {
      const resolved = resolveLocalPath(classification.rawUrl, uploadsDir);
      if (!resolved.isValid) {
        errors.push(`Security error: ${resolved.error}`);
        return;
      }

      const normPath = path.normalize(resolved.absolutePath);
      if (!fs.existsSync(normPath)) {
        missingAssets.push({
          rawUrl: classification.rawUrl,
          expectedPath: normPath,
          reason: "Content asset file does not exist on disk",
          context: `${contextLabel} (${contentTitle || "Untitled"})`
        });
      } else {
        if (!collectedAssetsMap.has(normPath)) {
          const pkgPath = generatePackagePath(classification.rawUrl, "content", usedPackagePaths);
          collectedAssetsMap.set(normPath, {
            sourcePath: normPath,
            packagePath: pkgPath,
            type: "content"
          });
        }
        const assignedAsset = collectedAssetsMap.get(normPath);
        urlToPackagePathMap.set(url, assignedAsset.packagePath);
      }
    }
  };

  // 2. Traverse 5-layer content hierarchy
  const modules = Array.isArray(course.modules) ? course.modules : [];
  for (const moduleObj of modules) {
    const lessons = Array.isArray(moduleObj.lessons) ? moduleObj.lessons : [];
    for (const lesson of lessons) {
      const topics = Array.isArray(lesson.topics) ? lesson.topics : [];
      for (const topic of topics) {
        const contents = Array.isArray(topic.contents) ? topic.contents : [];
        for (const content of contents) {
          if (!content) continue;

          // Check videoUrl
          if (content.videoUrl) {
            processContentUrl(content.videoUrl, content.title, "Content.videoUrl");
          }

          // Check fileUrl
          if (content.fileUrl) {
            processContentUrl(content.fileUrl, content.title, "Content.fileUrl");
          }

          // Check externalUrl
          if (content.externalUrl) {
            processContentUrl(content.externalUrl, content.title, "Content.externalUrl");
          }
        }
      }
    }
  }

  const hasFailures = errors.length > 0 || missingAssets.length > 0;

  return {
    success: !hasFailures,
    assets: Array.from(collectedAssetsMap.values()),
    externalUrls: Array.from(externalUrlsSet),
    missingAssets,
    errors,
    assetMap: urlToPackagePathMap
  };
}

module.exports = {
  getUploadsRootDir,
  isSafelyContained,
  classifyAssetUrl,
  resolveLocalPath,
  generatePackagePath,
  collectCourseAssets
};
