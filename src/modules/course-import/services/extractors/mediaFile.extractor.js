const { buildServedUrl } = require("../assetResolver.service");

/**
 * Video/audio files with no metadata-probe library available in this repo
 * (no ffprobe-equivalent dependency) — captures file size/name/URL only;
 * duration is intentionally left blank rather than fabricated.
 */
const extractVideoFile = async (file, ctx) => [{
  kind: "video",
  source: "local",
  url: buildServedUrl(ctx, file.relativePath),
  originalPath: file.relativePath,
  attributes: { size: file.size, originalFileName: file.fileName },
}];

const extractAudioFile = async (file, ctx) => [{
  kind: "audio",
  source: "local",
  url: buildServedUrl(ctx, file.relativePath),
  originalPath: file.relativePath,
  attributes: { size: file.size, originalFileName: file.fileName },
}];

module.exports = { extractVideoFile, extractAudioFile };
