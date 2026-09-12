const fs = require("fs");
const path = require("path");

const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const IGNORED_DIRS = new Set(["__MACOSX", ".git", "node_modules"]);

/** Recursively walks rootDir into a flat list of {absolutePath, relativePath, fileName, extension, size}. */
const scanDirectory = (rootDir) => {
  const files = [];

  const walk = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
      const stat = fs.statSync(fullPath);

      files.push({
        absolutePath: fullPath,
        relativePath,
        fileName: entry.name,
        extension: path.extname(entry.name).toLowerCase(),
        size: stat.size,
      });
    }
  };

  walk(rootDir);
  return files;
};

module.exports = { scanDirectory };
