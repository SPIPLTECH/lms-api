const AdmZip = require("adm-zip");
const fs = require("fs");
const path = require("path");

/**
 * Extracts a zip to destDir, rejecting any entry whose path would resolve
 * outside destDir (zip-slip protection) before anything is written to disk.
 */
const extractZip = (zipPath, destDir) => {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const resolvedDest = path.resolve(destDir);

  for (const entry of entries) {
    const targetPath = path.resolve(resolvedDest, entry.entryName);
    if (targetPath !== resolvedDest && !targetPath.startsWith(resolvedDest + path.sep)) {
      throw new Error(`Unsafe zip entry path: ${entry.entryName}`);
    }
  }

  fs.mkdirSync(resolvedDest, { recursive: true });
  zip.extractAllTo(resolvedDest, true);
};

module.exports = { extractZip };
