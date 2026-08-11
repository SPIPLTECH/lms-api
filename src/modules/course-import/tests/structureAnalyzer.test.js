const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeStructureRuleBased } = require("../services/structureAnalyzer.service");

const file = (relativePath) => ({
  absolutePath: `/root/${relativePath}`,
  relativePath,
  fileName: relativePath.split("/").pop(),
  extension: `.${relativePath.split(".").pop()}`,
  size: 10,
});

test("depth-1 folders become modules, files directly inside become their own lessons", () => {
  const files = [file("Chapter 1/introduction.html"), file("Chapter 1/basics.pdf"), file("Chapter 2/advanced.html")];
  const { modules, confidence } = analyzeStructureRuleBased(files);

  assert.equal(modules.length, 2);
  assert.equal(modules[0].title, "Chapter 1");
  assert.equal(modules[0].lessons.length, 2);
  assert.equal(modules[1].title, "Chapter 2");
  assert.ok(confidence >= 0.5);
});

test("a depth-2 subfolder groups all its files into a single lesson", () => {
  const files = [file("Module-01/Lesson-A/part1.html"), file("Module-01/Lesson-A/part2.html")];
  const { modules } = analyzeStructureRuleBased(files);

  assert.equal(modules[0].lessons.length, 1);
  assert.equal(modules[0].lessons[0].files.length, 2);
});

test("asset-named subfolders (images/, videos/, etc.) become a normal, properly-titled lesson — not a side-channel bucket, since a real course export often has no HTML wrapper at all (e.g. Module-01/videos/*.mp4 IS the lesson content)", () => {
  const files = [file("Chapter 1/introduction.html"), file("Chapter 1/images/photo.png")];
  const { modules } = analyzeStructureRuleBased(files);

  assert.equal(modules.length, 1);
  assert.equal(modules[0].lessons.length, 2);
  const imagesLesson = modules[0].lessons.find((l) => l.title === "images");
  assert.ok(imagesLesson);
  assert.equal(imagesLesson.files[0].fileName, "photo.png");
});

test("a bare videos/ subfolder with no HTML wrapper becomes its own playable lesson", () => {
  const files = [file("Module-01/videos/lecture1.mp4"), file("Module-01/videos/lecture2.mp4")];
  const { modules } = analyzeStructureRuleBased(files);

  assert.equal(modules[0].lessons.length, 1);
  assert.equal(modules[0].lessons[0].title, "videos");
  assert.equal(modules[0].lessons[0].files.length, 2);
});

test("root-level files with no folder land in a General module, each as its own lesson", () => {
  const files = [file("readme.txt"), file("overview.html")];
  const { modules, confidence } = analyzeStructureRuleBased(files);

  assert.equal(modules.length, 1);
  assert.equal(modules[0].title, "General");
  assert.equal(modules[0].lessons.length, 2);
  assert.ok(confidence < 0.5, "an all-flat package should report low confidence");
});

test("numeric order prefixes are stripped from generated titles", () => {
  const files = [file("01. Getting Started/lesson.html")];
  const { modules } = analyzeStructureRuleBased(files);
  assert.equal(modules[0].title, "Getting Started");
});
