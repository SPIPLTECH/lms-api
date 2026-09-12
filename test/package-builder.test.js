const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const AdmZip = require("adm-zip");

const { mapCourseToPackageData } = require("../src/modules/import/mappers/courseMapper");
const { collectCourseAssets } = require("../src/modules/import/collectors/assetCollector");
const { buildCoursePackage, isSafePackagePath } = require("../src/modules/import/builders/packageBuilder");

const testUploadsDir = path.join(__dirname, "tmp_builder_uploads");
const testOutputDir = path.join(__dirname, "tmp_builder_output");

function setupTestEnvironment() {
  if (!fs.existsSync(testUploadsDir)) {
    fs.mkdirSync(testUploadsDir, { recursive: true });
  }
  if (!fs.existsSync(testOutputDir)) {
    fs.mkdirSync(testOutputDir, { recursive: true });
  }

  const thumbsDir = path.join(testUploadsDir, "thumbnails");
  const contentsDir = path.join(testUploadsDir, "contents");
  const dirA = path.join(testUploadsDir, "dirA");
  const dirB = path.join(testUploadsDir, "dirB");

  fs.mkdirSync(thumbsDir, { recursive: true });
  fs.mkdirSync(contentsDir, { recursive: true });
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  fs.writeFileSync(path.join(thumbsDir, "cover.png"), "thumbnail content");
  fs.writeFileSync(path.join(contentsDir, "intro.mp4"), "video content");
  fs.writeFileSync(path.join(contentsDir, "guide.pdf"), "pdf content");
  fs.writeFileSync(path.join(dirA, "sample.mp4"), "sample A content");
  fs.writeFileSync(path.join(dirB, "sample.mp4"), "sample B content");
}

function cleanupTestEnvironment() {
  if (fs.existsSync(testUploadsDir)) {
    fs.rmSync(testUploadsDir, { recursive: true, force: true });
  }
  if (fs.existsSync(testOutputDir)) {
    fs.rmSync(testOutputDir, { recursive: true, force: true });
  }
}

