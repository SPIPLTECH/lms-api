const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyBlock, classifyBlocks } = require("../services/contentClassifier.service");

test("classifyBlock maps known kinds to their blockType", () => {
  assert.equal(classifyBlock({ kind: "text", markdown: "hi" }).blockType, "text");
  assert.equal(classifyBlock({ kind: "image", url: "x" }).blockType, "image");
  assert.equal(classifyBlock({ kind: "embed", url: "x" }).blockType, "interactive");
  assert.equal(classifyBlock({ kind: "quiz", question: "q" }).blockType, "quiz");
});

test("classifyBlock preserves the rest of the block's fields", () => {
  const result = classifyBlock({ kind: "image", url: "https://x/y.png", alt: "alt text" });
  assert.equal(result.url, "https://x/y.png");
  assert.equal(result.alt, "alt text");
  assert.equal(result.kind, undefined);
});

test("classifyBlock falls back to unknown for an unrecognized kind, preserving original content", () => {
  const result = classifyBlock({ kind: "mystery-thing", original: { element: "x", content: "raw" } });
  assert.equal(result.blockType, "unknown");
  assert.equal(result.status, "UNMAPPED");
  assert.equal(result.original.content, "raw");
});

test("classifyBlock defaults status to UNMAPPED when a raw unknown node omits it", () => {
  const result = classifyBlock({ kind: "unknown", original: { element: "x" } });
  assert.equal(result.status, "UNMAPPED");
});

test("classifyBlocks maps an array and handles an empty/undefined input", () => {
  assert.equal(classifyBlocks([{ kind: "text" }, { kind: "video" }]).length, 2);
  assert.deepEqual(classifyBlocks(undefined), []);
});
