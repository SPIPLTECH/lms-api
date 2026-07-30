const assert = require("assert");
const courseImportService = require("../src/modules/import/services/CourseImportService");
const ZipValidator = require("../src/modules/import/parsers/ZipValidator");
const contentParser = require("../src/modules/import/parsers/ContentParser");
const MarkdownParser = require("../src/modules/import/parsers/MarkdownParser");
const JSZip = require("jszip");

async function runTests() {
  console.log("🚀 Running Course Import Module Verification Tests...\n");

  // Test 1: ContentParser & MarkdownParser Block Extraction
  console.log("Test 1: ContentParser & MarkdownParser parsing...");
  const markdownText = `# Introduction to Python

Python is an accessible, high-level programming language.

## Video

intro.mp4

## PDF

notes.pdf

## Image

diagram.png

## Code Example

\`\`\`python
def hello():
    print("World")
\`\`\`

## External Link

https://python.org
`;

  const parsedMd = MarkdownParser.parse(markdownText);
  assert.strictEqual(parsedMd.title, "Introduction to Python");

  const contents = contentParser.parseBlocks(parsedMd.blocks);
  assert.strictEqual(contents.length, 6, `Expected 6 content blocks, got ${contents.length}`);
  assert.strictEqual(contents[0].type, "TEXT");
  assert.strictEqual(contents[1].type, "VIDEO");
  assert.strictEqual(contents[1].videoUrl, "intro.mp4");
  assert.strictEqual(contents[2].type, "PDF");
  assert.strictEqual(contents[2].fileUrl, "notes.pdf");
  assert.strictEqual(contents[3].type, "IMAGE");
  assert.strictEqual(contents[3].fileUrl, "diagram.png");
  assert.strictEqual(contents[4].type, "CODE");
  assert.strictEqual(contents[5].type, "EXTERNAL_LINK");
  assert.strictEqual(contents[5].externalUrl, "https://python.org");
  console.log("  ✓ ContentParser and MarkdownParser passed!\n");

  // Test 2: Sample ZIP Generation & Validation
  console.log("Test 2: Sample ZIP Generation & Validation...");
  const sampleBuffer = await courseImportService.generateSampleZip();
  assert.ok(sampleBuffer && sampleBuffer.length > 0, "Sample ZIP buffer should not be empty");

  const validationResult = await ZipValidator.validate(sampleBuffer);
  assert.strictEqual(validationResult.valid, true, `Sample ZIP should be valid, errors: ${JSON.stringify(validationResult.errors)}`);
  assert.strictEqual(validationResult.previewData.course.title, "Python Basics");
  assert.strictEqual(validationResult.previewData.modules.length, 2);
  assert.strictEqual(validationResult.previewData.stats.lessonsCount, 4);
  console.log("  ✓ Sample ZIP validation & preview generation passed!\n");

  // Test 3: Aggregated Error Validation Test (Never stop at first error)
  console.log("Test 3: Aggregated Error Validation...");
  const badZip = new JSZip();
  // Manifest referencing missing thumbnail and missing module folder
  badZip.file("course.json", JSON.stringify({
    title: "Bad Course",
    thumbnail: "missing_thumb.png",
    modules: [
      { title: "Missing Folder Mod", folder: "missing-folder" },
      { title: "Broken Media Mod", folder: "module-1" }
    ]
  }));
  // Module 1 with broken media reference and duplicate lesson titles
  badZip.file("module-1/lesson-1.md", "# Duplicate Title\n\n## Video\nmissing_video.mp4");
  badZip.file("module-1/lesson-2.md", "# Duplicate Title\n\nSome text");

  const badBuffer = await badZip.generateAsync({ type: "nodebuffer" });
  const badResult = await ZipValidator.validate(badBuffer);

  assert.strictEqual(badResult.valid, false, "Bad ZIP should be invalid");
  assert.ok(badResult.errors.length >= 3, `Expected at least 3 aggregated errors, got ${badResult.errors.length}`);

  const errorCodes = badResult.errors.map(e => e.code);
  assert.ok(errorCodes.includes("MISSING_THUMBNAIL"), "Should contain MISSING_THUMBNAIL error");
  assert.ok(errorCodes.includes("MISSING_MODULE_FOLDER"), "Should contain MISSING_MODULE_FOLDER error");
  assert.ok(errorCodes.includes("DUPLICATE_LESSON_TITLE"), "Should contain DUPLICATE_LESSON_TITLE error");
  assert.ok(errorCodes.includes("MISSING_MEDIA_FILE"), "Should contain MISSING_MEDIA_FILE error");

  console.log("  ✓ Aggregated Error Validation passed! Collected errors:\n", badResult.errors.map(e => `    - [${e.code}] ${e.message}`));

  console.log("\n🎉 ALL COURSE IMPORT TESTS PASSED SUCCESSFULLY!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
