const { SCOPE_TYPE, PLATFORM_SCOPE_ID } = require("../constants");

/** Resolves the scopeId to use for a given scopeType — PLATFORM always collapses to the sentinel, regardless of what (if anything) was passed in. */
const resolveScopeId = (scopeType, rawId) => (scopeType === SCOPE_TYPE.PLATFORM ? PLATFORM_SCOPE_ID : rawId);

const truncateToUtcDay = (date = new Date()) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 3600 * 1000);

module.exports = { resolveScopeId, truncateToUtcDay, addDays };
