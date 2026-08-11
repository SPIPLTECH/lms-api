const fs = require("fs");
const pdf = require("pdf-parse");
const { buildServedUrl } = require("../assetResolver.service");

const extractFromFile = async (file, ctx) => {
  const buffer = fs.readFileSync(file.absolutePath);
  let data;
  try {
    data = await pdf(buffer);
  } catch (error) {
    data = { text: "", numpages: undefined };
  }

  const text = (data.text || "").trim();

  const blocks = [];
  if (text) {
    blocks.push({ kind: "text", markdown: text, attributes: { sourceElement: "pdf-text", sourcePath: file.relativePath, pageCount: data.numpages } });
  }

  blocks.push({
    kind: "document",
    source: "local",
    url: buildServedUrl(ctx, file.relativePath),
    originalPath: file.relativePath,
    title: file.fileName,
    attributes: { mimeType: "application/pdf", pageCount: data.numpages, size: file.size },
  });

  return blocks;
};

module.exports = { extractFromFile };
