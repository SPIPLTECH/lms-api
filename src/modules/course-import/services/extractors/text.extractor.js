const fs = require("fs");

const extractFromFile = async (file) => {
  const text = fs.readFileSync(file.absolutePath, "utf8");
  if (!text.trim()) return [];
  return [{ kind: "text", markdown: text, attributes: { sourceElement: "plain-text", sourcePath: file.relativePath } }];
};

module.exports = { extractFromFile };
