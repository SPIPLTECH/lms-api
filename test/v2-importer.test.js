const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const v2Importer = require("../src/modules/course-import/services/v2PackageImporter.service");
const prisma = require("../src/config/database");

const testJobDir = path.join(__dirname, "tmp_v2_job");

function setupV2TestEnv() {
  if (!fs.existsSync(testJobDir)) {
    fs.mkdirSync(testJobDir, { recursive: true });
  }
  const contentsDir = path.join(testJobDir, "contents");
  if (!fs.existsSync(contentsDir)) {
    fs.mkdirSync(contentsDir, { recursive: true });
  }

  fs.writeFileSync(path.join(testJobDir, "thumbnail.png"), "test thumb");
  fs.writeFileSync(path.join(contentsDir, "video.mp4"), "test video");
}

function cleanupV2TestEnv() {
  if (fs.existsSync(testJobDir)) {
    fs.rmSync(testJobDir, { recursive: true, force: true });
  }
}

test("V2 Importer Module Tests", async (t) => {
  t.before(() => setupV2TestEnv());
  t.after(() => cleanupV2TestEnv());

  await t.test("1. Valid V2 course.json passes manifest validation", () => {
    const validManifest = {
      $schema: "https://orangetree.lms/schemas/course-v2.json",
      version: "2.0",
      metadata: { title: "Valid Course" },
      settings: { visibility: "PUBLIC" },
      modules: [{ title: "Module 1", lessons: [] }]
    };

    const res = v2Importer.validateV2Manifest(validManifest);
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.errors.length, 0);
  });

  await t.test("1b. Empty modules array fails manifest validation (at least one module required)", () => {
    const emptyModulesManifest = {
      $schema: "https://orangetree.lms/schemas/course-v2.json",
      version: "2.0",
      metadata: { title: "Valid Course" },
      settings: { visibility: "PUBLIC" },
      modules: []
    };

    const res = v2Importer.validateV2Manifest(emptyModulesManifest);
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.some((e) => e.includes("At least one module is required")));
  });

  await t.test("2. Missing course.json metadata.title fails validation", () => {
    const invalidManifest = {
      version: "2.0",
      metadata: {},
      settings: {},
      modules: []
    };

    const res = v2Importer.validateV2Manifest(invalidManifest);
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors[0].includes("metadata.title"));
  });

  await t.test("3. Path traversal in asset package path is caught and rejected", () => {
    const safeCheck = v2Importer.isSafePackagePath("../../etc/passwd");
    assert.strictEqual(safeCheck, false);
  });

  await t.test("4. Process V2 package extracts assets and builds canonicalJson", async () => {
    const rawManifest = {
      $schema: "https://orangetree.lms/schemas/course-v2.json",
      version: "2.0",
      metadata: {
        title: "Test V2 Import",
        thumbnail: "thumbnail.png"
      },
      settings: { visibility: "PUBLIC" },
      modules: [
        {
          title: "Mod 1",
          order: 1,
          lessons: [
            {
              title: "Les 1",
              order: 1,
              topics: [
                {
                  title: "Top 1",
                  order: 1,
                  contents: [
                    { type: "VIDEO", title: "Vid 1", order: 1, mediaFile: "contents/video.mp4" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const result = await v2Importer.processV2Package(testJobDir, "job_123", rawManifest);
    assert.strictEqual(result.canonicalJson.version, "2.0");
    assert.ok(result.canonicalJson.assetMap["thumbnail.png"].startsWith("/uploads/thumbnails/"));
    assert.ok(result.canonicalJson.assetMap["contents/video.mp4"].startsWith("/uploads/contents/"));
  });

  await t.test("5. Import V2 Job creates full 5-layer course in database with explicit topics", async () => {
    const instructorId = "user_test_instructor_v2";

    // Ensure instructor user exists in DB for foreign key constraint
    await prisma.user.upsert({
      where: { id: instructorId },
      update: {},
      create: {
        id: instructorId,
        email: "instructor_v2@test.com",
        name: "Test Instructor",
        role: "INSTRUCTOR",
        password: "hash"
      }
    });

    // Create DB CourseImportJob record first
    const dbJob = await prisma.courseImportJob.create({
      data: {
        instructorId,
        sourceFileName: "v2_test.zip",
        sourcePath: "course-imports/job_v2_unit",
        status: "READY",
        canonicalJson: {
          version: "2.0",
          $schema: "https://orangetree.lms/schemas/course-v2.json",
          metadata: {
            title: "Database V2 Import Test",
            description: "Full 5 layer test",
            category: "Testing",
            level: "ADVANCED",
            language: "English",
            tags: ["V2", "Test"],
            estimatedLearningHours: 10
          },
          settings: {
            visibility: "PUBLIC",
            certificatesEnabled: true,
            discussionEnabled: true,
            dripContentEnabled: false
          },
          modules: [
            {
              title: "Module Alpha",
              description: "Mod Desc",
              order: 1,
              isPublished: true,
              lessons: [
                {
                  title: "Lesson Beta",
                  description: "Les Desc",
                  order: 1,
                  isPublished: true,
                  topics: [
                    {
                      title: "Explicit Topic Gamma",
                      description: "Top Desc",
                      order: 1,
                      isPublished: true,
                      contents: [
                        {
                          type: "TEXT",
                          title: "Content Delta",
                          order: 1,
                          htmlContent: "<p>V2 Content</p>",
                          data: { customField: 123 }
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
          assetMap: {}
        }
      }
    });

    const createdCourse = await v2Importer.importV2Job(dbJob, instructorId);
    assert.ok(createdCourse.id);
    assert.strictEqual(createdCourse.title, "Database V2 Import Test");

    // Fetch full course hierarchy from DB
    const dbCourse = await prisma.course.findUnique({
      where: { id: createdCourse.id },
      include: {
        modules: {
          include: {
            lessons: {
              include: {
                topics: {
                  include: { contents: true }
                }
              }
            }
          }
        }
      }
    });

    // Verify 5-layer hierarchy in DB
    assert.strictEqual(dbCourse.modules.length, 1);
    assert.strictEqual(dbCourse.modules[0].title, "Module Alpha");

    assert.strictEqual(dbCourse.modules[0].lessons.length, 1);
    assert.strictEqual(dbCourse.modules[0].lessons[0].title, "Lesson Beta");

    // Verify Explicit Topic (NO hardcoded "General" topic!)
    assert.strictEqual(dbCourse.modules[0].lessons[0].topics.length, 1);
    assert.strictEqual(dbCourse.modules[0].lessons[0].topics[0].title, "Explicit Topic Gamma");
    assert.notStrictEqual(dbCourse.modules[0].lessons[0].topics[0].title, "General");

    // Verify Content
    const cnt = dbCourse.modules[0].lessons[0].topics[0].contents[0];
    assert.strictEqual(cnt.type, "TEXT");
    assert.strictEqual(cnt.title, "Content Delta");
    assert.strictEqual(cnt.htmlContent, "<p>V2 Content</p>");
    assert.deepStrictEqual(cnt.data, { customField: 123 });

    // Clean up created test course and job from DB
    await prisma.course.delete({ where: { id: createdCourse.id } });
    await prisma.courseImportJob.delete({ where: { id: dbJob.id } });
  });

  await t.test("6. importV2Job runs its Prisma transaction with explicit maxWait/timeout, not the 5000ms default", async () => {
    const instructorId = "user_test_instructor_v2";

    const originalTransaction = prisma.$transaction.bind(prisma);
    let capturedOptions = null;
    prisma.$transaction = (fn, options) => {
      capturedOptions = options;
      return originalTransaction(fn, options);
    };

    let dbJob;
    try {
      dbJob = await prisma.courseImportJob.create({
        data: {
          instructorId,
          sourceFileName: "v2_timeout_config_test.zip",
          sourcePath: "course-imports/job_v2_timeout_cfg",
          status: "READY",
          canonicalJson: {
            version: "2.0",
            metadata: { title: "Timeout Config Test" },
            settings: {},
            modules: [],
            assetMap: {}
          }
        }
      });

      const createdCourse = await v2Importer.importV2Job(dbJob, instructorId);

      assert.ok(capturedOptions, "prisma.$transaction must be called with an explicit options object");
      assert.strictEqual(capturedOptions.maxWait, 20000);
      assert.strictEqual(capturedOptions.timeout, 60000);

      await prisma.course.delete({ where: { id: createdCourse.id } });
    } finally {
      prisma.$transaction = originalTransaction;
      if (dbJob) await prisma.courseImportJob.delete({ where: { id: dbJob.id } }).catch(() => {});
    }
  });

  await t.test("7. Realistic large hierarchy (multiple modules/lessons/topics/contents) imports correctly and quickly", async () => {
    const instructorId = "user_test_instructor_v2";

    const MODULE_COUNT = 6;
    const LESSONS_PER_MODULE = 5;
    const TOPICS_PER_LESSON = 4;
    const CONTENTS_PER_TOPIC = 6;

    const assetMap = {
      "contents/lecture.mp4": "/uploads/contents/lecture_abc123.mp4",
      "contents/handout.pdf": "/uploads/contents/handout_def456.pdf"
    };

    const modules = [];
    for (let m = 0; m < MODULE_COUNT; m++) {
      const lessons = [];
      for (let l = 0; l < LESSONS_PER_MODULE; l++) {
        const topics = [];
        for (let tI = 0; tI < TOPICS_PER_LESSON; tI++) {
          const contents = [];
          for (let c = 0; c < CONTENTS_PER_TOPIC; c++) {
            // Rotate content type/asset shape so the realistic mix (media-backed,
            // external-link, and plain html) all get exercised in one import.
            const slot = c % 3;
            if (slot === 0) {
              contents.push({
                type: "VIDEO",
                title: `Video ${m}-${l}-${tI}-${c}`,
                order: c + 1,
                mediaFile: "contents/lecture.mp4",
                duration: 300
              });
            } else if (slot === 1) {
              contents.push({
                type: "PDF",
                title: `Handout ${m}-${l}-${tI}-${c}`,
                order: c + 1,
                mediaFile: "contents/handout.pdf"
              });
            } else {
              contents.push({
                type: "TEXT",
                title: `Notes ${m}-${l}-${tI}-${c}`,
                order: c + 1,
                htmlContent: `<p>Notes block ${m}-${l}-${tI}-${c}</p>`
              });
            }
          }
          topics.push({
            title: `Topic ${m}-${l}-${tI}`,
            order: tI + 1,
            isPublished: true,
            contents
          });
        }
        lessons.push({
          title: `Lesson ${m}-${l}`,
          order: l + 1,
          isPublished: true,
          topics
        });
      }
      modules.push({
        title: `Module ${m}`,
        order: m + 1,
        isPublished: true,
        lessons
      });
    }

    const expectedLessons = MODULE_COUNT * LESSONS_PER_MODULE;
    const expectedTopics = expectedLessons * TOPICS_PER_LESSON;
    const expectedContents = expectedTopics * CONTENTS_PER_TOPIC;

    const dbJob = await prisma.courseImportJob.create({
      data: {
        instructorId,
        sourceFileName: "v2_large_realistic_test.zip",
        sourcePath: "course-imports/job_v2_large",
        status: "READY",
        canonicalJson: {
          version: "2.0",
          $schema: "https://orangetree.lms/schemas/course-v2.json",
          metadata: { title: "Large Realistic V2 Import Benchmark Course" },
          settings: { visibility: "PUBLIC" },
          modules,
          assetMap
        }
      }
    });

    const t0 = Date.now();
    const createdCourse = await v2Importer.importV2Job(dbJob, instructorId);
    const elapsedMs = Date.now() - t0;

    console.log(
      `    [benchmark] modules=${MODULE_COUNT} lessons=${expectedLessons} topics=${expectedTopics} contents=${expectedContents} ` +
      `totalRows=${MODULE_COUNT + expectedLessons + expectedTopics + expectedContents + 1} importV2Job()=${elapsedMs}ms`
    );

    // Well under the old 5000ms default AND the frontend's 15000ms Axios timeout.
    assert.ok(elapsedMs < 15000, `import took ${elapsedMs}ms, expected under the 15000ms frontend timeout budget`);

    const dbCourse = await prisma.course.findUnique({
      where: { id: createdCourse.id },
      include: {
        modules: {
          orderBy: { order: "asc" },
          include: {
            lessons: {
              orderBy: { order: "asc" },
              include: {
                topics: {
                  orderBy: { order: "asc" },
                  include: { contents: { orderBy: { order: "asc" } } }
                }
              }
            }
          }
        }
      }
    });

    // Counts match source exactly — no duplicates, nothing missing.
    assert.strictEqual(dbCourse.modules.length, MODULE_COUNT);
    const totalLessons = dbCourse.modules.reduce((n, m) => n + m.lessons.length, 0);
    const totalTopics = dbCourse.modules.reduce((n, m) => n + m.lessons.reduce((n2, l) => n2 + l.topics.length, 0), 0);
    const totalContents = dbCourse.modules.reduce(
      (n, m) => n + m.lessons.reduce((n2, l) => n2 + l.topics.reduce((n3, tp) => n3 + tp.contents.length, 0), 0),
      0
    );
    assert.strictEqual(totalLessons, expectedLessons);
    assert.strictEqual(totalTopics, expectedTopics);
    assert.strictEqual(totalContents, expectedContents);

    // Also confirm directly against the DB (not just the nested include) — no orphaned/duplicate rows.
    assert.strictEqual(await prisma.module.count({ where: { courseId: createdCourse.id } }), MODULE_COUNT);
    assert.strictEqual(await prisma.lesson.count({ where: { module: { courseId: createdCourse.id } } }), expectedLessons);
    assert.strictEqual(await prisma.topic.count({ where: { lesson: { module: { courseId: createdCourse.id } } } }), expectedTopics);
    assert.strictEqual(await prisma.content.count({ where: { topic: { lesson: { module: { courseId: createdCourse.id } } } } }), expectedContents);

    // Ordering + parent linkage spot-check on the first module/lesson/topic.
    const mod0 = dbCourse.modules[0];
    assert.strictEqual(mod0.title, "Module 0");
    assert.strictEqual(mod0.order, 1);
    assert.strictEqual(mod0.courseId, createdCourse.id);

    const les0 = mod0.lessons[0];
    assert.strictEqual(les0.title, "Lesson 0-0");
    assert.strictEqual(les0.moduleId, mod0.id);

    const top0 = les0.topics[0];
    assert.strictEqual(top0.title, "Topic 0-0-0");
    assert.strictEqual(top0.lessonId, les0.id);

    // Asset mapping preserved for media-backed content (VIDEO -> videoUrl, PDF -> fileUrl).
    const videoContent = top0.contents.find((c) => c.type === "VIDEO");
    assert.strictEqual(videoContent.videoUrl, assetMap["contents/lecture.mp4"]);
    assert.strictEqual(videoContent.fileUrl, null);

    const pdfContent = top0.contents.find((c) => c.type === "PDF");
    assert.strictEqual(pdfContent.fileUrl, assetMap["contents/handout.pdf"]);

    const textContent = top0.contents.find((c) => c.type === "TEXT");
    assert.ok(textContent.htmlContent.includes("Notes block"));
    assert.strictEqual(textContent.videoUrl, null);
    assert.strictEqual(textContent.fileUrl, null);

    // No two Content ids collide, confirming client-generated Module/Lesson/Topic ids
    // and Prisma-generated Content ids didn't produce any accidental duplicates.
    const allContentIds = dbCourse.modules.flatMap((m) =>
      m.lessons.flatMap((l) => l.topics.flatMap((tp) => tp.contents.map((c) => c.id)))
    );
    assert.strictEqual(new Set(allContentIds).size, allContentIds.length);

    await prisma.course.delete({ where: { id: createdCourse.id } });
    await prisma.courseImportJob.delete({ where: { id: dbJob.id } });
  });

  await t.test("8. A constraint violation deep in the hierarchy rolls back the ENTIRE import — no partial Course/Module/Lesson/Topic left behind", async () => {
    const instructorId = "user_test_instructor_v2";
    const uniqueTitle = `Rollback Test Course ${Date.now()}`;

    const dbJob = await prisma.courseImportJob.create({
      data: {
        instructorId,
        sourceFileName: "v2_rollback_test.zip",
        sourcePath: "course-imports/job_v2_rollback",
        status: "READY",
        canonicalJson: {
          version: "2.0",
          metadata: { title: uniqueTitle },
          settings: {},
          modules: [
            {
              title: "Module With Bad Topics",
              order: 1,
              lessons: [
                {
                  title: "Lesson With Duplicate Topic Order",
                  order: 1,
                  topics: [
                    // Same order twice under the same lesson violates
                    // the @@unique([lessonId, order]) constraint on Topic.
                    { title: "Topic A", order: 1, contents: [] },
                    { title: "Topic B", order: 1, contents: [] }
                  ]
                }
              ]
            }
          ],
          assetMap: {}
        }
      }
    });

    await assert.rejects(() => v2Importer.importV2Job(dbJob, instructorId));

    // Nothing from this attempt was committed — atomicity held across all 4 levels.
    const orphanedCourse = await prisma.course.findFirst({ where: { title: uniqueTitle } });
    assert.strictEqual(orphanedCourse, null, "Course must not exist after a failed/rolled-back import");

    const failedJob = await prisma.courseImportJob.findUnique({ where: { id: dbJob.id } });
    assert.strictEqual(failedJob.status, "FAILED");
    assert.strictEqual(failedJob.courseId, null);
    assert.ok(failedJob.errorMessage, "errorMessage should be recorded on failure");

    await prisma.courseImportJob.delete({ where: { id: dbJob.id } });
  });

});
