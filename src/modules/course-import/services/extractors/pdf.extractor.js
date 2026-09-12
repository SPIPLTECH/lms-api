const fs = require("fs");
const { PDFParse } = require("pdf-parse");
const { buildServedUrl } = require("../assetResolver.service");

/** One "text" block per real PDF page (pdf-parse v2 wraps pdfjs-dist and exposes true page boundaries via result.pages), so the preview mirrors the source document's own pagination instead of one undifferentiated text blob. */
const extractFromFile = async (file, ctx) => {
  const buffer = fs.readFileSync(file.absolutePath);
  const blocks = [];
  let pageCount;

  try {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      pageCount = result.total;
      for (const page of result.pages) {
        const text = (page.text || "").trim();
        if (text) {
          blocks.push({
            kind: "text",
            markdown: text,
            attributes: { sourceElement: "pdf-page", sourcePath: file.relativePath, pageNumber: page.num, pageCount: result.total },
          });
        }
      }
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    // Unreadable/corrupt PDF — fall through with no text pages, the raw
    // file link below still lets the instructor open it directly.
  }

  blocks.push({
    kind: "document",
    source: "local",
    url: buildServedUrl(ctx, file.relativePath),
    originalPath: file.relativePath,
    title: file.fileName,
    attributes: { mimeType: "application/pdf", pageCount, size: file.size },
  });

  return blocks;
};

module.exports = { extractFromFile };
