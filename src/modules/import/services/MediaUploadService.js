const fs = require("fs");
const path = require("path");

class MediaUploadService {
  static saveFile(fileBuffer, originalFilename, targetFolder = "course-imports") {
    const uploadDir = path.join(__dirname, "../../../../uploads", targetFolder);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const sanitizedFilename = originalFilename.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const uniqueFilename = `${Date.now()}_${sanitizedFilename}`;
    const destinationPath = path.join(uploadDir, uniqueFilename);

    fs.writeFileSync(destinationPath, fileBuffer);

    return `/uploads/${targetFolder}/${uniqueFilename}`;
  }
}

module.exports = MediaUploadService;
