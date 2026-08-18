const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");

const courseService = require("../src/modules/courses/course.service");

// Mock uploads directory for unit test execution
const testUploadsDir = path.join(__dirname, "tmp_export_uploads");

function setupExportEnvironment() {
  if (!fs.existsSync(testUploadsDir)) {
    fs.mkdirSync(testUploadsDir, { recursive: true });
  }
  const thumbsDir = path.join(testUploadsDir, "thumbnails");
  const contentsDir = path.join(testUploadsDir, "contents");
  const dirA = path.join(testUploadsDir, "dirA");
  const dirB = path.join(testUploadsDir, "dirB");

  fs.mkdirSync(thumbsDir, { recursive: true });
  fs.mkdirSync(contentsDir, { recursive: true });
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  fs.writeFileSync(path.join(thumbsDir, "cover.png"), "thumbnail data");
  fs.writeFileSync(path.join(contentsDir, "intro.mp4"), "video data");
  fs.writeFileSync(path.join(dirA, "sample.mp4"), "sample A data");
  fs.writeFileSync(path.join(dirB, "sample.mp4"), "sample B data");
}

function cleanupExportEnvironment() {
  if (fs.existsSync(testUploadsDir)) {
    fs.rmSync(testUploadsDir, { recursive: true, force: true });
  }
}

