const test = require("node:test");
const assert = require("node:assert/strict");

const { detectUrls, classifyUrl, getVideoProvider, splitOnUrls } = require("../services/urlDetector.service");

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

test("splitOnUrls keeps a URL positioned between the text that surrounds it", () => {
  const text = "Watch the intro first: https://example.com/intro.mp4 then read the notes.";
  const segments = splitOnUrls(text);
  assert.deepEqual(
    segments.map((s) => s.type),
    ["text", "url", "text"],
  );
  assert.equal(segments[1].url, "https://example.com/intro.mp4");
  assert.equal(segments[1].contentType, "video");
  assert.ok(segments[0].text.endsWith("intro first: "));
  assert.ok(segments[2].text.startsWith(" then read"));
});

test("splitOnUrls emits one segment per occurrence, in source order, for multiple URLs", () => {
  const text = "Slides: https://example.com/deck.pdf\nPhoto: https://example.com/pic.png";
  const segments = splitOnUrls(text).filter((s) => s.type === "url");
  assert.equal(segments.length, 2);
  assert.equal(segments[0].contentType, "document");
  assert.equal(segments[1].contentType, "image");
});

test("splitOnUrls promotes a markdown link that points at embeddable media, carrying its link text along", () => {
  const text = "See [the demo](https://example.com/demo.mp4) for details.";
  const segments = splitOnUrls(text);
  assert.deepEqual(
    segments.map((s) => s.type),
    ["text", "url", "text"],
  );
  assert.equal(segments[1].url, "https://example.com/demo.mp4");
  assert.equal(segments[1].contentType, "video");
  assert.equal(segments[1].linkText, "the demo");
});

test("splitOnUrls leaves an ordinary markdown link to a web page embedded in its text segment", () => {
  const text = "See [our docs](https://example.com/article) for details.";
  const segments = splitOnUrls(text);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "text");
  assert.equal(segments[0].text, text);
});

test("splitOnUrls does not treat a markdown image (![alt](url)) as a promotable link", () => {
  const text = "![diagram](https://example.com/diagram.png) shows the flow.";
  const segments = splitOnUrls(text);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "text");
  assert.equal(segments[0].text, text);
});

test("splitOnUrls strips a bold markdown wrapper (***url***) off a bare URL instead of swallowing it into the link", () => {
  const text = "Watch this:\n***https://youtu.be/tx76BJIqOd4?si=igI3We_2I6Dc4D5k***\nNext paragraph.";
  const segments = splitOnUrls(text);
  const urlSegment = segments.find((s) => s.type === "url");
  assert.equal(urlSegment.url, "https://youtu.be/tx76BJIqOd4?si=igI3We_2I6Dc4D5k");
  assert.equal(urlSegment.contentType, "video");
  // The stripped delimiters stay in the surrounding text rather than being silently dropped.
  assert.ok(segments.some((s) => s.type === "text" && s.text.includes("***")));
});

test("splitOnUrls leaves a genuine trailing underscore in a URL's query string alone when it's not a matching emphasis wrapper", () => {
  const text = "Info: https://example.com/x?token=abc_123 end.";
  const segments = splitOnUrls(text);
  const urlSegment = segments.find((s) => s.type === "url");
  assert.equal(urlSegment.url, "https://example.com/x?token=abc_123");
});

test("splitOnUrls returns [] for empty/undefined input", () => {
  assert.deepEqual(splitOnUrls(""), []);
  assert.deepEqual(splitOnUrls(undefined), []);
});
