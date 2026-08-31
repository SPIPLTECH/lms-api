const fs = require("fs");



// ======================================
// Normalize Options
// ======================================

const {
    normalizeQuestion
} = require(
    "../helpers/question.helper"
);



// ======================================
// Detect Delimiter
// ======================================

const detectDelimiter = (header) => {

  if (header.includes("\t")) {
    return "\t";
  }

  if (header.includes("|")) {
    return "|";
  }

  if (header.includes(";")) {
    return ";";
  }

  return ",";

};



// ======================================
// Parse Text File
// ======================================

const parseText = async (filePath) => {

  const content = fs.readFileSync(
    filePath,
    "utf8"
  );

  const lines = content
    .split(/\r?\n/)
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const delimiter =
    detectDelimiter(lines[0]);

  const headers =
    lines[0]
      .split(delimiter)
      .map((h) => h.trim());

  const questions = [];

  for (
    let i = 1;
    i < lines.length;
    i++
  ) {

    const values =
      lines[i]
        .split(delimiter);

    const row = {};

    headers.forEach(
      (
        header,
        index
      ) => {

        row[header] =
          values[index];

      }
    );

    questions.push(
    normalizeQuestion(row)
);

  }

  return questions;

};



// ======================================
// TXT
// ======================================

const parseTXT = async (
  filePath
) => {

  return parseText(filePath);

};



// ======================================
// TSV
// ======================================

const parseTSV = async (
  filePath
) => {

  return parseText(filePath);

};



module.exports = {

  parseTXT,

  parseTSV,

};