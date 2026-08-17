const test = require("node:test");
const assert = require("node:assert/strict");

const { detectUrls, classifyUrl, getVideoProvider } = require("../services/urlDetector.service");

test("classifyUrl recognizes YouTube/Vimeo as video", () => {
  assert.equal(classifyUrl("https://youtube.com/watch?v=abc"), "video");
  assert.equal(classifyUrl("https://youtu.be/abc"), "video");
  assert.equal(classifyUrl("https://vimeo.com/12345"), "video");
});

test("classifyUrl recognizes file-extension-based content types", () => {
  assert.equal(classifyUrl("https://example.com/photo.png"), "image");
  assert.equal(classifyUrl("https://example.com/clip.mp4"), "video");
  assert.equal(classifyUrl("https://example.com/track.mp3"), "audio");
  assert.equal(classifyUrl("https://example.com/notes.pdf"), "document");
  assert.equal(classifyUrl("https://example.com/deck.pptx"), "document");
});

test("classifyUrl defaults to link for a generic web page", () => {
  assert.equal(classifyUrl("https://example.com/article"), "link");
});

test("detectUrls extracts and dedupes bare URLs from text", () => {
  const text = "See https://example.com/a and also https://example.com/a again, plus https://example.com/b.";
  const found = detectUrls(text);
  assert.equal(found.length, 2);
});

test("detectUrls returns [] for empty/undefined input", () => {
  assert.deepEqual(detectUrls(""), []);
  assert.deepEqual(detectUrls(undefined), []);
});

test("getVideoProvider identifies youtube/vimeo/external", () => {
  assert.equal(getVideoProvider("https://youtu.be/x"), "youtube");
  assert.equal(getVideoProvider("https://vimeo.com/x"), "vimeo");
  assert.equal(getVideoProvider("https://example.com/x"), "external");
});
