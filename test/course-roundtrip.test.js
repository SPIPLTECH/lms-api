const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const prisma = require("../src/config/database");
const courseService = require("../src/modules/courses/course.service");
const courseImporter = require("../src/modules/course-import/services/courseImporter.service");
const assetCollector = require("../src/modules/import/collectors/assetCollector");

const testUploadsDir = path.join(__dirname, "tmp_roundtrip_uploads");

function setupRoundtripEnv() {
  if (!fs.existsSync(testUploadsDir)) {
    fs.mkdirSync(testUploadsDir, { recursive: true });
  }
  const thumbsDir = path.join(testUploadsDir, "thumbnails");
  const contentsDir = path.join(testUploadsDir, "contents");

  fs.mkdirSync(thumbsDir, { recursive: true });
  fs.mkdirSync(contentsDir, { recursive: true });

  fs.writeFileSync(path.join(thumbsDir, "roundtrip_cover.png"), "cover data");
  fs.writeFileSync(path.join(contentsDir, "roundtrip_video.mp4"), "video data");
}

function cleanupRoundtripEnv() {
  if (fs.existsSync(testUploadsDir)) {
    fs.rmSync(testUploadsDir, { recursive: true, force: true });
  }
}

test("Full Course Round-Trip Integration Test (Export -> Import V2)", async (t) => {
  t.before(() => setupRoundtripEnv());
  t.after(() => cleanupRoundtripEnv());

  await t.test("Full Round-Trip: Existing LMS Course -> Export Package -> V2 Import -> New LMS Course", async () => {
    const instructorId = "user_roundtrip_instructor";

    // 0. Ensure Instructor User exists
    await prisma.user.upsert({
      where: { id: instructorId },
      update: {},
      create: {
        id: instructorId,
        email: "roundtrip@test.com",
        name: "Roundtrip Instructor",
        role: "INSTRUCTOR",
        password: "hash"
      }
    });

    // 1. Create Source Course directly in DB
    const sourceCourse = await prisma.course.create({
      data: {
        title: "Full Stack Architecture Mastery",
        description: "<p>Comprehensive Course</p>",
        category: "Software Engineering",
        level: "ADVANCED",
        thumbnailUrl: "/uploads/thumbnails/roundtrip_cover.png",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        language: "English",
        tags: ["Architecture", "System Design"],
        estimatedLearningHours: 40,
        certificatesEnabled: true,
        discussionEnabled: true,
        dripContentEnabled: false,
        creatorId: instructorId,
        modules: {
          create: [
            {
              title: "Module 1: System Design",
              description: "System Design Foundations",
              order: 1,
              isPublished: true,
              lessons: {
                create: [
                  {
                    title: "Lesson 1: Scalability",
                    description: "High Availability Patterns",
                    order: 1,
                    isPublished: true,
                    topics: {
                      create: [
                        {
                          title: "Topic 1.1: Load Balancing",
                          description: "L4 vs L7 Balancers",
                          order: 1,
                          isPublished: true,
                          contents: {
                            create: [
                              {
                                type: "VIDEO",
                                title: "Load Balancers Deep Dive",
                                order: 1,
                                duration: 600,
                                videoUrl: "/uploads/contents/roundtrip_video.mp4"
                              },
                              {
                                type: "LINK",
                                title: "System Design Primer",
                                order: 2,
                                externalUrl: "https://github.com/donnemartin/system-design-primer"
                              },
                              {
                                type: "TEXT",
                                title: "Summary & Notes",
                                order: 3,
                                htmlContent: "<h3>Key Takeaways</h3>",
                                data: { quizLink: { id: "q123" } }
                              }
                            ]
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    });

    // Override assetCollector uploadsDir for test execution
    const originalCollect = assetCollector.collectCourseAssets;
    assetCollector.collectCourseAssets = (course) => originalCollect(course, { uploadsDir: testUploadsDir });

    let exportResult;
    try {
      // 2. EXPORT: Run completed Phase 8 Course Export
      exportResult = await courseService.exportCourse(sourceCourse.id);
      assert.strictEqual(exportResult.success, true);
      assert.ok(fs.existsSync(exportResult.filePath));

      // 3. IMPORT STEP A: Create Import Job with exported ZIP package
      const job = await courseImporter.createJob({
        instructorId,
        sourceFileName: exportResult.filename,
        zipFilePath: exportResult.filePath
      });
      assert.strictEqual(job.status, "UPLOADED");

      // 4. IMPORT STEP B: Process Job (Detects V2 package, prepares assets, validates canonical JSON)
      const processedJob = await courseImporter.processJob(job.id, "http://localhost:5000");
      assert.strictEqual(processedJob.status, "READY");
      assert.strictEqual(processedJob.canonicalJson.version, "2.0");

      // 5. IMPORT STEP C: Import Job into DB using V2 Importer
      const importedCourse = await courseImporter.importJob(job.id, instructorId);
      assert.ok(importedCourse.id);
      assert.notStrictEqual(importedCourse.id, sourceCourse.id); // New ID generated!

      // 6. FETCH FULL IMPORTED COURSE HIERARCHY FROM DB
      const dbImportedCourse = await prisma.course.findUnique({
        where: { id: importedCourse.id },
        include: {
          modules: {
            orderBy: { order: "asc" },
            include: {
              lessons: {
                orderBy: { order: "asc" },
                include: {
                  topics: {
                    orderBy: { order: "asc" },
                    include: {
                      contents: {
                        orderBy: { order: "asc" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });

      // =====================================
      // ROUND-TRIP EQUIVALENCE COMPARISONS
      // =====================================

      // Course Level
      assert.strictEqual(dbImportedCourse.title, sourceCourse.title);
      assert.strictEqual(dbImportedCourse.description, sourceCourse.description);
      assert.strictEqual(dbImportedCourse.category, sourceCourse.category);
      assert.strictEqual(dbImportedCourse.level, sourceCourse.level);
      assert.strictEqual(dbImportedCourse.language, sourceCourse.language);
      assert.deepStrictEqual(dbImportedCourse.tags, sourceCourse.tags);
      assert.strictEqual(dbImportedCourse.estimatedLearningHours, sourceCourse.estimatedLearningHours);

      // Settings
      assert.strictEqual(dbImportedCourse.visibility, sourceCourse.visibility);
      assert.strictEqual(dbImportedCourse.certificatesEnabled, sourceCourse.certificatesEnabled);
      assert.strictEqual(dbImportedCourse.discussionEnabled, sourceCourse.discussionEnabled);
      assert.strictEqual(dbImportedCourse.dripContentEnabled, sourceCourse.dripContentEnabled);

      // Status (Imported courses start as DRAFT per LMS convention)
      assert.strictEqual(dbImportedCourse.status, "DRAFT");

      // Module Level
      assert.strictEqual(dbImportedCourse.modules.length, 1);
      const mod = dbImportedCourse.modules[0];
      assert.strictEqual(mod.title, "Module 1: System Design");
      assert.strictEqual(mod.description, "System Design Foundations");
      assert.strictEqual(mod.order, 1);
      assert.strictEqual(mod.isPublished, true);

      // Lesson Level
      assert.strictEqual(mod.lessons.length, 1);
      const les = mod.lessons[0];
      assert.strictEqual(les.title, "Lesson 1: Scalability");
      assert.strictEqual(les.description, "High Availability Patterns");
      assert.strictEqual(les.order, 1);
      assert.strictEqual(les.isPublished, true);

      // Topic Level (Verifies real Topic preserved; NO "General" topic injection!)
      assert.strictEqual(les.topics.length, 1);
      const top = les.topics[0];
      assert.strictEqual(top.title, "Topic 1.1: Load Balancing");
      assert.strictEqual(top.description, "L4 vs L7 Balancers");
      assert.strictEqual(top.order, 1);
      assert.strictEqual(top.isPublished, true);

      // Content Level
      assert.strictEqual(top.contents.length, 3);

      const cnt1 = top.contents[0];
      assert.strictEqual(cnt1.type, "VIDEO");
      assert.strictEqual(cnt1.title, "Load Balancers Deep Dive");
      assert.strictEqual(cnt1.order, 1);
      assert.strictEqual(cnt1.duration, 600);
      assert.ok(cnt1.videoUrl.startsWith("/uploads/contents/"));

      const cnt2 = top.contents[1];
      assert.strictEqual(cnt2.type, "LINK");
      assert.strictEqual(cnt2.title, "System Design Primer");
      assert.strictEqual(cnt2.order, 2);
      assert.strictEqual(cnt2.externalUrl, "https://github.com/donnemartin/system-design-primer");

      const cnt3 = top.contents[2];
      assert.strictEqual(cnt3.type, "TEXT");
      assert.strictEqual(cnt3.title, "Summary & Notes");
      assert.strictEqual(cnt3.order, 3);
      assert.strictEqual(cnt3.htmlContent, "<h3>Key Takeaways</h3>");
      assert.deepStrictEqual(cnt3.data, { quizLink: { id: "q123" } });

      // Clean up imported course and job
      await prisma.course.delete({ where: { id: dbImportedCourse.id } });
      await courseImporter.deleteJob(job.id);
    } finally {
      assetCollector.collectCourseAssets = originalCollect;
      // Clean up source course
      await prisma.course.delete({ where: { id: sourceCourse.id } });
    }
  });

});
