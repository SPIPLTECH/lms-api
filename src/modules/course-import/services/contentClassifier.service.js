/**
 * Extractors emit raw nodes keyed by `kind` (their own vocabulary); this
 * maps each into the Composer's `blockType` vocabulary (blockRegistry.js on
 * the frontend), so the canonical JSON speaks the same language the
 * Composer already renders/edits.
 */
const KIND_TO_BLOCK_TYPE = {
  text: "text",
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
  slideshow: "slideshow",
  embed: "interactive",
  link: "link",
  quiz: "quiz",
  unknown: "unknown",
};

const classifyBlock = (raw) => {
  const blockType = KIND_TO_BLOCK_TYPE[raw.kind] || "unknown";

  if (blockType === "unknown") {
    return {
      blockType: "unknown",
      status: raw.status || "UNMAPPED",
      original: raw.original || { element: raw.kind || "unknown", content: null },
    };
  }

  const { kind, ...rest } = raw;
  return { blockType, ...rest };
};

const classifyBlocks = (rawBlocks) => (rawBlocks || []).map(classifyBlock);

module.exports = { classifyBlock, classifyBlocks };
