const test = require("node:test");
const assert = require("node:assert/strict");

const { toContentPayload, BLOCK_TO_CONTENT_TYPE, getEffectiveBlockType } = require("../services/composerMapper.service");

test("1. Canonical text block with kind: 'text' and markdown maps to type 'HTML' with htmlContent", () => {
  const block = {
    kind: "text",
    markdown: "Hello World",
    status: "UNMAPPED"
  };
  const payload = toContentPayload(block, { topicId: "top123", order: 1 });

  assert.equal(payload.type, "HTML");
  assert.ok(payload.htmlContent.includes("Hello World"), `Expected htmlContent to contain 'Hello World', got '${payload.htmlContent}'`);
  assert.equal(payload.topicId, "top123");
  assert.equal(payload.order, 1);
});

test("2. Heading markdown maps to HTML correctly", () => {
  const block = {
    markdown: "### 1.1 Generations of Computers"
  };
  const payload = toContentPayload(block, { topicId: "top123", order: 1 });

  assert.equal(payload.type, "HTML");
  assert.ok(payload.htmlContent.includes("<h3>"), `Expected h3 tag, got '${payload.htmlContent}'`);
  assert.ok(payload.htmlContent.includes("1.1 Generations of Computers"));
});

test("3. Paragraph markdown maps to HTML correctly", () => {
  const block = {
    markdown: "Computers have evolved through five distinct generations."
  };
  const payload = toContentPayload(block, { topicId: "top123", order: 2 });

  assert.equal(payload.type, "HTML");
  assert.ok(payload.htmlContent.includes("<p>"), `Expected p tag, got '${payload.htmlContent}'`);
  assert.ok(payload.htmlContent.includes("Computers have evolved"));
});

test("4. Existing explicit HTML block behavior remains unchanged", () => {
  const block = {
    blockType: "text",
    htmlContent: "<h2>Explicit HTML</h2>",
    markdown: "## Explicit HTML"
  };
  const payload = toContentPayload(block, { topicId: "top123", order: 3 });

  assert.equal(payload.type, "HTML");
  assert.equal(payload.htmlContent, "<h2>Explicit HTML</h2>");
});

test("5. VIDEO mapping remains unchanged", () => {
  const block = {
    blockType: "video",
    url: "https://youtube.com/watch?v=12345",
    caption: "Sample Video"
  };
  const payload = toContentPayload(block, { topicId: "top123", order: 4 });

  assert.equal(payload.type, "VIDEO");
  assert.equal(payload.videoUrl, "https://youtube.com/watch?v=12345");
  assert.ok(payload.htmlContent.includes("Sample Video"));
});

test("6. FILE/DOCUMENT mapping remains unchanged", () => {
  const block = {
    blockType: "document",
    url: "https://example.com/notes.pdf"
  };
  const payload = toContentPayload(block, { topicId: "top123", order: 5 });

  assert.equal(payload.type, "DOCUMENT");
  assert.equal(payload.fileUrl, "https://example.com/notes.pdf");
});

test("7. PRESENTATION mapping remains unchanged", () => {
  const block = {
    blockType: "slideshow",
    markdown: "# Slide 1\nContent"
  };
  const payload = toContentPayload(block, { topicId: "top123", order: 6 });

  assert.equal(payload.type, "PRESENTATION");
  assert.ok(payload.htmlContent.includes("<h1>Slide 1</h1>"));
});

test("8. IMAGE mapping remains unchanged", () => {
  const block = {
    blockType: "image",
    url: "https://example.com/diagram.png",
    caption: "Diagram Caption"
  };
  const payload = toContentPayload(block, { topicId: "top123", order: 7 });

  assert.equal(payload.type, "IMAGE");
  assert.equal(payload.fileUrl, "https://example.com/diagram.png");
  assert.ok(payload.htmlContent.includes("Diagram Caption"));
});

test("9. A block with no text indicators does NOT accidentally become HTML", () => {
  const block = {
    kind: "binary",
    status: "UNMAPPED",
    original: { element: "binary" }
  };
  const payload = toContentPayload(block, { topicId: "top123", order: 8 });

  assert.equal(payload.type, "FILE");
  assert.equal(payload.htmlContent, undefined);
});
