const CHOICE_QUESTION_TYPES = ["MCQ", "MULTIPLE_CORRECT", "TRUE_FALSE"];

const validateQuestion = (question) => {
    const errors = [];

    if (!question || typeof question !== "object") {
        return {
            isValid: false,
            errors: ["Question must be an object."]
        };
    }

    // Question Text
    if (!question.question || typeof question.question !== "string" || !question.question.trim()) {
        errors.push("Question is required.");
    }

    const qType = question.questionType ? String(question.questionType).toUpperCase() : "MCQ";
    const isChoiceType = CHOICE_QUESTION_TYPES.includes(qType) || (!question.questionType && Array.isArray(question.options) && question.options.length > 0);

    // Options
    if (question.options !== undefined && question.options !== null && !Array.isArray(question.options)) {
        errors.push("Options must be an array.");
    } else if (isChoiceType) {
        if (!Array.isArray(question.options)) {
            errors.push("Options must be an array.");
        } else {
            if (question.options.length < 2) {
                errors.push("Minimum 2 options are required for multiple choice/true-false questions.");
            }

            const uniqueOptions = new Set(
                question.options.map(option => String(option).trim())
            );

            if (uniqueOptions.size !== question.options.length) {
                errors.push("Duplicate options are not allowed.");
            }
        }
    }

    // Correct Answer
    if (
        question.correctAnswer === undefined ||
        question.correctAnswer === null ||
        (typeof question.correctAnswer === "string" && !question.correctAnswer.trim()) ||
        (Array.isArray(question.correctAnswer) && question.correctAnswer.length === 0)
    ) {
        // LONG_ANSWER can have optional sample answer
        if (qType !== "LONG_ANSWER") {
            errors.push("Correct answer is required.");
        }
    } else if (Array.isArray(question.options) && question.options.length > 0) {
        const answers = Array.isArray(question.correctAnswer)
            ? question.correctAnswer
            : [question.correctAnswer];

        answers.forEach(answer => {
            const ansStr = String(answer).trim();
            const optionMatches = question.options.some(
                opt => String(opt).trim().toLowerCase() === ansStr.toLowerCase()
            );

            if (!optionMatches && isChoiceType) {
                errors.push(
                    `Correct answer "${ansStr}" does not exist in options.`
                );
            }
        });
    }

    // Marks
    if (question.marks === undefined || question.marks === null) {
        question.marks = 1;
    }

    if (isNaN(question.marks) || Number(question.marks) <= 0) {
        errors.push("Marks must be greater than 0.");
    }

    // Negative Marks
    if (question.negativeMarks !== undefined && question.negativeMarks !== null) {
        if (isNaN(question.negativeMarks) || Number(question.negativeMarks) < 0) {
            errors.push("Negative marks must be 0 or a positive number.");
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
};

const validateQuestions = (questions) => {
    if (!Array.isArray(questions)) {
        return {
            validQuestions: [],
            failedQuestions: [{ row: 0, question: null, errors: ["Input must be an array of questions."] }]
        };
    }

    const validQuestions = [];
    const failedQuestions = [];

    questions.forEach((question, index) => {
        const result = validateQuestion(question);

        if (result.isValid) {
            validQuestions.push(question);
        } else {
            failedQuestions.push({
                row: index + 1,
                question: question && question.question ? question.question : null,
                errors: result.errors,
            });
        }
    });

    return {
        validQuestions,
        failedQuestions,
    };
};

module.exports = {
    validateQuestion,
    validateQuestions,
};