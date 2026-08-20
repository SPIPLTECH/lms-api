const { marked } = require("marked");
const sanitizeHtml = require("sanitize-html");

/**
 * Canonical blockType -> backend ContentType enum. Mirrors the Composer's
 * own TYPE_TO_CONTENT_TYPE (contentBlockMapper.js on the frontend) exactly
 * for the block types that already exist there, extended with the 5 new
 * types this feature adds to blockRegistry.
 */
const BLOCK_TO_CONTENT_TYPE = {
  text: "HTML",
  image: "IMAGE",
  video: "VIDEO",
  slideshow: "PRESENTATION",
  interactive: "INTERACTIVE_LAB",
  quiz: "EMBED",
  audio: "AUDIO",
  document: "DOCUMENT",
  link: "LINK",
  code: "CODE",
  unknown: "FILE",
};

const renderMarkdown = (markdown) => {
  if (!markdown) return "";
  return sanitizeHtml(marked.parse(markdown), sanitizeHtml.defaults);
};

const renderPlainText = (text) => sanitizeHtml(text || "", { allowedTags: [], allowedAttributes: {} });

const getEffectiveBlockType = (block) => {
  if (!block) return "unknown";
  if (block.blockType && block.blockType !== "unknown") {
    return block.blockType;
  }
  if (
    block.kind === "text" ||
    (typeof block.markdown === "string" && block.markdown.trim().length > 0) ||
    block.htmlContent
  ) {
    return "text";
  }
  return block.blockType || "unknown";
};

const toTypedColumns = (block) => {
  const effectiveBlockType = getEffectiveBlockType(block);
  switch (effectiveBlockType) {
    case "text":
      return { htmlContent: block.htmlContent || renderMarkdown(block.markdown) };
    case "image":
      return { fileUrl: block.url || null, htmlContent: renderMarkdown(block.caption) };
    case "video":
      return { videoUrl: block.url || null, htmlContent: renderMarkdown(block.caption) };
    case "slideshow":
      return { htmlContent: renderMarkdown(block.markdown) };
    case "interactive":
      return { externalUrl: block.url || null };
    case "quiz":
      return { htmlContent: renderMarkdown(block.question) };
    case "audio":
      return { fileUrl: block.url || null };
    case "document":
      return { fileUrl: block.url || null };
    case "link":
      return { externalUrl: block.url || null };
    case "code":
      return { htmlContent: renderPlainText(block.code) };
    default:
      return {};
  }
};

/** Converts a canonical content block into a Content create body — typed columns for legacy consumers + the full block in `data` for lossless round-trip editing in the Composer, same dual-write the Composer's own save flow performs. */
const toContentPayload = (block, { topicId, order }) => {
  const effectiveBlockType = getEffectiveBlockType(block);
  return {
    topicId,
    order,
    type: BLOCK_TO_CONTENT_TYPE[effectiveBlockType] || "FILE",
    title: block.title || null,
    data: block,
    ...toTypedColumns(block),
  };
};

module.exports = { toContentPayload, BLOCK_TO_CONTENT_TYPE, getEffectiveBlockType };
