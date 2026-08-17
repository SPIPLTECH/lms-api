const fs = require("fs");
const path = require("path");

function search(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) {
      search(fp);
    } else if (f.includes("result") || f.includes("Result")) {
      console.log("Found result component/page:", fp);
    }
  }
}

search("C:\\Orange Tree LMS\\frontend\\lms_web_demo\\src");
