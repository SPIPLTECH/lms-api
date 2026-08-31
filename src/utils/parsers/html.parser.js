const fs = require("fs");
const cheerio = require("cheerio");
const { normalizeQuestion } = require("../helpers/question.helper");

const parseHTML = async (filePath) => {
    const html = fs.readFileSync(filePath, "utf8");

    const $ = cheerio.load(html);
    const table = $("table").first();

    if (!table.length) {
        throw new Error("No HTML table found.");
    }

    const headers = [];

    table
        .find("tr")
        .first()
        .find("th,td")
        .each((i, element) => {
            headers.push($(element).text().trim());
        });

    const questions = [];

    table
        .find("tr")
        .slice(1)
        .each((i, row) => {
            const data = {};

            $(row)
                .find("td")
                .each((index, cell) => {
                    if (headers[index]) {
                        data[headers[index]] = $(cell).text().trim();
                    }
                });

            if (Object.keys(data).length > 0) {
                questions.push(normalizeQuestion(data));
            }
        });

    return questions;
};

module.exports = {
    parseHTML,
};