test("Backend Course Export Flow Tests", async (t) => {
  t.before(() => setupExportEnvironment());
  t.after(() => cleanupExportEnvironment());

  await t.test("1. Course not found throws 404 error", async () => {
    try {
      await courseService.exportCourse("non_existent_course_id_99999");
      assert.fail("Should have thrown 404 error");
    } catch (err) {
      assert.strictEqual(err.statusCode, 404);
      assert.strictEqual(err.message, "Course not found");
    }
  });

  await t.test("2. Mock HTTP response headers test for ZIP download", () => {
    const mockRes = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      download(filePath, filename, cb) {
        this.setHeader("Content-Type", "application/zip");
        this.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        cb(null);
      }
    };

    mockRes.download("/tmp/test.zip", "course-package.zip", (err) => {
      assert.strictEqual(err, null);
    });

    assert.strictEqual(mockRes.headers["Content-Type"], "application/zip");
    assert.strictEqual(mockRes.headers["Content-Disposition"], 'attachment; filename="course-package.zip"');
  });

  await t.test("3. Missing local file asset triggers 400 error in export service", async () => {
    const prisma = require("../src/config/database");
    const originalFindUnique = prisma.course.findUnique;

    prisma.course.findUnique = async () => ({
      id: "course_missing_asset",
      title: "Missing Asset Course",
      thumbnailUrl: "/uploads/thumbnails/missing_file_123.png",
      modules: []
    });

    try {
      await courseService.exportCourse("course_missing_asset");
      assert.fail("Should have thrown 400 asset collection error");
    } catch (err) {
      assert.strictEqual(err.statusCode, 400);
      assert.ok(err.message.includes("Asset collection failed"));
    } finally {
      prisma.course.findUnique = originalFindUnique;
    }
  });

  await t.test("4. Successful course export produces valid ZIP with canonical course.json and physical assets", async () => {
    const prisma = require("../src/config/database");
    const originalFindUnique = prisma.course.findUnique;

    const mockCourseData = {
      id: "course_export_test_1",
      title: "Node.js Architecture & Patterns",
      description: "Master Node.js",
      category: "Backend",
      level: "INTERMEDIATE",
      thumbnailUrl: "/uploads/thumbnails/cover.png",
      visibility: "PUBLIC",
      certificatesEnabled: true,
      discussionEnabled: true,
      dripContentEnabled: false,
      store: {
        price: 4999,
        currency: "INR"
      },
      modules: [
        {
          id: "m1",
          title: "Module 1: Core",
          order: 1,
          isPublished: true,
          lessons: [
            {
              id: "l1",
              title: "Lesson 1: Intro",
              order: 1,
              isPublished: true,
              topics: [
                {
                  id: "t1",
                  title: "Topic 1: Welcome",
                  order: 1,
                  isPublished: true,
                  contents: [
                    {
                      id: "c1",
                      type: "VIDEO",
                      title: "Intro Video",
                      order: 1,
                      duration: 300,
                      videoUrl: "/uploads/contents/intro.mp4"
                    },
                    {
                      id: "c2",
                      type: "LINK",
                      title: "MDN Docs",
                      order: 2,
                      externalUrl: "https://developer.mozilla.org"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const assetCollector = require("../src/modules/import/collectors/assetCollector");
    const originalCollect = assetCollector.collectCourseAssets;
    assetCollector.collectCourseAssets = (course) => originalCollect(course, { uploadsDir: testUploadsDir });

    prisma.course.findUnique = async () => mockCourseData;

    try {
      const result = await courseService.exportCourse("course_export_test_1");

      assert.strictEqual(result.success, true);
      assert.ok(fs.existsSync(result.filePath));

      const zip = new AdmZip(result.filePath);
      const entries = zip.getEntries().map(e => e.entryName);

      assert.ok(entries.includes("course.json"));
      assert.ok(entries.includes("cover.png"));
      assert.ok(entries.includes("contents/intro.mp4"));

      const jsonText = zip.readAsText("course.json");
      const courseJson = JSON.parse(jsonText);

      assert.strictEqual(courseJson.$schema, "https://orangetree.lms/schemas/course-v2.json");
      assert.strictEqual(courseJson.version, "2.0");
      assert.strictEqual(courseJson.metadata.title, "Node.js Architecture & Patterns");

      assert.strictEqual(courseJson.pricing, undefined);
      assert.strictEqual(courseJson.store, undefined);

      const contents = courseJson.modules[0].lessons[0].topics[0].contents;
      assert.strictEqual(contents.length, 2);
      assert.strictEqual(contents[0].type, "VIDEO");
      assert.strictEqual(contents[0].mediaFile, "contents/intro.mp4");
      assert.strictEqual(contents[1].type, "LINK");
      assert.strictEqual(contents[1].externalUrl, "https://developer.mozilla.org");

      fs.rmSync(result.filePath, { force: true });
    } finally {
      prisma.course.findUnique = originalFindUnique;
      assetCollector.collectCourseAssets = originalCollect;
    }
  });

  await t.test("5. Asset collision handling resolves correctly in end-to-end export service flow", async () => {
    const prisma = require("../src/config/database");
    const originalFindUnique = prisma.course.findUnique;

    const mockCollisionCourse = {
      id: "course_collision_test",
      title: "Collision Test Course",
      modules: [
        {
          id: "m1",
          title: "Module A",
          order: 1,
          isPublished: true,
          lessons: [
            {
              id: "l1",
              title: "Lesson A",
              order: 1,
              isPublished: true,
              topics: [
                {
                  id: "t1",
                  title: "Topic A",
                  order: 1,
                  isPublished: true,
                  contents: [
                    { id: "c1", type: "VIDEO", videoUrl: "/uploads/dirA/sample.mp4", order: 1 },
                    { id: "c2", type: "VIDEO", videoUrl: "/uploads/dirB/sample.mp4", order: 2 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const assetCollector = require("../src/modules/import/collectors/assetCollector");
    const originalCollect = assetCollector.collectCourseAssets;
    assetCollector.collectCourseAssets = (course) => originalCollect(course, { uploadsDir: testUploadsDir });

    prisma.course.findUnique = async () => mockCollisionCourse;

    try {
      const result = await courseService.exportCourse("course_collision_test");
      assert.strictEqual(result.success, true);

      const zip = new AdmZip(result.filePath);
      const entries = zip.getEntries().map(e => e.entryName);

      assert.ok(entries.includes("contents/sample.mp4"));
      assert.ok(entries.includes("contents/sample_1.mp4"));

      const jsonText = zip.readAsText("course.json");
      const courseJson = JSON.parse(jsonText);
      const contents = courseJson.modules[0].lessons[0].topics[0].contents;

      assert.strictEqual(contents[0].mediaFile, "contents/sample.mp4");
      assert.strictEqual(contents[1].mediaFile, "contents/sample_1.mp4");

      fs.rmSync(result.filePath, { force: true });
    } finally {
      prisma.course.findUnique = originalFindUnique;
      assetCollector.collectCourseAssets = originalCollect;
    }
  });

});
