// =====================================
// Normalize Options
// =====================================

// A single option entry is either a plain string (legacy — never carries a
// misconception tag) or a richer { optionText, isCorrect, misconceptionTag,
// explanation } object. Coercing every entry via String(opt) — the old
// behavior — turns an object option into the literal text "[object Object]",
// silently destroying any authored tag. This preserves the object shape
// instead. `explanation` is why that option is wrong, shown to a student on a
// Self-Test once they check their answer.
const normalizeOption = (opt) => {
    if (opt && typeof opt === "object" && !Array.isArray(opt)) {
        const optionText = String(opt.optionText ?? opt.text ?? "").trim();
        if (!optionText) return null;

        const normalized = { optionText };
        if (opt.isCorrect !== undefined) {
            normalized.isCorrect = Boolean(opt.isCorrect);
        }
        if (opt.misconceptionTag !== undefined && opt.misconceptionTag !== null && String(opt.misconceptionTag).trim() !== "") {
            normalized.misconceptionTag = String(opt.misconceptionTag).trim();
        }
        const explanation = opt.explanation !== undefined && opt.explanation !== null ? String(opt.explanation).trim() : "";
        if (explanation) {
            normalized.explanation = explanation;
        }
        return normalized;
    }

    const text = String(opt).trim();
    return text || null;
};

// Extracts display text from either an option shape, for the spots below
// that need to treat every option as plain text (question-type inference,
// true/false detection) regardless of whether it carries a tag.
const optionDisplayText = (opt) => {
    if (typeof opt === "string") return opt;
    if (opt && typeof opt === "object") return String(opt.optionText || "");
    return "";
};

const normalizeOptions = (row) => {
    if (!row) return [];

    // Case 1: options is already an array
    if (Array.isArray(row.options)) {
        return row.options.map((opt) => normalizeOption(opt)).filter((opt) => opt !== null);
    }

    // Case 2: options stored as JSON string or delimited string
    if (typeof row.options === "string" && row.options.trim()) {
        try {
            const parsed = JSON.parse(row.options);
            if (Array.isArray(parsed)) {
                return parsed.map((opt) => String(opt).trim()).filter(Boolean);
            }
        } catch (error) {
            // Not valid JSON, try delimiter splitting
        }

        if (row.options.includes("|")) {
            return row.options.split("|").map((opt) => opt.trim()).filter(Boolean);
        }
        if (row.options.includes(",")) {
            return row.options.split(",").map((opt) => opt.trim()).filter(Boolean);
        }
    }

    // Case 3: optionA, optionB... or option1, option2... — each optionally
    // paired with an optionA_explanation (why that option is wrong), which
    // makes the option an object rather than a plain string.
    const options = [];

    const optionKeys = [
        "optionA", "optionB", "optionC", "optionD", "optionE", "optionF", "optionG", "optionH",
        "option1", "option2", "option3", "option4", "option5", "option6", "option7", "option8"
    ];

    optionKeys.forEach((key) => {
        if (
            row[key] !== undefined &&
            row[key] !== null &&
            String(row[key]).trim() !== ""
        ) {
            const optionText = String(row[key]).trim();
            const reason = row[`${key}_explanation`];
            const explanation = reason !== undefined && reason !== null ? String(reason).trim() : "";
            options.push(explanation ? { optionText, explanation } : optionText);
        }
    });

    return options;
};

// =====================================
// Normalize Correct Answer
// Supports:
// A, B, C...
// optionA, optionB...
// 1, 2, 3...
// Arrays e.g. ["A", "B"] or "A, B"
// Full Option Text
// =====================================

// Answer text as compared with option text: surrounding and repeated spaces
// don't count, case does — "int float" and "int Float" are different
// answers in a programming question.
const answerText = (value) => String(value).trim().replace(/\s+/g, " ");

// The option an answer's text names: the one it matches exactly; failing
// that, the one option it matches when case is ignored. Never a guess
// between two options that differ only by case.
const findOptionByText = (answerStr, options) => {
    if (!Array.isArray(options)) return null;
    const text = answerText(answerStr);
    const exact = options.find((opt) => answerText(optionDisplayText(opt)) === text);
    if (exact !== undefined) return optionDisplayText(exact);
    const loose = options.filter((opt) => answerText(optionDisplayText(opt)).toLowerCase() === text.toLowerCase());
    return loose.length === 1 ? optionDisplayText(loose[0]) : null;
};

// An answer written as an option's position: "2", "B", "(b)", "B.",
// "Option B", "option 2". Numbers count from 1; any number of options.
const POSITION_ANSWER = /^(?:option\s*)?\(?([a-z]|\d+)\)?\.?$/i;

/** The option at the position an answer names, or null when it names none. */
const optionAtPosition = (answerStr, options) => {
    if (!Array.isArray(options)) return null;
    const match = String(answerStr).trim().match(POSITION_ANSWER);
    if (!match) return null;
    const token = match[1];
    const idx = /^\d+$/.test(token) ? Number(token) - 1 : token.toUpperCase().charCodeAt(0) - 65;
    return idx >= 0 && idx < options.length ? optionDisplayText(options[idx]) : null;
};

/**
 * One answer-key entry resolved to its option's exact text.
 *
 * `byPosition` is how an imported file is read: the answer is the option's
 * number (or letter), so a number always means a position — even when the
 * options are themselves numbers ("2" in [2, 4, 5, 9] is the second option,
 * 4). A key saved from the editor is read text-first instead: it holds the
 * option's text, which may itself look like a number.
 */
