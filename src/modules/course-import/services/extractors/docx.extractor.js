const mammoth = require("mammoth");
const { extractBlocksFromHtml } = require("./html.extractor");
const { buildServedUrl } = require("../assetResolver.service");

const extractFromFile = async (file, ctx) => {
  const result = await mammoth.convertToHtml({ path: file.absolutePath });
  const blocks = extractBlocksFromHtml(result.value, ctx);

  blocks.push({
    kind: "document",
    source: "local",
    url: buildServedUrl(ctx, file.relativePath),
    originalPath: file.relativePath,
    title: file.fileName,
    attributes: {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: file.size,
      conversionWarnings: (result.messages || []).length,
    },
  });

  return blocks;
};

module.exports = { extractFromFile };
