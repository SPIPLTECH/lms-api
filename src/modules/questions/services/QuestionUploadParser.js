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

    // "SINGLE CHOICE (MCQ)"/"MULTIPLE CHOICE (MCQ)" are the labels the
    // authoring pickers show (QUESTION_TYPE_OPTIONS), so they are what an
    // instructor copies into a spreadsheet's type column. Without them,
    // "MULTIPLE CHOICE (MCQ)" matched nothing and fell through to the
    // MCQ_SINGLE default — a multi-select sheet imported as single-choice.
    // Bare "MULTIPLE CHOICE" keeps its long-standing single-choice meaning.
    if (["MCQ_SINGLE", "MCQ", "SINGLE", "MULTIPLE CHOICE", "SINGLE CHOICE", "SINGLE CHOICE (MCQ)"].includes(clean)) {
      return "MCQ_SINGLE";
    }
    if (["MCQ_MULTI", "MULTI", "MULTIPLE SELECT", "MULTIPLE CORRECT", "MULTIPLE CHOICE (MCQ)"].includes(clean)) {
      return "MCQ_MULTI";
    }
    if (["ARRANGE_TOKENS", "ARRANGE TOKENS", "ARRANGE", "ORDER", "SEQUENCE"].includes(clean)) {
      return "ARRANGE_TOKENS";
    }
    if (["MATCH_PAIRS", "MATCH PAIRS", "MATCH", "PAIRS"].includes(clean)) {
      return "MATCH_PAIRS";
    }
    // Withdrawn from the authoring pickers (see the frontend's
    // RETIRED_QUESTION_TYPES). Still recognized here so parseAndValidate can
    // reject the row by name — silently importing one would put a question
    // in the repository that no instructor can author or edit.
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
   * Types a file may no longer introduce, mapped to the label the uploader
   * knows them by, for the row-level error message.
   */
  static get RETIRED_TYPE_LABELS() {
    return {
      TRUE_FALSE: "True / False",
      FILL_BLANK: "Fill in Blanks",
      SHORT_ANSWER: "Short Answer",
      LONG_ANSWER: "Long Answer",
      SELF_ASSESSMENT: "Self Assessment",
    };
  }

  /**
   * Collects a row's option cells in column order — option1..option5 /
   * "Option 1".., or a single pipe-separated `options` cell. Shared by every
   * question type: they are MCQ choices, Arrange Tokens tokens in their
   * correct order, or "left => right" Match Pairs entries, depending on the
   * row's type.
   */
  static extractOptionCells(row) {
    const optKeys = ["option1", "option2", "option3", "option4", "option5", "Option 1", "Option 2", "Option 3", "Option 4"];
    const found = [];

    for (const k of optKeys) {
      if (row[k] !== undefined && String(row[k]).trim() !== "") {
        found.push(String(row[k]).trim());
      }
    }

    // Only a spreadsheet's single `options` cell is pipe-split here. A JSON
    // upload's array/object `options` is handled by the type branches, which
    // know its shape — stringifying one would yield "[object Object]".
    if (found.length === 0 && typeof row.options === "string" && row.options.trim() !== "") {
      found.push(...row.options.split("|").map((s) => s.trim()).filter(Boolean));
    }

    return found;
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

    // Fetch this instructor's existing question texts to detect duplicates.
    // Scoped to the uploader alone, matching what the repository shows them:
    // rejecting an upload as a "duplicate" of a row the uploader cannot see
    // leaves them with an unexplainable failure and no way to inspect it.
    const existingQuestions = await prisma.question.findMany({
      where: { createdBy: userId },
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

      // 0. Validation: the type must still be one an instructor can author
      const retiredLabel = QuestionUploadParser.RETIRED_TYPE_LABELS[type];
      if (retiredLabel) {
        report.failedCount++;
        report.errors.push({
          row: rowNum,
          question: (questionText || title).slice(0, 40),
          code: "RETIRED_QUESTION_TYPE",
          message: `"${retiredLabel}" is no longer a supported question type. Use MCQ_SINGLE, MCQ_MULTI, ARRANGE_TOKENS or MATCH_PAIRS.`,
        });
        continue;
      }

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
          const foundOpts = QuestionUploadParser.extractOptionCells(row);

          optionsList = foundOpts.map((optText, oIdx) => ({
            id: `opt-${oIdx + 1}`,
            optionText: optText,
            isCorrect: false,
          }));
        }

        // Correct Answer processing
        const rawAns = row.correctAnswer || row["Correct Answer"] || row.correct_answer || row.answer;
        // An MCQ_MULTI row names every correct option in the one cell,
        // pipe- or semicolon-separated ("string|number"). A single value is
        // just a one-entry list, so MCQ_SINGLE is unaffected — before this
        // split, a multi-answer cell matched no option at all and the row
        // silently fell back to "first option is correct" below.
        const rawAnsList = Array.isArray(rawAns)
          ? rawAns.map((a) => String(a).trim())
          : typeof rawAns === "string"
          ? rawAns.split(/[|;]/).map((a) => a.trim()).filter(Boolean)
          : [];

        rawAnsList.forEach((ansStr) => {
          // Check matching option text or index
          optionsList.forEach((opt, oIdx) => {
            if (
              opt.optionText.toLowerCase() === ansStr.toLowerCase() ||
              ansStr.toLowerCase() === `option${oIdx + 1}` ||
              ansStr.toLowerCase() === `option ${oIdx + 1}` ||
              ansStr === String(oIdx + 1)
            ) {
              opt.isCorrect = true;
            }
          });
        });

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

        // A single-choice row that named several answers keeps the first —
        // the type, not the cell, decides how many correct options it can
        // have.
        if (type === "MCQ_SINGLE") {
          let seen = false;
          optionsList.forEach((opt) => {
            if (opt.isCorrect && seen) opt.isCorrect = false;
            else if (opt.isCorrect) seen = true;
          });
        }

        correctAnswerVal = optionsList.filter((o) => o.isCorrect).map((o) => o.optionText);
      } else if (type === "ARRANGE_TOKENS") {
        // The option cells ARE the tokens, read left to right as the correct
        // order — the student is shown them shuffled. Stored as a plain
        // string array in both fields: that is the shape ArrangeTokensList
        // renders and quiz.service.js's ordered-array branch grades against.
        const tokens = Array.isArray(row.options)
          ? row.options.map((t) => (typeof t === "object" ? String(t.optionText || t.text || "") : String(t))).map((t) => t.trim()).filter(Boolean)
          : QuestionUploadParser.extractOptionCells(row);

        if (tokens.length < 2) {
          report.failedCount++;
          report.errors.push({
            row: rowNum,
            question: questionText.slice(0, 40),
            code: "MIN_TOKENS_REQUIRED",
            message: "Arrange Tokens questions require at least 2 tokens, given in their correct order.",
          });
          continue;
        }

        optionsList = tokens;
        correctAnswerVal = tokens;
      } else if (type === "MATCH_PAIRS") {
        // Each option cell holds one pair written "left => right" ("->" is
        // accepted too). Stored as { left: [], right: [] } for MatchPairsGrid
        // plus a left->right map as the key, matching what the question
        // editor saves.
        const pairs = [];

        // A JSON upload may already carry the authored shape.
        const jsonOpts = row.options;
        if (jsonOpts && typeof jsonOpts === "object" && !Array.isArray(jsonOpts) && Array.isArray(jsonOpts.left) && Array.isArray(jsonOpts.right)) {
          jsonOpts.left.forEach((left, i) => {
            const right = jsonOpts.right[i];
            if (String(left ?? "").trim() && String(right ?? "").trim()) {
              pairs.push({ left: String(left).trim(), right: String(right).trim() });
            }
          });
        }

        const pairCells = pairs.length > 0 ? [] : QuestionUploadParser.extractOptionCells(row);

        for (const cell of pairCells) {
          const parts = cell.split(/=>|->/);
          if (parts.length !== 2) continue;
          const left = parts[0].trim();
          const right = parts[1].trim();
          if (left && right) pairs.push({ left, right });
        }

        if (pairs.length < 2) {
          report.failedCount++;
          report.errors.push({
            row: rowNum,
            question: questionText.slice(0, 40),
            code: "MIN_PAIRS_REQUIRED",
            message: 'Match Pairs questions require at least 2 pairs, each written as "left => right".',
          });
          continue;
        }

        optionsList = {
          left: pairs.map((p) => p.left),
          right: pairs.map((p) => p.right),
        };
        correctAnswerVal = pairs.reduce((acc, p) => ({ ...acc, [p.left]: p.right }), {});
      }

      inBatchTextSet.add(normalizedQ);
      report.successCount++;

      report.validQuestions.push({
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
