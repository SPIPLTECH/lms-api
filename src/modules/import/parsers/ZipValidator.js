const path = require("path");

class ZipValidator {
  static validate(zipEntries) {
    const errors = [];
    const entryNames = zipEntries.map((e) => e.entryName);

    // 1. Check for root course.json
    const rootManifest = entryNames.find(
      (name) => name === "course.json" || name.endsWith("/course.json")
    );

    if (!rootManifest) {
      errors.push({
        file: "course.json",
        error: "Missing required 'course.json' manifest at zip root.",
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      manifestPath: rootManifest || null,
    };
  }
}

module.exports = ZipValidator;
