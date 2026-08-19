/**
 * QuestionUploadParser.js
 * Parsers and validators for Excel (.xlsx, .xls), CSV (.csv), and JSON (.json) bulk question uploads.
 */

const XLSX = require("xlsx");
const prisma = require("../../../config/database");

class QuestionUploadParser {
  /**
   * Normalize question type string into Prisma QuestionType enum
   * @param {string} typeStr 
   * @returns {string} QuestionType
   */
  static normalizeQuestionType(typeStr) {
    if (!typeStr) return "MCQ_SINGLE";
    const clean = String(typeStr).trim().toUpperCase();

    if (["MCQ_SINGLE", "MCQ", "SINGLE", "MULTIPLE CHOICE", "SINGLE CHOICE"].includes(clean)) {
      return "MCQ_SINGLE";
    }
    if (["MCQ_MULTI", "MULTI", "MULTIPLE SELECT", "MULTIPLE CORRECT"].includes(clean)) {
      return "MCQ_MULTI";
    }
    if (["TRUE_FALSE", "TRUE/FALSE", "BOOLEAN", "TF"].includes(clean)) {
      return "TRUE_FALSE";
    }
    if (["SHORT_ANSWER", "SHORT", "TEXT"].includes(clean)) {
      return "SHORT_ANSWER";
    }
    if (["LONG_ANSWER", "LONG", "ESSAY"].includes(clean)) {
      return "LONG_ANSWER";
    }
    return "MCQ_SINGLE";
  }

  /**
   * Normalize difficulty string into Prisma DifficultyLevel enum
   * @param {string} diffStr 
   * @returns {string} DifficultyLevel
   */
  static normalizeDifficulty(diffStr) {
    if (!diffStr) return "MEDIUM";
    const clean = String(diffStr).trim().toUpperCase();
    if (clean === "EASY") return "EASY";
    if (clean === "HARD") return "HARD";
    return "MEDIUM";
  }

  /**
   * Parse raw file buffer into structured rows depending on MIME type / extension
   * @param {Buffer} buffer 
   * @param {string} filename 
   * @returns {Array<Object>} Raw rows
   */
  static extractRawRows(buffer, filename) {
    const ext = filename.toLowerCase();

    if (ext.endsWith(".json")) {
      const text = buffer.toString("utf-8");
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch (err) {
        throw new Error(`Invalid JSON file syntax: ${err.message}`);
      }
    }

    // Excel or CSV
    try {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      return rows;
    } catch (err) {
      throw new Error(`Failed to parse file: ${err.message}`);
    }
  }

