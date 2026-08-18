const path = require("path");
const fs = require("fs");
const os = require("os");
const AdmZip = require("adm-zip");

/**
 * Validates that a packagePath is safe, relative, and POSIX-compliant.
 * 
 * @param {string} pkgPath Package relative path (e.g. "thumbnail.png" or "contents/video.mp4")
 * @returns {boolean} True if path is safe
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
 * Validates the Canonical Course JSON root contract structure.
 * 
 * @param {Object} courseJson Canonical JSON v2 object
 * @returns {{ isValid: boolean, error?: string }}
 */
function validateCanonicalJsonContract(courseJson) {
  if (!courseJson || typeof courseJson !== "object") {
    return { isValid: false, error: "Canonical course JSON must be an object." };
  }

  if (courseJson.$schema !== "https://orangetree.lms/schemas/course-v2.json") {
    return { isValid: false, error: "Invalid $schema in course JSON." };
  }

  if (courseJson.version !== "2.0") {
    return { isValid: false, error: "Invalid version in course JSON; expected '2.0'." };
  }

  if (!courseJson.metadata || typeof courseJson.metadata !== "object" || !courseJson.metadata.title) {
    return { isValid: false, error: "Missing or invalid metadata.title in course JSON." };
  }

  if (!courseJson.settings || typeof courseJson.settings !== "object") {
    return { isValid: false, error: "Missing or invalid settings in course JSON." };
  }

  if (!Array.isArray(courseJson.modules)) {
    return { isValid: false, error: "Invalid modules in course JSON; expected array." };
  }

  return { isValid: true };
}

/**
 * Extracts all local package asset references from a Canonical Course JSON object.
 * 
 * @param {Object} courseJson Canonical Course JSON object
 * @returns {{ thumbnail: string|null, mediaFiles: Set<string> }}
 */
function extractJsonAssetReferences(courseJson) {
  const mediaFiles = new Set();
  let thumbnail = courseJson.metadata?.thumbnail || null;

  const modules = Array.isArray(courseJson.modules) ? courseJson.modules : [];
  for (const mod of modules) {
    const lessons = Array.isArray(mod.lessons) ? mod.lessons : [];
    for (const les of lessons) {
      const topics = Array.isArray(les.topics) ? les.topics : [];
      for (const top of topics) {
        const contents = Array.isArray(top.contents) ? top.contents : [];
        for (const cnt of contents) {
          if (cnt && cnt.mediaFile) {
            mediaFiles.add(cnt.mediaFile);
          }
        }
      }
    }
  }

  return { thumbnail, mediaFiles };
}

/**
 * Builds a portable Course ZIP package containing course.json and physical local assets.
 * 
 * @param {Object} params Input parameters
 * @param {Object} params.courseJson Canonical Course JSON v2 object
 * @param {Object} params.assetCollection Asset Collector output object
 * @param {Object} [options] Optional config overrides (e.g. outputDir)
 * @returns {{
 *   success: boolean,
 *   filePath?: string,
 *   filename?: string,
 *   totalEntries?: number,
 *   errors?: Array<string>
 * }}
 */
function buildCoursePackage({ courseJson, assetCollection }, options = {}) {
  const errors = [];

  // 1. Validate Canonical JSON Root Structure
  const jsonValidation = validateCanonicalJsonContract(courseJson);
  if (!jsonValidation.isValid) {
    errors.push(`JSON Contract Error: ${jsonValidation.error}`);
  }

  // 2. Validate Asset Collection Output
  if (!assetCollection || typeof assetCollection !== "object") {
    errors.push("Asset Collection Error: Asset collection result is required.");
  } else {
    if (!assetCollection.success) {
      if (Array.isArray(assetCollection.errors) && assetCollection.errors.length > 0) {
        errors.push(...assetCollection.errors);
      }
      if (Array.isArray(assetCollection.missingAssets) && assetCollection.missingAssets.length > 0) {
        assetCollection.missingAssets.forEach((missing) => {
          errors.push(`Missing Asset Error: ${missing.reason} at ${missing.rawUrl}`);
        });
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // 3. Validate ZIP Package Paths & Source File Existence
  const collectedAssets = Array.isArray(assetCollection.assets) ? assetCollection.assets : [];
  const packagePathsSet = new Set();

  for (const asset of collectedAssets) {
    if (!asset.packagePath || !isSafePackagePath(asset.packagePath)) {
      errors.push(`Security Error: Dangerous or invalid package path '${asset.packagePath}'`);
    }

    if (packagePathsSet.has(asset.packagePath)) {
      errors.push(`Collision Error: Duplicate package path detected '${asset.packagePath}'`);
    }
    packagePathsSet.add(asset.packagePath);

    if (!asset.sourcePath || !fs.existsSync(asset.sourcePath)) {
      errors.push(`Source File Error: File does not exist at '${asset.sourcePath}'`);
    }
  }

  // 4. Cross-verify JSON references against collected assets
  const jsonRefs = extractJsonAssetReferences(courseJson);
  if (jsonRefs.thumbnail) {
    if (!packagePathsSet.has(jsonRefs.thumbnail)) {
      errors.push(`Reference Error: course.json metadata.thumbnail '${jsonRefs.thumbnail}' not found in collected assets.`);
    }
  }
  for (const mediaFile of jsonRefs.mediaFiles) {
    if (!packagePathsSet.has(mediaFile)) {
      errors.push(`Reference Error: course.json content.mediaFile '${mediaFile}' not found in collected assets.`);
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // 5. Construct ZIP Package using AdmZip
  const outputDir = options.outputDir || os.tmpdir();
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const safeTitle = (courseJson.metadata.title || "course").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `course-package-${safeTitle}-${timestamp}.zip`;
  const targetZipPath = path.join(outputDir, filename);

  let zip;
  try {
    zip = new AdmZip();

    // Add course.json
    const jsonBuffer = Buffer.from(JSON.stringify(courseJson, null, 2), "utf-8");
    zip.addFile("course.json", jsonBuffer);

    // Add physical local assets
    for (const asset of collectedAssets) {
      const fileBuffer = fs.readFileSync(asset.sourcePath);
      zip.addFile(asset.packagePath, fileBuffer);
    }

    zip.writeZip(targetZipPath);

    return {
      success: true,
      filePath: targetZipPath,
      filename,
      totalEntries: collectedAssets.length + 1
    };
  } catch (err) {
    // Clean up partial zip on failure
    if (fs.existsSync(targetZipPath)) {
      try {
        fs.rmSync(targetZipPath, { force: true });
      } catch (rmErr) {
        // Ignore cleanup error
      }
    }
    return {
      success: false,
      errors: [`ZIP Generation Error: ${err.message}`]
    };
  }
}

module.exports = {
  isSafePackagePath,
  validateCanonicalJsonContract,
  extractJsonAssetReferences,
  buildCoursePackage
};
