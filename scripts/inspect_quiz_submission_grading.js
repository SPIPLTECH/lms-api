const fs = require("fs");
const path = require("path");

const backendSrc = "C:\\Orange Tree LMS\\backend\\lms-api\\src";

function search(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) {
      search(fp);
    } else if (/\.(js|json)$/.test(f)) {
      const text = fs.readFileSync(fp, "utf-8");
      if (text.includes("calculateSubmissionResult") || text.includes("submitQuiz") || text.includes("correctAnswer")) {
        console.log("File:", fp);
      }
    }
  }
}

console.log("=== Searching for quiz submission and grading files ===");
search(backendSrc);
