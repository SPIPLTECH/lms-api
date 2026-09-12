const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const { extractFromFile } = require("../services/extractors/pptx.extractor");

const tmpDir = path.join(__dirname, "tmp_pptx_test");
const ctx = { jobId: "job123", baseUrl: "http://localhost:5000" };

/** Minimal but structurally real slide XML — same shape as an actual exported
 * PPTX slide (xmlns declarations, shape id/name, transform coordinates, solid
 * fill hex color, run-property font — all real XML *attributes* — around two
 * genuine <a:t> text runs), mirroring the real Slides_Day1_*.pptx slide 1
 * this bug was found on. */
const SLIDE_WITH_TITLE_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Rectangle 1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12191695" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="1B2A4A"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"><a:defRPr sz="4400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:r><a:t>Day 1: Computer Evolution,</a:t></a:r></a:p><a:p><a:pPr algn="ctr"/><a:r><a:t>Architecture &amp; Number Systems</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

/** Second slide, exercising an <a:t xml:space="preserve"> run (parses to
 * `{_, $}` in xml2js, not a bare string) to prove whitespace-preserving runs
 * are still captured, not silently dropped. */
const SLIDE_WITH_PRESERVED_SPACE_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="TextBox 2"/></p:nvSpPr><p:txBody><a:p><a:r><a:t xml:space="preserve">Second slide body text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

/** A slide with shapes/positioning but genuinely no text runs at all. */
const SLIDE_WITH_NO_TEXT_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="Rectangle 9"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`;

function buildPptxFixture(fileName, slideXmls) {
  const zip = new AdmZip();
  slideXmls.forEach((xml, i) => {
    zip.addFile(`ppt/slides/slide${i + 1}.xml`, Buffer.from(xml, "utf8"));
  });
  const absolutePath = path.join(tmpDir, fileName);
  zip.writeZip(absolutePath);
  return {
    absolutePath,
    relativePath: fileName,
    fileName,
    extension: ".pptx",
    size: fs.statSync(absolutePath).size,
  };
}

test("PPTX Extractor Tests", async (t) => {
  t.before(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  });
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("extracts the real known slide text", async () => {
    const file = buildPptxFixture("day1.pptx", [SLIDE_WITH_TITLE_XML]);
    const blocks = await extractFromFile(file, ctx);
    const slideshow = blocks.find((b) => b.kind === "slideshow");
    assert.ok(slideshow.markdown.includes("Day 1: Computer Evolution, Architecture & Number Systems"));
  });

  await t.test("does NOT contain XML namespace URLs", async () => {
    const file = buildPptxFixture("namespaces.pptx", [SLIDE_WITH_TITLE_XML]);
    const blocks = await extractFromFile(file, ctx);
    const slideshow = blocks.find((b) => b.kind === "slideshow");
    assert.ok(!slideshow.markdown.includes("schemas.openxmlformats.org"));
    assert.ok(!slideshow.markdown.includes("http://"));
  });

  await t.test("does NOT contain shape ids/names, hex colors, font names, or coordinate metadata", async () => {
    const file = buildPptxFixture("noise.pptx", [SLIDE_WITH_TITLE_XML]);
    const blocks = await extractFromFile(file, ctx);
    const slideshow = blocks.find((b) => b.kind === "slideshow");
    const text = slideshow.markdown;

    assert.ok(!text.includes("Rectangle 1"), "shape name leaked into extracted text");
    assert.ok(!text.includes("Calibri"), "font typeface leaked into extracted text");
    assert.ok(!text.includes("1B2A4A"), "hex fill color leaked into extracted text");
    assert.ok(!text.includes("FFFFFF"), "hex run color leaked into extracted text");
    assert.ok(!text.includes("12191695"), "shape coordinate leaked into extracted text");
    assert.ok(!text.includes("6858000"), "shape coordinate leaked into extracted text");
    assert.ok(!text.includes("4400"), "font size attribute leaked into extracted text");
  });

  await t.test("captures a whitespace-preserving run (<a:t xml:space=\"preserve\">) instead of silently dropping it", async () => {
    const file = buildPptxFixture("preserve.pptx", [SLIDE_WITH_PRESERVED_SPACE_XML]);
    const blocks = await extractFromFile(file, ctx);
    const slideshow = blocks.find((b) => b.kind === "slideshow");
    assert.ok(slideshow.markdown.includes("Second slide body text"));
  });

  await t.test("a slide with no text runs falls back to the existing '(no extractable text)' placeholder, not noise", async () => {
    const file = buildPptxFixture("empty.pptx", [SLIDE_WITH_NO_TEXT_XML]);
    const blocks = await extractFromFile(file, ctx);
    const slideshow = blocks.find((b) => b.kind === "slideshow");
    assert.ok(slideshow.markdown.includes("(no extractable text)"));
    assert.ok(!slideshow.markdown.includes("Rectangle 9"));
  });

  await t.test("slide boundaries and ordering are preserved across multiple slides", async () => {
    const file = buildPptxFixture(
      "multi.pptx",
      [SLIDE_WITH_TITLE_XML, SLIDE_WITH_PRESERVED_SPACE_XML, SLIDE_WITH_NO_TEXT_XML]
    );
    const blocks = await extractFromFile(file, ctx);
    const slideshow = blocks.find((b) => b.kind === "slideshow");

    assert.equal(slideshow.attributes.slideCount, 3);
    const sections = slideshow.markdown.split(/\n\n---\n\n/);
    assert.equal(sections.length, 3);
    assert.ok(sections[0].startsWith("# Slide 1"));
    assert.ok(sections[0].includes("Day 1: Computer Evolution"));
    assert.ok(sections[1].startsWith("# Slide 2"));
    assert.ok(sections[1].includes("Second slide body text"));
    assert.ok(sections[2].startsWith("# Slide 3"));
    assert.ok(sections[2].includes("(no extractable text)"));
  });

  await t.test("existing output shape/contract is unchanged: [slideshow, document] blocks with the same fields", async () => {
    const file = buildPptxFixture("shape.pptx", [SLIDE_WITH_TITLE_XML]);
    const blocks = await extractFromFile(file, ctx);

    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].kind, "slideshow");
    assert.ok(typeof blocks[0].markdown === "string");
    assert.equal(blocks[0].attributes.slideCount, 1);
    assert.equal(blocks[0].attributes.sourcePath, file.relativePath);

    const documentBlock = blocks[1];
    assert.equal(documentBlock.kind, "document");
    assert.equal(documentBlock.source, "local");
    assert.equal(documentBlock.title, file.fileName);
    assert.equal(documentBlock.originalPath, file.relativePath);
    assert.equal(documentBlock.url, `http://localhost:5000/uploads/course-imports/job123/${file.relativePath}`);
    assert.equal(
      documentBlock.attributes.mimeType,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    assert.equal(documentBlock.attributes.size, file.size);
    assert.equal(documentBlock.attributes.slideCount, 1);
  });

  await t.test("a .pptx with no ppt/slides/*.xml entries at all falls back to just the document block (unchanged behavior)", async () => {
    const zip = new AdmZip();
    zip.addFile("not-a-slide.txt", Buffer.from("irrelevant", "utf8"));
    const absolutePath = path.join(tmpDir, "no-slides.pptx");
    zip.writeZip(absolutePath);
    const file = {
      absolutePath,
      relativePath: "no-slides.pptx",
      fileName: "no-slides.pptx",
      extension: ".pptx",
      size: fs.statSync(absolutePath).size,
    };

    const blocks = await extractFromFile(file, ctx);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, "document");
  });
});
