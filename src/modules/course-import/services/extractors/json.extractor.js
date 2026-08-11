const fs = require("fs");
const { tryExtractQuizFromRows } = require("./quiz.extractor");

/** Detects question-bank-shaped JSON first; anything else is preserved verbatim as an unmapped block, never discarded. */
const extractFromFile = async (file) => {
  const raw = fs.readFileSync(file.absolutePath, "utf8");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return [{ kind: "unknown", status: "UNMAPPED", original: { element: "json", content: raw.slice(0, 2000), sourcePath: file.relativePath, reason: "invalid JSON" } }];
  }

  const quizBlocks = tryExtractQuizFromRows(parsed, file);
  if (quizBlocks) return quizBlocks;

  return [{
    kind: "unknown",
    status: "UNMAPPED",
    original: { element: "json", attributes: {}, content: JSON.stringify(parsed).slice(0, 4000), sourcePath: file.relativePath },
  }];
};

module.exports = { extractFromFile };
