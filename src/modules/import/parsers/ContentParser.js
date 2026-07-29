const path = require("path");

class ContentParser {
  static getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();

    switch (ext) {
      case ".mp4":
      case ".webm":
      case ".mov":
      case ".avi":
      case ".mkv":
        return "VIDEO";
      case ".pdf":
        return "PDF";
      case ".png":
      case ".jpg":
      case ".jpeg":
      case ".gif":
      case ".webp":
      case ".svg":
        return "IMAGE";
      case ".mp3":
      case ".wav":
      case ".ogg":
        return "AUDIO";
      case ".md":
      case ".html":
      case ".txt":
        return "TEXT";
      case ".zip":
      case ".rar":
      case ".7z":
      case ".tar":
      case ".gz":
      case ".doc":
      case ".docx":
      case ".ppt":
      case ".pptx":
        return "FILE";
      default:
        return "FILE";
    }
  }
}

module.exports = ContentParser;
