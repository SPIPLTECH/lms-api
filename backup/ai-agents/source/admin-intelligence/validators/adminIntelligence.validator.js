const Joi = require("joi");
const { REPORT_TYPE, EXPORT_FORMAT, CAPACITY_RESOURCE_TYPE, ALERT_PRIORITY } = require("../constants");

const reportsQuerySchema = Joi.object({
  reportType: Joi.string()
    .valid(...Object.values(REPORT_TYPE))
    .optional(),
});

const forecastsQuerySchema = Joi.object({
  resourceType: Joi.string()
    .valid(...Object.values(CAPACITY_RESOURCE_TYPE))
    .optional(),
});

const alertsQuerySchema = Joi.object({
  priority: Joi.string()
    .valid(...Object.values(ALERT_PRIORITY))
    .optional(),
});

const recalculateBodySchema = Joi.object({
  trigger: Joi.string().min(1).max(64).optional(),
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

module.exports = { reportsQuerySchema, forecastsQuerySchema, alertsQuerySchema, recalculateBodySchema, exportBodySchema };
