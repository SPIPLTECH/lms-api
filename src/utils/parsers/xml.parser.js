const fs = require("fs");
const xml2js = require("xml2js");
const { normalizeQuestion } = require("../helpers/question.helper");

const parseXML = async (filePath) => {
    const xml = fs.readFileSync(filePath, "utf8");

    const parser = new xml2js.Parser({
        explicitArray: false,
        trim: true,
    });

    const result = await parser.parseStringPromise(xml);

    let rows = [];

    if (result.questions && result.questions.question) {
        rows = result.questions.question;
    } else if (result.quiz && result.quiz.question) {
        rows = result.quiz.question;
    } else {
        throw new Error("Invalid XML structure. Expected <questions><question>...</question></questions> or <quiz><question>...</question></quiz>.");
    }

    if (!Array.isArray(rows)) {
        rows = [rows];
    }

    return rows.map((row) => normalizeQuestion(row));
};

module.exports = {
    parseXML,
};