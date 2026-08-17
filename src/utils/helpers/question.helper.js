// =====================================
// Normalize Options
// =====================================

// A single option entry is either a plain string (legacy — never carries a
// misconception tag) or a richer { optionText, isCorrect, misconceptionTag }
// object. Coercing every entry via String(opt) — the old behavior — turns
// an object option into the literal text "[object Object]", silently
// destroying any authored tag. This preserves the object shape instead.
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

    // Case 3: optionA, optionB... or option1, option2...
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
            options.push(String(row[key]).trim());
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

const normalizeSingleAnswer = (ans, options) => {
    if (ans === undefined || ans === null) return "";
    if (typeof ans === "boolean") return ans ? "True" : "False";

    const answerStr = String(ans).trim();
    if (!answerStr) return "";

    const answerMap = {
        A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7,
        optionA: 0, optionB: 1, optionC: 2, optionD: 3, optionE: 4, optionF: 5, optionG: 6, optionH: 7,
        1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7,
        option1: 0, option2: 1, option3: 2, option4: 3, option5: 4, option6: 5, option7: 6, option8: 7,
    };

    if (Object.prototype.hasOwnProperty.call(answerMap, answerStr)) {
        const idx = answerMap[answerStr];
        if (options && options[idx] !== undefined) {
            // options[idx] may now be an object ({optionText, ...}) rather
            // than a plain string — resolve shorthand (e.g. "A") to its
            // display text either way.
            return optionDisplayText(options[idx]) || options[idx];
        }
    }

    return answerStr;
};

const normalizeCorrectAnswer = (row, options) => {
    let raw = row.correctAnswer;
    if (raw === undefined || raw === null || raw === "") {
        if (row.answer !== undefined) raw = row.answer;
    }

    if (raw === undefined || raw === null || raw === "") {
        return "";
    }

    // If array of answers
    if (Array.isArray(raw)) {
        return raw.map((a) => normalizeSingleAnswer(a, options));
    }

    // If string representing JSON array or comma/pipe separated values
    if (typeof raw === "string" && raw.trim()) {
        const trimmed = raw.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map((a) => normalizeSingleAnswer(a, options));
                }
            } catch (e) {}
        }
        if (trimmed.includes(",")) {
            const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
            // Check if parts match keys (e.g. "A, B" or "optionA, optionB")
            const mapped = parts.map((p) => normalizeSingleAnswer(p, options));
            return mapped;
        }
        if (trimmed.includes("|")) {
            const parts = trimmed.split("|").map((s) => s.trim()).filter(Boolean);
            return parts.map((p) => normalizeSingleAnswer(p, options));
        }
    }

    return normalizeSingleAnswer(raw, options);
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

const normalizeQuestion = (row) => {
    if (!row) row = {};

    const options = normalizeOptions(row);
    const correctAnswer = normalizeCorrectAnswer(row, options);

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
    normalizeOptions,
    normalizeCorrectAnswer,
    normalizeQuestion,
};