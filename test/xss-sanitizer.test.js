const test = require("node:test");
const assert = require("node:assert");
const { sanitizeContent, sanitizeSvg } = require("../src/utils/sanitizer");

test("XSS Sanitizer Tests", async (t) => {
  
  await t.test("HTML Sanitization: Removes dangerous script tags", () => {
    const maliciousHtml = `<p>Hello <script>alert('XSS')</script></p>`;
    const safeHtml = sanitizeContent(maliciousHtml);
    assert.strictEqual(safeHtml, "<p>Hello </p>");
  });

  await t.test("HTML Sanitization: Removes javascript: URIs", () => {
    const maliciousHtml = `<a href="javascript:alert('XSS')">Click me</a>`;
    const safeHtml = sanitizeContent(maliciousHtml);
    assert.strictEqual(safeHtml, `<a>Click me</a>`);
  });

  await t.test("HTML Sanitization: Allows safe formatting tags", () => {
    const safeInput = `<h1>Title</h1><p><b>Bold</b> text</p>`;
    const safeHtml = sanitizeContent(safeInput);
    assert.strictEqual(safeHtml, `<h1>Title</h1><p><b>Bold</b> text</p>`);
  });

  await t.test("HTML Sanitization: Allows safe iframes", () => {
    const safeIframe = `<iframe src="https://www.youtube.com/embed/123" allowfullscreen="true"></iframe>`;
    const safeHtml = sanitizeContent(safeIframe);
    assert.strictEqual(safeHtml, `<iframe src="https://www.youtube.com/embed/123" allowfullscreen="true"></iframe>`);
  });

  await t.test("SVG Sanitization: Removes embedded scripts", () => {
    const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('XSS')</script><circle cx="50" cy="50" r="40" /></svg>`;
    const safeSvgBuffer = sanitizeSvg(Buffer.from(maliciousSvg));
    const safeSvg = safeSvgBuffer.toString();
    assert.ok(!safeSvg.includes("<script>"));
    assert.ok(safeSvg.includes("<circle"));
  });

});
