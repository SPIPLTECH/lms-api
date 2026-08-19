const fs = require("fs");
const cheerio = require("cheerio");
const { elementToMarkdown, inline } = require("../../utils/markdownFromHtml.util");
const { resolveLocalAsset, isLocalReference } = require("../assetResolver.service");
const { getVideoProvider, splitOnUrls } = require("../urlDetector.service");

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

const mediaSegmentToNode = (segment) => ({
  kind: segment.contentType,
  source: "external",
  url: segment.url,
  caption: segment.linkText || "",
  attributes: { detectedFrom: "text", ...(segment.contentType === "video" ? { provider: getVideoProvider(segment.url) } : {}) },
});

/**
 * A table row's own columns (topic/channel/duration/...) are the caption a
 * lone extracted URL would otherwise lose, so a video/audio reference table
 * (e.g. a "Video Links" doc's list of YouTube URLs) is read row-by-row: a
 * cell that's *only* a video/audio URL becomes its own real block, captioned
 * from the row's other cells, while the table's own markdown is left
 * completely untouched — splicing text out of a table cell the way a plain
 * paragraph can be would corrupt the pipe-delimited row syntax around it.
 */
const extractMediaFromTable = ($table, $) => {
  const blocks = [];

  $table.find("tr").each((i, tr) => {
    const cellTexts = $(tr).find("th,td").map((j, cell) => inline($(cell), $)).get();

    cellTexts.forEach((text, ci) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const segments = splitOnUrls(trimmed);
      const urlSegment = segments.find((s) => s.type === "url" && (s.contentType === "video" || s.contentType === "audio"));
      if (!urlSegment) return;

      const isWholeCellJustTheUrl = trimmed === urlSegment.url || trimmed === `[${urlSegment.linkText}](${urlSegment.url})`;
      if (!isWholeCellJustTheUrl) return;

      const caption = cellTexts.filter((_, k) => k !== ci).join(" — ");
      blocks.push(mediaSegmentToNode({ ...urlSegment, linkText: urlSegment.linkText || caption }));
    });
  });

  return blocks;
};

const HEADING_SECTION_TAGS = new Set(["h1", "h2"]);

/**
 * Groups a source document's flow into one "text" block per page-like
 * section (a run of content up to the next h1/h2, mirroring how a real
 * document's pages/chapters break) instead of one block per paragraph —
 * every <p>/<h3-6>/list/table/blockquote in between joins the same
 * block's markdown, in source order, exactly like elementToMarkdown
 * already renders them (headings, bold, lists all survive). An inline
 * <img> folds into that markdown as a real ![]() embed at its exact
 * position; <video>/<audio>/<iframe>/document-link elements still break
 * out as their own top-level block (a deliberate embed, not a text
 * pass-through), flushing whatever section text came before it first so
 * ordering in the output array still matches the source.
 */
function walkAndGroup(nodes, $, ctx) {
  const results = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const markdown = buffer.join("\n\n");
    if (markdown.trim()) results.push({ kind: "text", markdown, attributes: { sourceElement: "section" } });
    buffer = [];
  };

  const visit = (node) => {
    if (!node || node.type !== "tag") return;
    const tag = (node.tagName || node.name || "").toLowerCase();

    if (tag === "img") {
      const imageNode = buildImageNode($(node), ctx);
      if (imageNode.kind === "image" && imageNode.url) {
        buffer.push(`![${imageNode.alt || ""}](${imageNode.url})`);
      } else {
        flush();
        results.push(imageNode);
      }
      return;
    }

    if (tag === "video") { flush(); results.push(buildVideoNode($(node), ctx)); return; }
    if (tag === "audio") { flush(); results.push(buildAudioNode($(node), ctx)); return; }
    if (tag === "iframe") { flush(); results.push(buildIframeNode($(node), ctx)); return; }

    if (tag === "a") {
      const href = $(node).attr("href") || "";
      if (DOCUMENT_LINK_PATTERN.test(href)) {
        flush();
        results.push(buildDocumentLinkNode($(node), ctx));
        return;
      }
    }

    if (HEADING_SECTION_TAGS.has(tag)) flush();

    if (tag === "table") {
      const markdown = elementToMarkdown($(node), $);
      const mediaBlocks = extractMediaFromTable($(node), $);

      if (mediaBlocks.length) {
        flush();
        if (markdown && markdown.trim()) results.push({ kind: "text", markdown, attributes: { sourceElement: "section" } });
        results.push(...mediaBlocks);
      } else if (markdown && markdown.trim()) {
        buffer.push(markdown);
      }
      return;
    }

    if (TEXTUAL_TAGS.includes(tag)) {
      const markdown = elementToMarkdown($(node), $);
      if (!markdown || !markdown.trim()) return;

      const segments = splitOnUrls(markdown);
      const hasEmbeddableMedia = segments.some((s) => s.type === "url" && (s.contentType === "video" || s.contentType === "audio"));
      if (!hasEmbeddableMedia) {
        buffer.push(markdown);
        return;
      }

      for (const segment of segments) {
        if (segment.type === "text") {
          if (segment.text.trim()) buffer.push(segment.text);
        } else if (segment.contentType === "video" || segment.contentType === "audio") {
          flush();
          results.push(mediaSegmentToNode(segment));
        } else {
          // Non-media URL sitting in the same paragraph as an embeddable one
          // — leave it exactly as it was written instead of also splitting it out.
          buffer.push(segment.linkText !== undefined ? `[${segment.linkText}](${segment.url})` : segment.url);
        }
      }
      return;
    }

    $(node).contents().each((i, child) => visit(child));
  };

  nodes.each((i, node) => visit(node));
  flush();
  return results;
}

/** Converts a raw HTML string into an array of raw {kind, ...} extraction nodes. */
const extractBlocksFromHtml = (html, ctx) => {
  const $ = cheerio.load(html);
  const root = $("body").length ? $("body") : $.root();
  return walkAndGroup(root.contents(), $, ctx);
};

const extractFromFile = async (file, ctx) => {
  const html = fs.readFileSync(file.absolutePath, "utf8");
  return extractBlocksFromHtml(html, ctx);
};

module.exports = { extractBlocksFromHtml, extractFromFile };
