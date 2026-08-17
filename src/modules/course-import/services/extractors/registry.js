const htmlExtractor = require("./html.extractor");
const markdownExtractor = require("./markdown.extractor");
const textExtractor = require("./text.extractor");
const pdfExtractor = require("./pdf.extractor");
const docxExtractor = require("./docx.extractor");
const pptxExtractor = require("./pptx.extractor");
const imageExtractor = require("./image.extractor");
const mediaFileExtractor = require("./mediaFile.extractor");
const jsonExtractor = require("./json.extractor");
const xmlExtractor = require("./xml.extractor");
const quizExtractor = require("./quiz.extractor");

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"];
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".aac"];

/**
 * Extension/mimetype -> extractor lookup, the plugin seam this module is
 * built around (adding a new source format is "add one file + one entry
 * here," per the spec's extensibility requirement).
 */
const getExtractorFor = (file) => {
  const ext = file.extension;

  if (ext === ".html" || ext === ".htm") return htmlExtractor.extractFromFile;
  if (ext === ".md" || ext === ".markdown") return markdownExtractor.extractFromFile;
  if (ext === ".txt") return textExtractor.extractFromFile;
  if (ext === ".pdf") return pdfExtractor.extractFromFile;
  if (ext === ".docx") return docxExtractor.extractFromFile;
  if (ext === ".pptx") return pptxExtractor.extractFromFile;
  if (IMAGE_EXTENSIONS.includes(ext)) return imageExtractor.extractFromFile;
  if (VIDEO_EXTENSIONS.includes(ext)) return mediaFileExtractor.extractVideoFile;
  if (AUDIO_EXTENSIONS.includes(ext)) return mediaFileExtractor.extractAudioFile;
  if (ext === ".json") return jsonExtractor.extractFromFile;
  if (ext === ".csv") return quizExtractor.extractFromFile;
  if (ext === ".xml") return xmlExtractor.extractFromFile;

  return null;
};

module.exports = { getExtractorFor };
