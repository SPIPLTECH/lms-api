const fs = require("fs");
const path = require("path");

function searchFile(dir, targetName) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file !== "node_modules" && file !== ".git") {
          searchFile(fullPath, targetName);
        }
      } else {
        if (file.toLowerCase().includes("agent") || file.toLowerCase().includes("pdf")) {
          console.log("Found file:", fullPath);
        }
      }
    } catch (e) {}
  }
}

console.log("=== Searching for AI_AGENTS(1).pdf and documentation in C:\\Orange Tree LMS ===");
searchFile("C:\\Orange Tree LMS", "AI_AGENTS");
searchFile("C:\\Users\\User", "AI_AGENTS");
