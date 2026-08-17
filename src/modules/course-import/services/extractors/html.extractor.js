const fs = require("fs");
const cheerio = require("cheerio");
const { elementToMarkdown } = require("../../utils/markdownFromHtml.util");
const { resolveLocalAsset, isLocalReference } = require("../assetResolver.service");
const { getVideoProvider } = require("../urlDetector.service");

const TEXTUAL_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "table", "blockquote", "pre"];
const DOCUMENT_LINK_PATTERN = /\.(pdf|docx?|pptx?|xlsx?|zip)(\?|#|$)/i;

const buildImageNode = ($img, ctx) => {
  const src = $img.attr("src") || "";
  const alt = $img.attr("alt") || "";
  const title = $img.attr("title") || "";
  const width = $img.attr("width");
  const height = $img.attr("height");

  if (!src) {
    return { kind: "unknown", original: { element: "img", attributes: $img.attr(), sourcePath: ctx.sourceRelativePath, reason: "no src attribute" } };
  }

  if (isLocalReference(src)) {
    const resolved = resolveLocalAsset(src, ctx.sourceRelativePath, ctx);
    if (!resolved) {
      return { kind: "unknown", original: { element: "img", attributes: { src }, sourcePath: ctx.sourceRelativePath, reason: "broken local reference" } };
    }
    return {
      kind: "image",
      source: "local",
      url: resolved.url,
      originalPath: resolved.originalPath,
      alt,
      caption: title || alt,
      attributes: { width: width ? Number(width) : undefined, height: height ? Number(height) : undefined },
    };
  }

  return { kind: "image", source: "external", url: src, alt, caption: title || alt, attributes: {} };
};

const buildVideoNode = ($video, ctx) => {
  const src = $video.attr("src") || $video.find("source").first().attr("src");
  const poster = $video.attr("poster");

  if (!src) {
    return { kind: "unknown", original: { element: "video", attributes: $video.attr(), sourcePath: ctx.sourceRelativePath, reason: "no src attribute" } };
  }

  if (isLocalReference(src)) {
    const resolved = resolveLocalAsset(src, ctx.sourceRelativePath, ctx);
    if (!resolved) {
      return { kind: "unknown", original: { element: "video", attributes: { src }, sourcePath: ctx.sourceRelativePath, reason: "broken local reference" } };
    }
    return { kind: "video", source: "local", url: resolved.url, originalPath: resolved.originalPath, attributes: { poster } };
  }

  return { kind: "video", source: "external", url: src, attributes: { poster, provider: getVideoProvider(src) } };
};

const buildAudioNode = ($audio, ctx) => {
  const src = $audio.attr("src") || $audio.find("source").first().attr("src");

  if (!src) {
    return { kind: "unknown", original: { element: "audio", attributes: $audio.attr(), sourcePath: ctx.sourceRelativePath, reason: "no src attribute" } };
  }

  if (isLocalReference(src)) {
    const resolved = resolveLocalAsset(src, ctx.sourceRelativePath, ctx);
    if (!resolved) {
      return { kind: "unknown", original: { element: "audio", attributes: { src }, sourcePath: ctx.sourceRelativePath, reason: "broken local reference" } };
    }
    return { kind: "audio", source: "local", url: resolved.url, originalPath: resolved.originalPath, attributes: {} };
  }

  return { kind: "audio", source: "external", url: src, attributes: {} };
};

const buildIframeNode = ($iframe, ctx) => {
  const src = $iframe.attr("src") || "";
  if (!src) {
    return { kind: "unknown", original: { element: "iframe", attributes: $iframe.attr(), sourcePath: ctx.sourceRelativePath, reason: "no src attribute" } };
  }

  const provider = getVideoProvider(src);
  // Real course HTML almost always embeds YouTube/Vimeo via <iframe>, not
  // <video> — classify those as a video block (Content.type: VIDEO) so the
  // student lesson player actually renders them, instead of "embed" (maps
  // to INTERACTIVE_LAB, which that player has no rendering case for at all).
  if (provider === "youtube" || provider === "vimeo") {
    return { kind: "video", source: "external", url: src, attributes: { provider } };
  }

  return { kind: "embed", url: src, attributes: { provider } };
};

const buildDocumentLinkNode = ($a, ctx) => {
  const href = $a.attr("href");
  const text = $a.text().trim();

  if (isLocalReference(href)) {
    const resolved = resolveLocalAsset(href, ctx.sourceRelativePath, ctx);
    if (!resolved) {
      return { kind: "unknown", original: { element: "a", attributes: { href }, sourcePath: ctx.sourceRelativePath, reason: "broken local reference" } };
    }
    return { kind: "document", source: "local", url: resolved.url, originalPath: resolved.originalPath, title: text || undefined, attributes: {} };
  }

  return { kind: "document", source: "external", url: href, title: text || undefined, attributes: {} };
};

function walkNode(node, $, results, ctx) {
  if (!node || node.type !== "tag") return;
  const tag = (node.tagName || node.name || "").toLowerCase();

  if (tag === "img") return void results.push(buildImageNode($(node), ctx));
  if (tag === "video") return void results.push(buildVideoNode($(node), ctx));
  if (tag === "audio") return void results.push(buildAudioNode($(node), ctx));
  if (tag === "iframe") return void results.push(buildIframeNode($(node), ctx));

  if (tag === "a") {
    const href = $(node).attr("href") || "";
    if (DOCUMENT_LINK_PATTERN.test(href)) {
      results.push(buildDocumentLinkNode($(node), ctx));
      return;
    }
  }

  if (TEXTUAL_TAGS.includes(tag)) {
    const markdown = elementToMarkdown($(node), $);
    if (markdown && markdown.trim()) {
      results.push({ kind: "text", markdown, attributes: { sourceElement: tag } });
    }
    return;
  }

  $(node).contents().each((i, child) => walkNode(child, $, results, ctx));
}

/** Converts a raw HTML string into an array of raw {kind, ...} extraction nodes. */
const extractBlocksFromHtml = (html, ctx) => {
  const $ = cheerio.load(html);
  const root = $("body").length ? $("body") : $.root();
  const results = [];
  root.contents().each((i, child) => walkNode(child, $, results, ctx));
  return results;
};

const extractFromFile = async (file, ctx) => {
  const html = fs.readFileSync(file.absolutePath, "utf8");
  return extractBlocksFromHtml(html, ctx);
};

module.exports = { extractBlocksFromHtml, extractFromFile };