const normalizeSingleAnswer = (ans, options, { byPosition = false } = {}) => {
    if (ans === undefined || ans === null) return "";
    if (typeof ans === "boolean") return ans ? "True" : "False";

    const answerStr = String(ans).trim();
    if (!answerStr) return "";

    if (byPosition) {
        const atPosition = optionAtPosition(answerStr, options);
        if (atPosition !== null) return atPosition;
        // A number that names no option is an error to report, not text.
        if (/^\d+$/.test(answerStr)) return answerStr;
    }

    const byText = findOptionByText(answerStr, options);
    if (byText !== null) return byText;

    const atPosition = optionAtPosition(answerStr, options);
    if (atPosition !== null) return atPosition;

    return answerStr;
};

const normalizeCorrectAnswer = (row, options, readOptions = {}) => {
    let raw = row.correctAnswer;
    if (raw === undefined || raw === null || raw === "") {
        if (row.answer !== undefined) raw = row.answer;
    }

    if (raw === undefined || raw === null || raw === "") {
        return "";
    }

    const single = (a) => normalizeSingleAnswer(a, options, readOptions);

    // If array of answers
    if (Array.isArray(raw)) {
        return raw.map(single);
    }

    // If string representing JSON array or comma/semicolon/pipe separated values
    if (typeof raw === "string" && raw.trim()) {
        const trimmed = raw.trim();
        // An option whose own text contains a comma ("Paris, France") is one answer.
        if (findOptionByText(trimmed, options) !== null) {
            return single(trimmed);
        }
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map(single);
                }
            } catch (e) {}
        }
        if (trimmed.includes(",")) {
            // e.g. "1, 3", "A, B" or "optionA, optionB"
            return trimmed.split(",").map((s) => s.trim()).filter(Boolean).map(single);
        }
        if (trimmed.includes("|")) {
            return trimmed.split("|").map((s) => s.trim()).filter(Boolean).map(single);
        }
        if (trimmed.includes(";")) {
            return trimmed.split(";").map((s) => s.trim()).filter(Boolean).map(single);
        }
    }

    return single(raw);
};

// =====================================
// Normalize Question
// =====================================

const VALID_QUESTION_TYPES = [
    "MCQ",
    "MULTIPLE_CORRECT",
    "TRUE_FALSE",
    "FILL_BLANK",
    "SHORT_ANSWER",
    "LONG_ANSWER"
];

const VALID_DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];

/**
 * @param {object} [readOptions]
 * @param {boolean} [readOptions.answerByPosition] Read the answer key the way
 *   an imported file writes it — as option numbers/letters (see
 *   normalizeSingleAnswer). Off for keys saved from the editor, which hold
 *   option text.
 */
const normalizeQuestion = (row, { answerByPosition = false } = {}) => {
    if (!row) row = {};

    const options = normalizeOptions(row);
    const correctAnswer = normalizeCorrectAnswer(row, options, { byPosition: answerByPosition });

    let questionType = row.questionType ? String(row.questionType).trim().toUpperCase() : undefined;
    if (!questionType || !VALID_QUESTION_TYPES.includes(questionType)) {
        if (Array.isArray(correctAnswer) && correctAnswer.length > 1) {
            questionType = "MULTIPLE_CORRECT";
        } else if (
            options.length === 2 &&
            options.every((opt) => ["true", "false", "yes", "no"].includes(optionDisplayText(opt).toLowerCase()))
        ) {
            questionType = "TRUE_FALSE";
        } else if (options.length === 0) {
            questionType = "SHORT_ANSWER";
        } else {
            questionType = "MCQ";
        }
    }

    let difficulty = row.difficulty ? String(row.difficulty).trim().toUpperCase() : "MEDIUM";
    if (!VALID_DIFFICULTIES.includes(difficulty)) {
        difficulty = "MEDIUM";
    }

    const marks = isNaN(Number(row.marks)) ? 1 : Math.max(0, Number(row.marks));
    const negativeMarks = isNaN(Number(row.negativeMarks)) ? 0 : Math.max(0, Number(row.negativeMarks));
    const isRequired = row.isRequired !== undefined ? Boolean(row.isRequired) : true;
    const isPublished = row.isPublished !== undefined ? Boolean(row.isPublished) : true;
    const order = row.order !== undefined && row.order !== null && !isNaN(Number(row.order)) ? Number(row.order) : null;

    const normalized = {
        question: String(row.question || "").trim(),
        questionType,
        options,
        correctAnswer,
        explanation: row.explanation ? String(row.explanation).trim() : null,
        marks,
        negativeMarks,
        difficulty,
        isRequired,
        isPublished,
        order
    };

    if (row.quizId) {
        normalized.quizId = String(row.quizId);
    }
    if (row.courseId) {
        normalized.courseId = String(row.courseId);
    }
    if (row.moduleId) {
        normalized.moduleId = String(row.moduleId);
    }
    if (row.id) {
        normalized.id = String(row.id);
    }
    // Preserved as-is (not defaulted here): the learner-model KC mapping
    // treats "no topic supplied" as a distinct, explicit state rather than
    // silently coercing it to a shared bucket. See quiz.service.js.
    if (row.topic !== undefined && row.topic !== null && String(row.topic).trim() !== "") {
        normalized.topic = String(row.topic).trim();
    }

    return normalized;
};

module.exports = {
    normalizeQuestion,
    answerText,
};