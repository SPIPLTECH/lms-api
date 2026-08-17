const AdmZip = require("adm-zip");
const path = require("path");
const prisma = require("../../../config/database");
const ZipValidator = require("../parsers/ZipValidator");
const ManifestParser = require("../parsers/ManifestParser");
const MarkdownParser = require("../parsers/MarkdownParser");
const ContentParser = require("../parsers/ContentParser");
const MediaUploadService = require("./MediaUploadService");

class CourseImportService {
  static async validateZip(fileBuffer) {
    let zip;
    try {
      zip = new AdmZip(fileBuffer);
    } catch (err) {
      return {
        isValid: false,
        errors: [{ file: "ZIP", error: "Failed to unpack file. Corrupted or invalid ZIP archive." }],
      };
    }

    const zipEntries = zip.getEntries();
    const validationResult = ZipValidator.validate(zipEntries);

    if (!validationResult.isValid) {
      return validationResult;
    }

    // Try parsing course.json
    try {
      const manifestEntry = zip.getEntry(validationResult.manifestPath);
      const manifestData = ManifestParser.parse(manifestEntry.getData());
      return {
        isValid: true,
        errors: [],
        manifest: manifestData,
        totalEntries: zipEntries.length,
      };
    } catch (err) {
      return {
        isValid: false,
        errors: [{ file: "course.json", error: err.message }],
      };
    }
  }

  static async importCourse(fileBuffer, instructorId) {
    const zip = new AdmZip(fileBuffer);
    const entries = zip.getEntries();

    const manifestEntry = entries.find(
      (e) => e.entryName === "course.json" || e.entryName.endsWith("/course.json")
    );

    if (!manifestEntry) {
      throw new Error("Missing required 'course.json' at root of ZIP package.");
    }

    const manifest = ManifestParser.parse(manifestEntry.getData());

    // Check for thumbnail image in ZIP
    let thumbnailUrl = null;
    if (manifest.thumbnail) {
      const thumbEntry = entries.find((e) => e.entryName.endsWith(manifest.thumbnail));
      if (thumbEntry) {
        thumbnailUrl = MediaUploadService.saveFile(
          thumbEntry.getData(),
          path.basename(manifest.thumbnail),
          "thumbnails"
        );
      }
    }

    // Perform atomic course creation transaction
    const createdCourse = await prisma.$transaction(async (tx) => {
      // 1. Create Course
      const course = await tx.course.create({
        data: {
          title: manifest.title,
          description: manifest.description,
          category: manifest.category,
          level: manifest.level,
          thumbnailUrl,
          creatorId: instructorId,
          status: "DRAFT",
        },
      });

      // Price lives on the separate Store model, not Course
      await tx.store.create({
        data: {
          courseId: course.id,
          price: manifest.price || 0,
          isFree: !manifest.price,
        },
      });

      // 2. Iterate modules
      const moduleList = manifest.modules && manifest.modules.length > 0
        ? manifest.modules
        : this.autoDetectModulesFromZip(entries);

      for (let mIdx = 0; mIdx < moduleList.length; mIdx++) {
        const modData = moduleList[mIdx];
        const moduleObj = await tx.module.create({
          data: {
            courseId: course.id,
            title: modData.title || `Module ${mIdx + 1}`,
            description: modData.description || "",
            order: mIdx + 1,
          },
        });

        const lessons = modData.lessons || [];
        for (let lIdx = 0; lIdx < lessons.length; lIdx++) {
          const lesData = lessons[lIdx];
          const lessonObj = await tx.lesson.create({
            data: {
              moduleId: moduleObj.id,
              title: lesData.title || `Lesson ${lIdx + 1}`,
              description: lesData.description || "",
              order: lIdx + 1,
            },
          });

          // Check if there is a corresponding markdown file in ZIP
          if (lesData.file) {
            const fileEntry = entries.find((e) => e.entryName.endsWith(lesData.file));
            if (fileEntry) {
              // Imported content has no notion of topics yet, so every lesson
              // gets one default "General" topic to hold its content — same
              // convention the Topic backfill migration used for pre-existing
              // content.
              const topicObj = await tx.topic.create({
                data: {
                  lessonId: lessonObj.id,
                  title: "General",
                  order: 1,
                },
              });

              const fileBuffer = fileEntry.getData();
              const ext = path.extname(lesData.file).toLowerCase();

              if (ext === ".md") {
                const mdText = fileBuffer.toString("utf-8");
                const { body } = MarkdownParser.parseFrontmatter(mdText);
                const { sanitizeContent } = require("../../../utils/sanitizer");

                await tx.content.create({
                  data: {
                    topicId: topicObj.id,
                    title: lesData.title || "Lesson Material",
                    type: "TEXT",
                    htmlContent: sanitizeContent(body),
                    order: 1,
                  },
                });
              } else {
                const savedPath = MediaUploadService.saveFile(
                  fileBuffer,
                  path.basename(lesData.file),
                  "contents"
                );
                const cType = ContentParser.getContentType(lesData.file);

                await tx.content.create({
                  data: {
                    topicId: topicObj.id,
                    title: lesData.title || path.basename(lesData.file),
                    type: cType,
                    ...(cType === "VIDEO" ? { videoUrl: savedPath } : { fileUrl: savedPath }),
                    order: 1,
                  },
                });
              }
            }
          }
        }
      }

      return course;
    }, {
      maxWait: 20000,
      timeout: 60000,
    });

    return createdCourse;
  }

  static autoDetectModulesFromZip(entries) {
    // Auto-detect module directories if course.json modules list is empty
    const modulesMap = new Map();

    entries.forEach((entry) => {
      if (entry.isDirectory) return;
      const parts = entry.entryName.split("/");
      if (parts.length >= 2) {
        const modName = parts[0];
        const fileName = parts.slice(1).join("/");
        if (!modulesMap.has(modName)) {
          modulesMap.set(modName, []);
        }
        if (fileName.endsWith(".md") || fileName.endsWith(".pdf") || fileName.endsWith(".mp4")) {
          modulesMap.get(modName).push({
            title: path.basename(fileName, path.extname(fileName)),
            file: entry.entryName,
          });
        }
      }
    });

    const result = [];
    let idx = 1;
    modulesMap.forEach((lessons, modName) => {
      result.push({
        title: modName.replace(/[-_]/g, " ").toUpperCase(),
        order: idx++,
        lessons,
      });
    });

    return result;
  }
}

module.exports = CourseImportService;
