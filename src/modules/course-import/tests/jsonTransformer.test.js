const test = require("node:test");
const assert = require("node:assert/strict");

const { inlineImageUrls, splitOutMediaUrls } = require("../services/jsonTransformer.service");

test("inlineImageUrls leaves URL-free markdown untouched", () => {
  const markdown = "Just some prose, no links here.";
  assert.equal(inlineImageUrls(markdown), markdown);
});

test("inlineImageUrls converts a bare image URL into a real inline embed at its position", () => {
  const markdown = "Intro paragraph.\n\nSee https://example.com/pic.png for reference.\n\nClosing paragraph.";
  const result = inlineImageUrls(markdown);
  assert.ok(result.includes("Intro paragraph."));
  assert.ok(result.includes("See ![](https://example.com/pic.png) for reference."));
  assert.ok(result.includes("Closing paragraph."));
});

test("inlineImageUrls converts a markdown-link image reference into a real embed, carrying its link text as alt text", () => {
  const markdown = "Check the [diagram](https://example.com/diagram.png) below.";
  const result = inlineImageUrls(markdown);
  assert.equal(result, "Check the ![diagram](https://example.com/diagram.png) below.");
});

test("inlineImageUrls leaves a bare video URL exactly as written, at its original position", () => {
  const markdown = "Watch https://example.com/lesson.mp4 before continuing.";
  assert.equal(inlineImageUrls(markdown), markdown);
});

test("inlineImageUrls leaves a markdown link to embeddable video/audio/document media exactly as written", () => {
  const markdown = "Check the [recording](https://example.com/clip.mp4) from today.";
  assert.equal(inlineImageUrls(markdown), markdown);
});

test("inlineImageUrls leaves an ordinary markdown link to a web page untouched", () => {
  const markdown = "Check the [syllabus page](https://example.com/syllabus) from today.";
  assert.equal(inlineImageUrls(markdown), markdown);
});

test("inlineImageUrls handles multiple URLs of different types in one pass, only rewriting the image one", () => {
  const markdown = "See https://example.com/pic.png then https://example.com/notes.pdf and https://example.com/page.";
  const result = inlineImageUrls(markdown);
  assert.ok(result.includes("![](https://example.com/pic.png)"));
  assert.ok(result.includes("https://example.com/notes.pdf"));
  assert.ok(result.includes("https://example.com/page."));
});

test("splitOutMediaUrls leaves a section-sourced (docx/html) block untouched — html.extractor.js already handled it", () => {
  const blocks = [{ blockType: "text", markdown: "Watch https://example.com/lesson.mp4 now.", attributes: { sourceElement: "section" } }];
  assert.deepEqual(splitOutMediaUrls(blocks), blocks);
});

test("splitOutMediaUrls leaves a block with no markdown untouched", () => {
  const blocks = [{ blockType: "document", url: "local://deck.pptx" }];
  assert.deepEqual(splitOutMediaUrls(blocks), blocks);
});

test("splitOutMediaUrls splits a PDF-page block's video URL into its own block at that position", () => {
  const blocks = [
    {
      blockType: "text",
      markdown: "Intro paragraph.\n\nWatch https://example.com/lesson.mp4 before continuing.\n\nClosing paragraph.",
      attributes: { sourceElement: "pdf-page" },
    },
  ];

  const result = splitOutMediaUrls(blocks);

  assert.deepEqual(result.map((b) => b.blockType), ["text", "video", "text"]);
  assert.ok(result[0].markdown.includes("Intro paragraph"));
  assert.equal(result[1].url, "https://example.com/lesson.mp4");
  assert.ok(result[2].markdown.includes("Closing paragraph"));
});

test("splitOutMediaUrls splits a PPTX slideshow's audio URL, preserving blockType on the surrounding text", () => {
  const blocks = [{ blockType: "slideshow", markdown: "# Slide 1\n\nListen: https://example.com/lecture.mp3", attributes: { slideCount: 1 } }];
  const result = splitOutMediaUrls(blocks);
  assert.deepEqual(result.map((b) => b.blockType), ["slideshow", "audio"]);
  assert.equal(result[1].url, "https://example.com/lecture.mp3");
});

test("splitOutMediaUrls leaves a non-media (document/link) URL inline instead of also splitting it out", () => {
  const blocks = [{ blockType: "text", markdown: "See https://example.com/notes.pdf for details.", attributes: { sourceElement: "pdf-page" } }];
  const result = splitOutMediaUrls(blocks);
  assert.equal(result.length, 1);
  assert.equal(result[0].blockType, "text");
});
