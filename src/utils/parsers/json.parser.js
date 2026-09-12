const fs = require("fs");
const { normalizeQuestion } = require("../helpers/question.helper");

const parseJSON = async (filePath) => {
    const file = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(file);

    let rows = [];

    if (Array.isArray(json)) {
        rows = json;
    } else if (Array.isArray(json.questions)) {
        rows = json.questions;
    } else {
        throw new Error("Invalid JSON format. Expected an array of questions or an object with a 'questions' array.");
    }

    return rows.map((row) => normalizeQuestion(row));
};

module.exports = {
    parseJSON,
};