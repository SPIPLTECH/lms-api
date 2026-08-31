const path = require("path");

class ContentParser {
  // Maps { heading, content } sections (as produced by MarkdownParser.parse)
  // to typed content blocks, keyed off the section heading.
  static parseBlocks(blocks) {
    return blocks.map((block) => {
      const heading = (block.heading || "").toLowerCase();
      const content = block.content || "";

      if (!block.heading) {
        return { type: "TEXT", content };
      }

      if (/video/.test(heading)) {
        return { type: "VIDEO", videoUrl: content.trim() };
      }
      if (/pdf/.test(heading)) {
        return { type: "PDF", fileUrl: content.trim() };
      }
      if (/image/.test(heading)) {
        return { type: "IMAGE", fileUrl: content.trim() };
      }
      if (/code/.test(heading)) {
        const fenced = content.match(/```([a-zA-Z0-9]*)\r?\n([\s\S]*?)```/);
        return {
          type: "CODE",
          content: fenced ? fenced[2].trim() : content.trim(),
          language: fenced && fenced[1] ? fenced[1] : null,
        };
      }
      if (/external.?link/.test(heading)) {
        return { type: "EXTERNAL_LINK", externalUrl: content.trim() };
      }

      return { type: "TEXT", content };
    });
  }

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
