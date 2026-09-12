const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const {
  collectCourseAssets,
  classifyAssetUrl,
  resolveLocalPath,
  generatePackagePath,
  isSafelyContained
} = require("../src/modules/import/collectors/assetCollector");

const {
  mapCourseToPackageData
} = require("../src/modules/import/mappers/courseMapper");

// Mock uploads directory for unit tests
const testUploadsDir = path.join(__dirname, "tmp_test_uploads");

function setupTestEnvironment() {
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

  // Dummy test files
  fs.writeFileSync(path.join(thumbsDir, "cover.png"), "dummy thumbnail");
  fs.writeFileSync(path.join(contentsDir, "intro.mp4"), "dummy video content");
  fs.writeFileSync(path.join(contentsDir, "guide.pdf"), "dummy pdf content");
  fs.writeFileSync(path.join(dirA, "sample.mp4"), "sample A content");
  fs.writeFileSync(path.join(dirB, "sample.mp4"), "sample B content");
}

function cleanupTestEnvironment() {
  if (fs.existsSync(testUploadsDir)) {
    fs.rmSync(testUploadsDir, { recursive: true, force: true });
  }
}

test("Asset Collector Layer Tests", async (t) => {
  t.before(() => setupTestEnvironment());
  t.after(() => cleanupTestEnvironment());

  await t.test("1. Course with no assets returns empty assets array and success: true", () => {
    const course = {
      title: "No Asset Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "TEXT", title: "Text only", htmlContent: "<p>Hello</p>" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.assets.length, 0);
    assert.strictEqual(res.externalUrls.length, 0);
    assert.strictEqual(res.missingAssets.length, 0);
  });

  await t.test("2. Collects local thumbnail correctly", () => {
    const course = {
      title: "Thumbnail Course",
      thumbnailUrl: "/uploads/thumbnails/cover.png"
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.assets.length, 1);
    assert.strictEqual(res.assets[0].type, "thumbnail");
    assert.strictEqual(res.assets[0].packagePath, "cover.png");
    assert.strictEqual(res.assets[0].sourcePath, path.normalize(path.join(testUploadsDir, "thumbnails/cover.png")));
  });

  await t.test("3. Collects local content asset correctly", () => {
    const course = {
      title: "Video Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "VIDEO", videoUrl: "/uploads/contents/intro.mp4" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.assets.length, 1);
    assert.strictEqual(res.assets[0].type, "content");
    assert.strictEqual(res.assets[0].packagePath, "contents/intro.mp4");
  });

  await t.test("4. External video URL is classified and collected in externalUrls", () => {
    const course = {
      title: "YT Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "VIDEO", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.assets.length, 0);
    assert.strictEqual(res.externalUrls.length, 1);
    assert.strictEqual(res.externalUrls[0], "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  await t.test("5. External link URL is collected in externalUrls", () => {
    const course = {
      title: "External Link Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "LINK", externalUrl: "https://example.com/doc.pdf" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.externalUrls.length, 1);
    assert.strictEqual(res.externalUrls[0], "https://example.com/doc.pdf");
  });

  await t.test("6. Missing local file records missingAssets and sets success: false", () => {
    const course = {
      title: "Missing File Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "PDF", fileUrl: "/uploads/contents/non_existent.pdf" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.missingAssets.length, 1);
    assert.strictEqual(res.missingAssets[0].rawUrl, "/uploads/contents/non_existent.pdf");
    assert.ok(res.missingAssets[0].expectedPath.endsWith("non_existent.pdf"));
  });

  await t.test("7. Duplicate references to same physical asset are deduplicated", () => {
    const course = {
      title: "Dedupe Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "VIDEO", videoUrl: "/uploads/contents/intro.mp4" },
                    { type: "VIDEO", videoUrl: "/uploads/contents/intro.mp4" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.assets.length, 1);
    assert.strictEqual(res.assets[0].packagePath, "contents/intro.mp4");
  });

  await t.test("8. Collision protection handles identical filenames from different source directories", () => {
    const course = {
      title: "Collision Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "VIDEO", videoUrl: "/uploads/dirA/sample.mp4" },
                    { type: "VIDEO", videoUrl: "/uploads/dirB/sample.mp4" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.assets.length, 2);
    assert.strictEqual(res.assets[0].packagePath, "contents/sample.mp4");
    assert.strictEqual(res.assets[1].packagePath, "contents/sample_1.mp4");
  });

  await t.test("9. Path traversal attempt via ../ fails collection with security error", () => {
    const course = {
      title: "Traversal Course",
      thumbnailUrl: "/uploads/../../etc/passwd"
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors.length, 1);
    assert.ok(res.errors[0].includes("Security error"));
  });

  await t.test("10. Absolute Unix path attempt fails collection", () => {
    const course = {
      title: "Unix Absolute Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "FILE", fileUrl: "/etc/passwd" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, false);
  });

  await t.test("11. Windows drive letter path attempt fails classification / containment", () => {
    const classWin = classifyAssetUrl("C:\\Windows\\System32\\cmd.exe");
    assert.strictEqual(classWin.isTraversalAttempt, true);

    const course = {
      title: "Windows Path Course",
      thumbnailUrl: "C:\\Windows\\System32\\cmd.exe"
    };
    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, false);
  });

  await t.test("12. Collects multiple asset types (thumbnail, video, pdf) simultaneously", () => {
    const course = {
      title: "Multi-Asset Course",
      thumbnailUrl: "/uploads/thumbnails/cover.png",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "VIDEO", videoUrl: "/uploads/contents/intro.mp4" },
                    { type: "PDF", fileUrl: "/uploads/contents/guide.pdf" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.assets.length, 3);

    const packagePaths = res.assets.map(a => a.packagePath);
    assert.ok(packagePaths.includes("cover.png"));
    assert.ok(packagePaths.includes("contents/intro.mp4"));
    assert.ok(packagePaths.includes("contents/guide.pdf"));
  });

  await t.test("13. Content.data remains untouched and is ignored for local file resolution", () => {
    const course = {
      title: "Data Payload Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "CODING_EXERCISE", data: { testCases: ["/uploads/not_a_real_asset"] } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.assets.length, 0);
  });

  await t.test("14. Correctly separates mixed local and external assets", () => {
    const course = {
      title: "Mixed Asset Course",
      thumbnailUrl: "/uploads/thumbnails/cover.png",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "VIDEO", videoUrl: "/uploads/contents/intro.mp4" },
                    { type: "VIDEO", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.assets.length, 2); // thumbnail + local video
    assert.strictEqual(res.externalUrls.length, 1);
    assert.strictEqual(res.externalUrls[0], "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  await t.test("15. Generates deterministic POSIX-style package paths", () => {
    const usedPaths = new Set();
    const p1 = generatePackagePath("/uploads/contents/demo.mp4", "content", usedPaths);
    const p2 = generatePackagePath("/uploads/contents/demo.mp4", "content", usedPaths);
    const thumbP = generatePackagePath("/uploads/thumbnails/cover.png", "thumbnail", usedPaths);

    assert.strictEqual(p1, "contents/demo.mp4");
    assert.strictEqual(p2, "contents/demo_1.mp4");
    assert.strictEqual(thumbP, "cover.png");
    assert.ok(!p1.includes("\\"));
  });

  await t.test("16. Integration: Asset Collector assetMap passed to Course Mapper guarantees JSON reference consistency during filename collisions", () => {
    const course = {
      title: "Collision Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { id: "c1", type: "VIDEO", videoUrl: "/uploads/dirA/sample.mp4" },
                    { id: "c2", type: "VIDEO", videoUrl: "/uploads/dirB/sample.mp4" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    // 1. Run Asset Collector
    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    assert.strictEqual(collection.success, true);
    assert.strictEqual(collection.assets[0].packagePath, "contents/sample.mp4");
    assert.strictEqual(collection.assets[1].packagePath, "contents/sample_1.mp4");

    // 2. Run Course Mapper WITH collection.assetMap
    const mapped = mapCourseToPackageData(course, { assetMap: collection.assetMap });
    const contents = mapped.modules[0].lessons[0].topics[0].contents;

    // 3. Verify JSON references match physical collected asset package paths 100%
    assert.strictEqual(contents[0].mediaFile, "contents/sample.mp4");
    assert.strictEqual(contents[1].mediaFile, "contents/sample_1.mp4");
  });

});
