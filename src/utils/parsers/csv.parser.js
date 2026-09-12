const fs = require("fs");
const csv = require("csv-parser");



// ======================================
// Normalize Options
// ======================================

const {
    normalizeQuestion
} = require(
    "../helpers/question.helper"
);


// ======================================
// Parse CSV
// ======================================

const parseCSV = (filePath) => {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const questions = [];

      fs.createReadStream(filePath)

        .pipe(csv())

        .on(
          "data",
          (row) => {

            questions.push(
    normalizeQuestion(row)
);

          }
        )

        .on(
          "end",
          () => {

            resolve(
              questions
            );

          }
        )

        .on(
          "error",
          reject
        );

    }
  );

};



module.exports = {

  parseCSV,

};