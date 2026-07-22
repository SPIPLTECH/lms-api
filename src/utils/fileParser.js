const path = require("path");

const {
  parseCSV,
} = require("./parsers/csv.parser");

const {
  parseExcel,
} = require("./parsers/excel.parser");

const {
  parseJSON,
} = require("./parsers/json.parser");

const {
  parseXML,
} = require("./parsers/xml.parser");

const {
  parseTXT,
  parseTSV,
} = require("./parsers/text.parser");

const {
  parseHTML,
} = require("./parsers/html.parser");

const {
  parsePDF,
} = require("./parsers/pdf.parser");

const {
  parseDOCX,
} = require("./parsers/docx.parser");



// =======================================
// Parse Uploaded File
// =======================================

const parseFile = async (filePath) => {

  const extension = path
    .extname(filePath)
    .toLowerCase();

  switch (extension) {

    case ".csv":
      return await parseCSV(filePath);

    case ".xlsx":
    case ".xls":
    case ".ods":
      return await parseExcel(filePath);

    case ".json":
      return await parseJSON(filePath);

    case ".xml":
      return await parseXML(filePath);

    case ".txt":
      return await parseTXT(filePath);

    case ".tsv":
      return await parseTSV(filePath);

    case ".html":
      return await parseHTML(filePath);

    case ".pdf":
      return await parsePDF(filePath);

    case ".docx":
      return await parseDOCX(filePath);

    default:
      throw new Error(
        `Unsupported file format: ${extension}`
      );

  }

};



// =======================================
// Exports
// =======================================

module.exports = {

  parseFile,

  parseCSV,

  parseExcel,

  parseJSON,

  parseXML,

  parseTXT,

  parseTSV,

  parseHTML,

  parsePDF,

  parseDOCX,

};