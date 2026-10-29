const { parseXlsxFile } = require("./spreadsheetRows");
const { normalizeQuestion } = require("../helpers/question.helper");

const parseExcel = async (filePath) => {
    const rows = await parseXlsxFile(filePath);
    return rows.map((row) => normalizeQuestion(row, { answerByPosition: true }));
};

module.exports = {
    parseExcel,
};
