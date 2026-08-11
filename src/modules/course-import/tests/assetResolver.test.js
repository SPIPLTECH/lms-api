const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveLocalAsset, isLocalReference, buildServedUrl } = require("../services/assetResolver.service");

const ctx = { jobId: "job123", baseUrl: "http://localhost:5000" };

test("isLocalReference distinguishes local paths from absolute URLs/data URIs", () => {
  assert.equal(isLocalReference("images/photo.png"), true);
  assert.equal(isLocalReference("../shared/photo.png"), true);
  assert.equal(isLocalReference("https://example.com/photo.png"), false);
  assert.equal(isLocalReference("//cdn.example.com/photo.png"), false);
  assert.equal(isLocalReference("data:image/png;base64,AAA"), false);
  assert.equal(isLocalReference(""), false);
});

test("resolveLocalAsset resolves a relative src against the source file's own directory", () => {
  const result = resolveLocalAsset("images/photo.png", "Chapter 1/introduction.html", ctx);
  assert.equal(result.originalPath, "Chapter 1/images/photo.png");
  assert.equal(result.url, buildServedUrl(ctx, "Chapter 1/images/photo.png"));
});

test("resolveLocalAsset strips query/hash fragments before resolving", () => {
  const result = resolveLocalAsset("photo.png?v=2#frag", "Chapter 1/introduction.html", ctx);
  assert.equal(result.originalPath, "Chapter 1/photo.png");
});

test("resolveLocalAsset returns null when the reference would escape the package root", () => {
  const result = resolveLocalAsset("../../../etc/passwd", "Chapter 1/introduction.html", ctx);
  assert.equal(result, null);
});

test("buildServedUrl builds an absolute <baseUrl>/uploads/course-imports/<jobId>/... URL", () => {
  assert.equal(buildServedUrl(ctx, "x/y.png"), "http://localhost:5000/uploads/course-imports/job123/x/y.png");
});
