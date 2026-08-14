const fs = require("fs");
const path = require("path");

function printTree(dir, depth = 0) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const indent = "  ".repeat(depth);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        console.log(`${indent}[${file}]`);
        printTree(fullPath, depth + 1);
      } else {
        console.log(`${indent}- ${file}`);
      }
    } catch (e) {}
  }
}

console.log("=== App Directory Structure ===");
printTree("C:\\Orange Tree LMS\\frontend\\lms_web_demo\\src\\app");
