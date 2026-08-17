const fs = require("fs");
const path = require("path");

const srcDir = "C:\\Orange Tree LMS\\frontend\\lms_web_demo\\src";

function search(dir, query) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) {
      search(fp, query);
    } else if (/\.(jsx|tsx|js|ts)$/.test(f)) {
      const text = fs.readFileSync(fp, "utf-8");
      if (text.includes(query)) {
        console.log(`Found '${query}' in: ${fp}`);
      }
    }
  }
}

console.log("=== Searching for decision or learner-model ===");
search(srcDir, "learner-model");
search(srcDir, "decision");
