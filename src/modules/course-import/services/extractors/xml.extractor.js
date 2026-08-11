const fs = require("fs");
const xml2js = require("xml2js");

/** Generic (non-SCORM-manifest) XML — no reliable structural guess, so it's preserved verbatim as an unmapped block. */
const extractFromFile = async (file) => {
  const raw = fs.readFileSync(file.absolutePath, "utf8");

  try {
    const parsed = await xml2js.parseStringPromise(raw);
    return [{
      kind: "unknown",
      status: "UNMAPPED",
      original: { element: "xml", content: JSON.stringify(parsed).slice(0, 4000), sourcePath: file.relativePath },
    }];
  } catch (error) {
    return [{
      kind: "unknown",
      status: "UNMAPPED",
      original: { element: "xml", content: raw.slice(0, 2000), sourcePath: file.relativePath, reason: "invalid XML" },
    }];
  }
};

module.exports = { extractFromFile };
