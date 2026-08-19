const test = require("node:test");
const assert = require("node:assert/strict");

const { extractBlocksFromHtml } = require("../services/extractors/html.extractor");

const ctx = { jobId: "job1", baseUrl: "http://localhost:5000", sourceRelativePath: "doc.html" };

test("groups content into one block per h1/h2 section instead of one per paragraph", () => {
  const html = "<h1>Module 1</h1><p>Intro.</p><h2>Day 1</h2><p>Content A.</p><h3>1.1 Sub</h3><p>Content B.</p><h2>Day 2</h2><p>Content C.</p>";
  const blocks = extractBlocksFromHtml(html, ctx);

  assert.deepEqual(blocks.map((b) => b.kind), ["text", "text", "text"]);
  assert.ok(blocks[0].markdown.includes("# Module 1") && blocks[0].markdown.includes("Intro."));
  assert.ok(blocks[1].markdown.includes("## Day 1") && blocks[1].markdown.includes("### 1.1 Sub") && blocks[1].markdown.includes("Content B."));
  assert.ok(blocks[2].markdown.includes("## Day 2") && blocks[2].markdown.includes("Content C."));
});

test("folds an inline <img> into the surrounding section's markdown as a real embed", () => {
  const html = '<h1>Page</h1><p>Before.</p><img src="https://example.com/pic.png" alt="diagram"><p>After.</p>';
  const blocks = extractBlocksFromHtml(html, ctx);

  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].markdown.includes("Before."));
  assert.ok(blocks[0].markdown.includes("![diagram](https://example.com/pic.png)"));
  assert.ok(blocks[0].markdown.includes("After."));
});

test("splits a bare video URL in a plain paragraph into its own block at that position", () => {
  const html = "<h1>Page</h1><p>Intro.</p><p>Watch https://example.com/clip.mp4 now.</p><p>Outro.</p>";
  const blocks = extractBlocksFromHtml(html, ctx);

  assert.deepEqual(blocks.map((b) => b.kind), ["text", "video", "text"]);
  assert.ok(blocks[0].markdown.includes("Intro.") && blocks[0].markdown.includes("Watch"));
  assert.equal(blocks[1].url, "https://example.com/clip.mp4");
  assert.ok(blocks[2].markdown.includes("Outro."));
});

test("extracts a video URL from its own table cell as a real block, captioned from the row's other cells, leaving the table's own markdown untouched", () => {
  const html =
    "<h1>Videos</h1>" +
    "<table><tr><th>Topic</th><th>URL</th></tr>" +
    "<tr><td>Intro to CS</td><td>https://example.com/intro.mp4</td></tr>" +
    "<tr><td>Boolean Logic</td><td>https://example.com/logic.mp4</td></tr></table>";
  const blocks = extractBlocksFromHtml(html, ctx);

  assert.deepEqual(blocks.map((b) => b.kind), ["text", "text", "video", "video"]);
  assert.ok(blocks[1].markdown.includes("| Intro to CS | https://example.com/intro.mp4 |"), "table markdown itself is untouched, URLs stay in place");
  assert.equal(blocks[2].url, "https://example.com/intro.mp4");
  assert.equal(blocks[2].caption, "Intro to CS");
  assert.equal(blocks[3].url, "https://example.com/logic.mp4");
  assert.equal(blocks[3].caption, "Boolean Logic");
});

test("a data table with no media URLs stays folded into its section, no extra blocks", () => {
  const html = "<h1>Stats</h1><table><tr><th>Year</th><th>Count</th></tr><tr><td>2020</td><td>5</td></tr></table>";
  const blocks = extractBlocksFromHtml(html, ctx);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "text");
  assert.ok(blocks[0].markdown.includes("| 2020 | 5 |"));
});

test("strips an empty Word/mammoth bookmark anchor instead of rendering it as []()", () => {
  const html = '<h1><a id="Xabc123"></a>Module 1</h1><p>Body.</p>';
  const blocks = extractBlocksFromHtml(html, ctx);
  assert.ok(!blocks[0].markdown.includes("[]()"));
  assert.ok(blocks[0].markdown.includes("# Module 1"));
});