  /**
   * Bulk validate and parse question rows
   * @param {Buffer} buffer 
   * @param {string} filename 
   * @param {string} userId Instructor ID
   * @returns {Promise<Object>} Summary report + validQuestions list
   */
  static async parseAndValidate(buffer, filename, userId) {
    const rawRows = this.extractRawRows(buffer, filename);

    const report = {
      total: rawRows.length,
      successCount: 0,
      failedCount: 0,
      duplicateCount: 0,
      validQuestions: [],
      errors: [],
    };

    // Fetch existing question texts for this instructor to detect duplicates
    const existingQuestions = await prisma.question.findMany({
      where: {
        OR: [{ createdBy: userId }, { createdBy: null }],
      },
      select: { question: true },
    });

    const existingTextSet = new Set(
      existingQuestions.map((q) => q.question.toLowerCase().trim())
    );
    const inBatchTextSet = new Set();

    for (let idx = 0; idx < rawRows.length; idx++) {
      const row = rawRows[idx];
      const rowNum = idx + 1;

      const title = row.title || row.Title || `Question ${rowNum}`;
      const questionText = String(row.question || row.Question || row["Question Text"] || "").trim();
      const subject = String(row.subject || row.Subject || "General").trim();
      const topic = String(row.topic || row.Topic || "General").trim();
      const difficulty = this.normalizeDifficulty(row.difficulty || row.Difficulty);
      const type = this.normalizeQuestionType(row.type || row.QuestionType || row["Question Type"]);
      const marksNum = parseInt(row.marks || row.Marks || "1", 10);
      const explanation = String(row.explanation || row.Explanation || "").trim();
      const tags = String(row.tags || row.Tags || "").trim();

      // 1. Validation: Empty Question
      if (!questionText) {
        report.failedCount++;
        report.errors.push({
          row: rowNum,
          question: title,
          code: "EMPTY_QUESTION",
          message: "Question text cannot be empty.",
        });
        continue;
      }

      // 2. Validation: Marks must be positive
      if (isNaN(marksNum) || marksNum <= 0) {
        report.failedCount++;
        report.errors.push({
          row: rowNum,
          question: questionText.slice(0, 40),
          code: "INVALID_MARKS",
          message: `Marks must be greater than zero. Received: ${row.marks}`,
        });
        continue;
      }

      // 3. Validation: Duplicate Detection
      const normalizedQ = questionText.toLowerCase().trim();
      if (existingTextSet.has(normalizedQ) || inBatchTextSet.has(normalizedQ)) {
        report.duplicateCount++;
        report.failedCount++;
        report.errors.push({
          row: rowNum,
          question: questionText.slice(0, 40),
          code: "DUPLICATE_QUESTION",
          message: "Duplicate question detected in repository or current upload file.",
        });
        continue;
      }

      // Parse options & correct answers
      let optionsList = [];
      let correctAnswerVal = null;

      if (type === "MCQ_SINGLE" || type === "MCQ_MULTI") {
        // Handle options from JSON array or option1, option2 columns
        if (Array.isArray(row.options)) {
          optionsList = row.options.map((opt, oIdx) => ({
            id: `opt-${oIdx + 1}`,
            optionText: typeof opt === "object" ? String(opt.optionText || opt.text || "") : String(opt),
            isCorrect: typeof opt === "object" ? Boolean(opt.isCorrect) : false,
          }));
        } else {
          // Extract option1, option2, option3, option4 or comma-separated options
          const optKeys = ["option1", "option2", "option3", "option4", "option5", "Option 1", "Option 2", "Option 3", "Option 4"];
          const foundOpts = [];

          for (const k of optKeys) {
            if (row[k] !== undefined && String(row[k]).trim() !== "") {
              foundOpts.push(String(row[k]).trim());
            }
          }

          if (foundOpts.length === 0 && row.options) {
            foundOpts.push(...String(row.options).split("|").map((s) => s.trim()));
          }

          optionsList = foundOpts.map((optText, oIdx) => ({
            id: `opt-${oIdx + 1}`,
            optionText: optText,
            isCorrect: false,
          }));
        }

        // Correct Answer processing
        const rawAns = row.correctAnswer || row["Correct Answer"] || row.correct_answer || row.answer;
        if (typeof rawAns === "string") {
          const ansStr = rawAns.trim();
          // Check matching option text or index
          optionsList.forEach((opt, oIdx) => {
            if (
              opt.optionText.toLowerCase() === ansStr.toLowerCase() ||
              ansStr === `option${oIdx + 1}` ||
              ansStr === `Option ${oIdx + 1}` ||
              ansStr === String(oIdx + 1)
            ) {
              opt.isCorrect = true;
            }
          });
        }

        // Validate MCQ has at least 2 options
        if (optionsList.length < 2) {
          report.failedCount++;
          report.errors.push({
            row: rowNum,
            question: questionText.slice(0, 40),
            code: "MIN_OPTIONS_REQUIRED",
            message: "Multiple choice questions require at least 2 options.",
          });
          continue;
        }

        // Validate at least 1 correct answer exists
        const hasCorrect = optionsList.some((opt) => opt.isCorrect);
        if (!hasCorrect) {
          // Default first option as correct if not specified to prevent hard failure, or log error
          optionsList[0].isCorrect = true;
        }

        correctAnswerVal = optionsList.filter((o) => o.isCorrect).map((o) => o.optionText);
      } else if (type === "TRUE_FALSE") {
        const rawAns = String(row.correctAnswer || row["Correct Answer"] || "True").trim();
        const isTrue = /^true|t|1|yes$/i.test(rawAns);
        optionsList = [
          { id: "opt-1", optionText: "True", isCorrect: isTrue },
          { id: "opt-2", optionText: "False", isCorrect: !isTrue },
        ];
        correctAnswerVal = isTrue ? "True" : "False";
      } else {
        // Short / Long Answer
        const rawAns = String(row.correctAnswer || row["Correct Answer"] || "").trim();
        optionsList = [];
        correctAnswerVal = rawAns;
      }

      inBatchTextSet.add(normalizedQ);
      report.successCount++;

      report.validQuestions.push({
        // Question has no `title` column — `title` above is only used for
        // the row-level error/report labels, never written to the DB.
        question: questionText,
        questionType: type,
        options: optionsList,
        correctAnswer: correctAnswerVal,
        explanation,
        subject,
        topic,
        tags,
        marks: marksNum,
        difficulty,
        status: "ACTIVE",
        createdBy: userId,
      });
    }

    return report;
  }
}

module.exports = QuestionUploadParser;
