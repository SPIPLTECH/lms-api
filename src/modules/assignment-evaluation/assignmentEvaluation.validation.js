const Joi = require("joi");

const term = Joi.string().trim().min(1).max(200);
const sentence = Joi.string().trim().min(1).max(1000);
const marks = Joi.number().min(0).max(1000);

const criterionSchema = Joi.object({
    description: Joi.string().trim().min(1).max(500).required(),
    marks: Joi.number().positive().max(1000).required(),
    keywords: Joi.array().items(term).max(30).default([]),
    phrases: Joi.array().items(sentence).max(20).default([]),
    contradictions: Joi.array().items(sentence).max(20).default([]),
    minKeywords: Joi.number().integer().min(1).allow(null).optional(),
});

/**
 * One assignment's marking scheme. Consistency (criteria add up to the total,
 * marks on the step) is checked by the evaluator. The total becomes the
 * assignment's marks, which are whole numbers (Assignment.marks is an Int).
 */
const rubricSchema = Joi.object({
    enabled: Joi.boolean().default(true),
    idealAnswer: Joi.string().trim().min(1).max(10000).required().messages({
        "any.required": "An ideal answer is required.",
        "string.empty": "An ideal answer is required.",
    }),
    maxMarks: Joi.number().integer().min(1).max(1000).required().messages({
        "number.integer": "Total marks must be a whole number (they are the assignment's marks).",
    }),
    markStep: Joi.number().valid(0.25, 0.5, 1).default(0.5),
    keywords: Joi.array().items(term).max(50).default([]),
    synonyms: Joi.array().items(Joi.array().items(term).min(2).max(20)).max(50).default([]),
    misconceptions: Joi.array().items(sentence).max(20).default([]),
    // Results are published only when an instructor approves them.
    autoPublish: Joi.boolean().valid(false).default(false).messages({
        "any.only": "Marks are published only after you approve them; automatic publishing is not available.",
    }),
    criteria: Joi.array().items(criterionSchema).max(20).default([]),
});

// The evaluation version the instructor was looking at (GET …/evaluation
// `current.version`). A decision about any other version is refused (409).
const expectedVersion = Joi.number().integer().min(1);

const previewSchema = Joi.object({
    rubric: rubricSchema.required(),
    answerText: Joi.string().allow("").max(20000).required(),
});

const overrideSchema = Joi.object({
    // null: there is no evaluation yet (marks set before the evaluator ran).
    expectedVersion: expectedVersion.allow(null).required().messages({
        "any.required": "expectedVersion is required.",
    }),
    criteria: Joi.array().items(Joi.object({
        criterionId: Joi.string().min(1).max(64).required(),
        awarded: marks.required(),
    })).max(20).optional(),
    marksAwarded: marks.optional(),
    reason: Joi.string().trim().min(3).max(1000).required().messages({
        "any.required": "Give a reason for the change.",
        "string.empty": "Give a reason for the change.",
        "string.min": "Give a reason for the change.",
    }),
    comment: Joi.string().trim().max(2000).allow("").optional(),
}).or("criteria", "marksAwarded").messages({
    "object.missing": "Provide criterion marks or a total.",
});

const acceptSchema = Joi.object({
    expectedVersion: expectedVersion.required().messages({
        "any.required": "expectedVersion is required.",
    }),
    comment: Joi.string().trim().max(2000).allow("").optional(),
});

const reEvaluateSchema = Joi.object({
    // Required to re-evaluate a submission that already has a published grade.
    reopen: Joi.boolean().default(false),
});

const synonymGroupSchema = Joi.object({
    terms: Joi.array().items(term).min(2).max(20).required(),
    note: Joi.string().trim().max(500).allow("").optional(),
});

module.exports = { rubricSchema, previewSchema, overrideSchema, acceptSchema, reEvaluateSchema, synonymGroupSchema };
