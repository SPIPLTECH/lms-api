const Joi = require("joi");
const { SCOPE_TYPE, METRIC_KEY, REPORT_TYPE, EXPORT_FORMAT } = require("../constants");

const scopeTypeSchema = Joi.string()
  .valid(...Object.values(SCOPE_TYPE))
  .required();
const metricKeySchema = Joi.string().valid(...Object.values(METRIC_KEY));

/** GET /kpis, /trends — scopeId required for everything except PLATFORM (the resolver collapses it to the sentinel regardless). */
const scopeQuerySchema = Joi.object({
  scopeType: scopeTypeSchema,
  scopeId: Joi.string().min(1).max(64).when("scopeType", { is: SCOPE_TYPE.PLATFORM, then: Joi.optional(), otherwise: Joi.required() }),
  metricKey: metricKeySchema.optional(),
});

/** GET /forecast — metricKey required, a forecast is always asked for one specific metric. */
const forecastQuerySchema = Joi.object({
  scopeType: scopeTypeSchema,
  scopeId: Joi.string().min(1).max(64).when("scopeType", { is: SCOPE_TYPE.PLATFORM, then: Joi.optional(), otherwise: Joi.required() }),
  metricKey: metricKeySchema.optional(),
});

const recalculateBodySchema = Joi.object({
  scopeType: scopeTypeSchema,
  scopeId: Joi.string().min(1).max(64).when("scopeType", { is: SCOPE_TYPE.PLATFORM, then: Joi.optional(), otherwise: Joi.required() }),
});

const reportsQuerySchema = Joi.object({
  reportType: Joi.string()
    .valid(...Object.values(REPORT_TYPE))
    .optional(),
});

const exportBodySchema = Joi.object({
  reportId: Joi.string().min(1).max(64),
  reportType: Joi.string().valid(...Object.values(REPORT_TYPE)),
  format: Joi.string()
    .valid(...Object.values(EXPORT_FORMAT))
    .required(),
})
  .xor("reportId", "reportType")
  .messages({ "object.xor": "Provide exactly one of reportId or reportType" });

module.exports = { scopeQuerySchema, forecastQuerySchema, recalculateBodySchema, reportsQuerySchema, exportBodySchema };
