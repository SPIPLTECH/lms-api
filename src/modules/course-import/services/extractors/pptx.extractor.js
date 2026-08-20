const AdmZip = require("adm-zip");
const xml2js = require("xml2js");
const { buildServedUrl } = require("../assetResolver.service");

/**
 * PPTX is itself a zip of slide XML (ppt/slides/slideN.xml), so slide text
 * is extracted without a dedicated pptx-parsing dependency — reuses adm-zip
 * (already added for course-package extraction) + xml2js (already a
 * dependency for question-bank XML import).
 */

/**
 * Reads the text content of a single parsed <a:t> node. xml2js normally
 * collapses a childless, attribute-less element to a bare string, but an
 * <a:t xml:space="preserve"> (common wherever a run has leading/trailing
 * spaces) parses instead as `{ _: "...", $: { "xml:space": "preserve" } }` —
 * both shapes are handled so a whitespace-preserving run is never dropped.
 */
const readRunText = (node) => {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(readRunText).join("");
  if (typeof node === "object") return typeof node._ === "string" ? node._ : "";
  return "";
};

/**
 * Walks the parsed slide tree collecting only genuine text runs (<a:t>
 * content). xml2js represents every element's XML attributes under a `$`
 * key on that element's own object — walking into `$` (as a naive "recurse
 * into every key" implementation would) collects attribute *values*
 * (namespace URIs, shape ids/names, coordinates, hex colors, font names,
 * ...) as if they were text, which is exactly the noise this must avoid.
 * `$` is never text content, so it's skipped entirely; every other key is
 * still walked (structural elements only) so <a:t> nested arbitrarily deep
 * inside shapes/paragraphs/runs is still found.
 */
const collectText = (node, acc) => {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, acc));
    return;
  }
  if (typeof node === "object") {
    if (node["a:t"] !== undefined) {
      const text = readRunText(node["a:t"]);
      if (text) acc.push(text);
    }
    Object.keys(node).forEach((key) => {
      if (key === "a:t" || key === "$") return;
      collectText(node[key], acc);
    });
  }
};

const extractSlideText = async (xml) => {
  const parsed = await xml2js.parseStringPromise(xml);
  const texts = [];
  collectText(parsed, texts);
  return texts.join(" ").replace(/\s+/g, " ").trim();
};

const slideNumber = (entryName) => Number((entryName.match(/slide(\d+)\.xml/) || [])[1] || 0);

const extractFromFile = async (file, ctx) => {
  const documentBlock = {
    kind: "document",
    source: "local",
    url: buildServedUrl(ctx, file.relativePath),
    originalPath: file.relativePath,
    title: file.fileName,
    attributes: {
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: file.size,
    },
  };

  let slideEntries;
  try {
    const zip = new AdmZip(file.absolutePath);
    slideEntries = zip
      .getEntries()
      .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
      .sort((a, b) => slideNumber(a.entryName) - slideNumber(b.entryName));
  } catch (error) {
    return [documentBlock];
  }

  if (!slideEntries.length) return [documentBlock];

  const slides = [];
  for (const entry of slideEntries) {
    const text = await extractSlideText(entry.getData().toString("utf8"));
    slides.push(text || "(no extractable text)");
  }

  documentBlock.attributes.slideCount = slides.length;

  const slideshowBlock = {
    kind: "slideshow",
    markdown: slides.map((s, i) => `# Slide ${i + 1}\n\n${s}`).join("\n\n---\n\n"),
    attributes: { slideCount: slides.length, sourcePath: file.relativePath },
  };

  return [slideshowBlock, documentBlock];
};

module.exports = { extractFromFile };
