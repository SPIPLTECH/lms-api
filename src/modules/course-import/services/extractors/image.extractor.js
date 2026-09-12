const fs = require("fs");
const { imageSize } = require("image-size");
const { buildServedUrl } = require("../assetResolver.service");

const extractFromFile = async (file, ctx) => {
  let dimensions = {};
  try {
    const buffer = fs.readFileSync(file.absolutePath);
    const size = imageSize(buffer);
    dimensions = { width: size.width, height: size.height };
  } catch (error) {
    dimensions = {};
  }

  return [{
    kind: "image",
    source: "local",
    url: buildServedUrl(ctx, file.relativePath),
    originalPath: file.relativePath,
    alt: file.fileName,
    caption: "",
    attributes: { ...dimensions, size: file.size, originalFileName: file.fileName },
  }];
};

module.exports = { extractFromFile };
