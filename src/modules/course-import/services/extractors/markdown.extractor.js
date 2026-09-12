const fs = require("fs");

const extractFromFile = async (file) => {
  const markdown = fs.readFileSync(file.absolutePath, "utf8");
  if (!markdown.trim()) return [];
  return [{ kind: "text", markdown, attributes: { sourceElement: "markdown-file", sourcePath: file.relativePath } }];
};

module.exports = { extractFromFile };
