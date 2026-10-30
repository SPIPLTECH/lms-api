// Pointed at a closed local port BEFORE anything loads: nothing here may
// reach a real (shared) database — only the pure key rules are exercised.
process.env.DATABASE_URL = "postgresql://mock:mock@127.0.0.1:1/never";
delete process.env.TEST_DATABASE_URL;

const test = require("node:test");
const assert = require("node:assert/strict");

const { slugifyTitle, buildCourseKeys } = require("./courseKey");

test("a title becomes a lowercase hyphenated key", () => {
  assert.equal(slugifyTitle("CDAC C-CAT Course - Section A"), "cdac-c-cat-course-section-a");
  assert.equal(slugifyTitle("  Java: Core & Advanced!  "), "java-core-advanced");
  assert.equal(slugifyTitle("Café Résumé"), "cafe-resume");
  assert.equal(slugifyTitle(""), "");
});

test("each course gets its title's key; a shared title gets the end of each id", () => {
  const keys = buildCourseKeys([
    { id: "cmv7xcix70003cm1gawuruyn0", title: "CDAC C-CAT Course - Section A" },
    { id: "cfirstcourseid0000aaaaaa", title: "Python" },
    { id: "csecondcourseid000bbbbbb", title: "Python" },
  ]);
  assert.equal(keys.get("cmv7xcix70003cm1gawuruyn0"), "cdac-c-cat-course-section-a");
  assert.equal(keys.get("cfirstcourseid0000aaaaaa"), "python-aaaaaa");
  assert.equal(keys.get("csecondcourseid000bbbbbb"), "python-bbbbbb");
});

test("a course with no usable title is keyed by its id", () => {
  const keys = buildCourseKeys([{ id: "cnotitle000000000000000x", title: "!!!" }]);
  assert.equal(keys.get("cnotitle000000000000000x"), "cnotitle000000000000000x");
});
