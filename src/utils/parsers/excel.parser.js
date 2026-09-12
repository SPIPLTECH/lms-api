const XLSX = require("xlsx");
const { normalizeQuestion } = require("../helpers/question.helper");

const parseExcel = async (filePath) => {
    const workbook = XLSX.readFile(filePath);
    if (!workbook.SheetNames.length) {
        return [];
    }

    const firstSheet = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheet];

    const rows = XLSX.utils.sheet_to_json(worksheet, {
        defval: "",
    });

    return rows.map((row) => normalizeQuestion(row));
};

module.exports = {
    parseExcel,
};