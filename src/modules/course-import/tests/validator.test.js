const test = require("node:test");
const assert = require("node:assert/strict");

const { validateCourse } = require("../services/validator.service");

const buildCourse = (overrides = {}) => ({
  title: "Sample Course",
  modules: [
    {
      title: "Module 1",
      lessons: [
        { title: "Lesson 1", content: [{ blockType: "text", markdown: "hi" }, { blockType: "image", url: "x" }] },
      ],
    },
  ],
  ...overrides,
});

test("validateCourse reports no errors for a well-formed course", () => {
  const report = validateCourse(buildCourse());
  assert.equal(report.isValid, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.summary.totalModules, 1);
  assert.equal(report.summary.totalLessons, 1);
  assert.equal(report.summary.counts.text, 1);
  assert.equal(report.summary.counts.image, 1);
});

test("validateCourse errors when the title is missing", () => {
  const report = validateCourse(buildCourse({ title: "" }));
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.includes("title")));
});

test("validateCourse errors when there are no modules", () => {
  const report = validateCourse(buildCourse({ modules: [] }));
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.includes("No modules")));
});

test("validateCourse warns on unmapped/unknown blocks without failing validity", () => {
  const course = buildCourse({
    modules: [{ title: "M1", lessons: [{ title: "L1", content: [{ blockType: "unknown", status: "UNMAPPED", original: { element: "x" } }] }] }],
  });
  const report = validateCourse(course);
  assert.equal(report.isValid, true);
  assert.equal(report.unmapped.length, 1);
  assert.ok(report.warnings.some((w) => w.includes("could not be mapped")));
});

test("validateCourse flags broken local references separately from generic unmapped content", () => {
  const course = buildCourse({
    modules: [{ title: "M1", lessons: [{ title: "L1", content: [{ blockType: "unknown", original: { element: "img", sourcePath: "a/b.png", reason: "broken local reference" } }] }] }],
  });
  const report = validateCourse(course);
  assert.equal(report.brokenReferences.length, 1);
  assert.equal(report.brokenReferences[0].path, "a/b.png");
});

test("validateCourse detects duplicate module titles", () => {
  const course = buildCourse({
    modules: [
      { title: "Intro", lessons: [] },
      { title: "intro", lessons: [] },
    ],
  });
  const report = validateCourse(course);
  assert.equal(report.duplicateModuleTitles.length, 1);
});