test("Package Builder Layer Tests", async (t) => {
  t.before(() => setupTestEnvironment());
  t.after(() => cleanupTestEnvironment());

  await t.test("1. Course with no assets produces ZIP with course.json only", () => {
    const course = { title: "No Asset Course", modules: [] };
    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.totalEntries, 1);

    const zip = new AdmZip(result.filePath);
    const entries = zip.getEntries().map(e => e.entryName);
    assert.deepStrictEqual(entries, ["course.json"]);

    const manifestText = zip.readAsText("course.json");
    const parsed = JSON.parse(manifestText);
    assert.strictEqual(parsed.$schema, "https://orangetree.lms/schemas/course-v2.json");
    assert.strictEqual(parsed.version, "2.0");
    assert.strictEqual(parsed.metadata.title, "No Asset Course");

    // Clean up created zip
    fs.rmSync(result.filePath, { force: true });
  });

  await t.test("2. Course with thumbnail produces ZIP with course.json + thumbnail", () => {
    const course = {
      title: "Thumbnail Course",
      thumbnailUrl: "/uploads/thumbnails/cover.png",
      modules: []
    };

    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, true);

    const zip = new AdmZip(result.filePath);
    const entries = zip.getEntries().map(e => e.entryName);
    assert.ok(entries.includes("course.json"));
    assert.ok(entries.includes("cover.png"));

    assert.strictEqual(zip.readAsText("cover.png"), "thumbnail content");

    fs.rmSync(result.filePath, { force: true });
  });

  await t.test("3. Course with content asset produces ZIP with correct contents/... file", () => {
    const course = {
      title: "Content Asset Course",
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

    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, true);

    const zip = new AdmZip(result.filePath);
    const entries = zip.getEntries().map(e => e.entryName);
    assert.ok(entries.includes("contents/intro.mp4"));

    assert.strictEqual(zip.readAsText("contents/intro.mp4"), "video content");

    fs.rmSync(result.filePath, { force: true });
  });

  await t.test("4. Multiple assets are all included in generated ZIP", () => {
    const course = {
      title: "Multi Asset Course",
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

    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, true);

    const zip = new AdmZip(result.filePath);
    const entries = zip.getEntries().map(e => e.entryName);
    assert.strictEqual(entries.length, 4); // course.json + cover.png + contents/intro.mp4 + contents/guide.pdf
    assert.ok(entries.includes("course.json"));
    assert.ok(entries.includes("cover.png"));
    assert.ok(entries.includes("contents/intro.mp4"));
    assert.ok(entries.includes("contents/guide.pdf"));

    fs.rmSync(result.filePath, { force: true });
  });

  await t.test("5. Duplicate asset reference includes physical file ONCE in ZIP", () => {
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

    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, true);

    const zip = new AdmZip(result.filePath);
    const entries = zip.getEntries().map(e => e.entryName);
    assert.strictEqual(entries.length, 2); // course.json + contents/intro.mp4 once
    assert.ok(entries.includes("contents/intro.mp4"));

    fs.rmSync(result.filePath, { force: true });
  });

  await t.test("6. Filename collision includes both uniquely named assets in ZIP", () => {
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

    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, true);

    const zip = new AdmZip(result.filePath);
    const entries = zip.getEntries().map(e => e.entryName);
    assert.ok(entries.includes("contents/sample.mp4"));
    assert.ok(entries.includes("contents/sample_1.mp4"));

    assert.strictEqual(zip.readAsText("contents/sample.mp4"), "sample A content");
    assert.strictEqual(zip.readAsText("contents/sample_1.mp4"), "sample B content");

    fs.rmSync(result.filePath, { force: true });
  });

  await t.test("7. JSON references collision-resolved package paths correctly inside course.json", () => {
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

    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    const zip = new AdmZip(result.filePath);
    const manifestText = zip.readAsText("course.json");
    const parsed = JSON.parse(manifestText);

    const contents = parsed.modules[0].lessons[0].topics[0].contents;
    assert.strictEqual(contents[0].mediaFile, "contents/sample.mp4");
    assert.strictEqual(contents[1].mediaFile, "contents/sample_1.mp4");

    fs.rmSync(result.filePath, { force: true });
  });

  await t.test("8. External URLs are not downloaded and do not create extra ZIP entries", () => {
    const course = {
      title: "External Video Course",
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

    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, true);

    const zip = new AdmZip(result.filePath);
    const entries = zip.getEntries().map(e => e.entryName);
    assert.deepStrictEqual(entries, ["course.json"]);

    const manifestText = zip.readAsText("course.json");
    const parsed = JSON.parse(manifestText);
    const content = parsed.modules[0].lessons[0].topics[0].contents[0];
    assert.strictEqual(content.videoUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.strictEqual(content.mediaFile, null);

    fs.rmSync(result.filePath, { force: true });
  });

  await t.test("9. Missing asset fails package creation and leaves no partial ZIP", () => {
    const course = {
      title: "Broken Course",
      modules: [
        {
          lessons: [
            {
              topics: [
                {
                  contents: [
                    { type: "PDF", fileUrl: "/uploads/contents/missing.pdf" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, false);
    assert.ok(result.errors.length > 0);
  });

  await t.test("10. Invalid/traversal package path fails package creation", () => {
    const isSafe = isSafePackagePath("../../etc/passwd");
    assert.strictEqual(isSafe, false);

    const courseJson = {
      $schema: "https://orangetree.lms/schemas/course-v2.json",
      version: "2.0",
      metadata: { title: "Bad Path" },
      settings: {},
      modules: []
    };

    const collection = {
      success: true,
      assets: [
        { sourcePath: path.join(testUploadsDir, "thumbnails/cover.png"), packagePath: "../../etc/passwd" }
      ]
    };

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, false);
    assert.ok(result.errors[0].includes("Security Error"));
  });

  await t.test("11. Duplicate package path fails package creation", () => {
    const courseJson = {
      $schema: "https://orangetree.lms/schemas/course-v2.json",
      version: "2.0",
      metadata: { title: "Dup Path" },
      settings: {},
      modules: []
    };

    const collection = {
      success: true,
      assets: [
        { sourcePath: path.join(testUploadsDir, "dirA/sample.mp4"), packagePath: "contents/sample.mp4" },
        { sourcePath: path.join(testUploadsDir, "dirB/sample.mp4"), packagePath: "contents/sample.mp4" }
      ]
    };

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, false);
    assert.ok(result.errors[0].includes("Collision Error"));
  });

  await t.test("12. Generated course.json in ZIP is valid JSON with exact canonical structure", () => {
    const course = { title: "Canonical Check", modules: [] };
    const collection = collectCourseAssets(course, { uploadsDir: testUploadsDir });
    const courseJson = mapCourseToPackageData(course, { assetMap: collection.assetMap });

    const result = buildCoursePackage({ courseJson, assetCollection: collection }, { outputDir: testOutputDir });
    assert.strictEqual(result.success, true);

    const zip = new AdmZip(result.filePath);
    const text = zip.readAsText("course.json");
    const json = JSON.parse(text);

    assert.strictEqual(json.$schema, "https://orangetree.lms/schemas/course-v2.json");
    assert.strictEqual(json.version, "2.0");
    assert.strictEqual(json.metadata.title, "Canonical Check");
    assert.deepStrictEqual(json.modules, []);

    fs.rmSync(result.filePath, { force: true });
  });

});
