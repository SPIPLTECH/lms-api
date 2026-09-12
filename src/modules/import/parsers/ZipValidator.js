const AdmZip = require("adm-zip");
const path = require("path");
const ManifestParser = require("./ManifestParser");
const MarkdownParser = require("./MarkdownParser");

class ZipValidator {
  // Legacy path: caller already extracted entries and only wants to know
  // whether a course.json manifest exists at the package root.
  static validateEntries(zipEntries) {
    const errors = [];
    const entryNames = zipEntries.map((e) => e.entryName);

    const rootManifest = entryNames.find(
      (name) => name === "course.json" || name.endsWith("/course.json")
    );

    if (!rootManifest) {
      errors.push({
        file: "course.json",
        error: "Missing required 'course.json' manifest at zip root.",
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      manifestPath: rootManifest || null,
    };
  }

  // Full path: takes the raw uploaded ZIP buffer, aggregates every
  // structural problem it can find (never stops at the first error), and
  // returns preview data describing the package's course/module/lesson tree.
  // (Synchronous — AdmZip's API is synchronous — but callers may still
  // `await` the result since awaiting a non-promise is a no-op.)
  static validate(fileBuffer) {
    if (!Buffer.isBuffer(fileBuffer)) {
      return this.validateEntries(fileBuffer);
    }

    const errors = [];
    let zip;
    try {
      zip = new AdmZip(fileBuffer);
    } catch (err) {
      return {
        valid: false,
        errors: [{ code: "CORRUPT_ZIP", message: "Failed to unpack file. Corrupted or invalid ZIP archive." }],
        previewData: null,
      };
    }

    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    const entryNames = entries.map((e) => e.entryName);

    const manifestPath = entryNames.find(
      (name) => name === "course.json" || name.endsWith("/course.json")
    );

    if (!manifestPath) {
      return {
        valid: false,
        errors: [{ code: "MISSING_MANIFEST", message: "Missing required 'course.json' manifest at zip root." }],
        previewData: null,
      };
    }

    let manifest;
    try {
      manifest = ManifestParser.parse(zip.getEntry(manifestPath).getData());
    } catch (err) {
      return {
        valid: false,
        errors: [{ code: "INVALID_MANIFEST", message: err.message }],
        previewData: null,
      };
    }

    if (manifest.thumbnail) {
      const found = entryNames.some((name) => name.endsWith(manifest.thumbnail));
      if (!found) {
        errors.push({
          code: "MISSING_THUMBNAIL",
          message: `Thumbnail file "${manifest.thumbnail}" referenced in course.json but not found in package.`,
        });
      }
    }

    const previewModules = [];
    let totalLessons = 0;

    for (const mod of manifest.modules) {
      if (!mod.folder) {
        previewModules.push({ title: mod.title, folder: null, lessonsCount: (mod.lessons || []).length });
        totalLessons += (mod.lessons || []).length;
        continue;
      }

      const folderPrefix = `${mod.folder}/`;
      const folderEntries = entries.filter((e) => e.entryName.startsWith(folderPrefix));

      if (folderEntries.length === 0) {
        errors.push({
          code: "MISSING_MODULE_FOLDER",
          message: `Module "${mod.title}" references folder "${mod.folder}" but it was not found in package.`,
        });
        previewModules.push({ title: mod.title, folder: mod.folder, lessonsCount: 0 });
        continue;
      }

      const lessonEntries = folderEntries
        .filter((e) => e.entryName.toLowerCase().endsWith(".md"))
        .sort((a, b) => a.entryName.localeCompare(b.entryName));

      const seenTitles = new Map();
      for (const lessonEntry of lessonEntries) {
        const { title: lessonTitle, blocks } = MarkdownParser.parse(lessonEntry.getData().toString("utf-8"));
        const normalizedTitle = (lessonTitle || path.basename(lessonEntry.entryName)).trim().toLowerCase();

        if (seenTitles.has(normalizedTitle)) {
          errors.push({
            code: "DUPLICATE_LESSON_TITLE",
            message: `Duplicate lesson title "${lessonTitle}" found in module "${mod.title}" (both "${seenTitles.get(normalizedTitle)}" and "${lessonEntry.entryName}").`,
          });
        } else {
          seenTitles.set(normalizedTitle, lessonEntry.entryName);
        }

        for (const block of blocks) {
          const mediaRef = block.heading && /video|pdf|image/i.test(block.heading) ? block.content.trim() : null;
          if (mediaRef && !entryNames.some((name) => name.endsWith(mediaRef))) {
            errors.push({
              code: "MISSING_MEDIA_FILE",
              message: `Referenced media file "${mediaRef}" (from lesson "${lessonTitle}") not found in package.`,
            });
          }
        }
      }

      previewModules.push({ title: mod.title, folder: mod.folder, lessonsCount: lessonEntries.length });
      totalLessons += lessonEntries.length;
    }

    return {
      valid: errors.length === 0,
      errors,
      previewData: {
        course: {
          title: manifest.title,
          description: manifest.description,
          category: manifest.category,
          level: manifest.level,
          price: manifest.price,
        },
        modules: previewModules,
        stats: {
          modulesCount: previewModules.length,
          lessonsCount: totalLessons,
        },
      },
      manifest,
      manifestPath,
      totalEntries: entries.length,
    };
  }
}

module.exports = ZipValidator;
