const { INDUSTRY_ROLE_SEED_DATA } = require("../constants");

/**
 * External Job Market Integration Strategy
 * -----------------------------------------
 * This module is the integration seam. No live job-market API (LinkedIn
 * Talent Insights, Naukri, Indeed, Glassdoor, ...) is wired into this
 * codebase — there's no API key, no network client, nothing to call. Rather
 * than fabricate a fake integration, this ships a working default that
 * returns the static seed dataset's figures unchanged.
 *
 * The contract a real provider needs to satisfy is exactly this function's
 * shape: `getIndustryTrends(): Promise<{roleName, industryDemandScore,
 * avgSalaryMin, avgSalaryMax}[]>`. schedulers/industryTaxonomyRefresh.scheduler.js
 * is the only caller — swap this module's implementation for a real HTTP
 * client against a real provider and nothing else in the pipeline changes.
 *
 * @returns {Promise<{roleName: string, industryDemandScore: number, avgSalaryMin: number|null, avgSalaryMax: number|null}[]>}
 */
const getIndustryTrends = async () => {
  return INDUSTRY_ROLE_SEED_DATA.map((role) => ({
    roleName: role.name,
    industryDemandScore: role.industryDemandScore,
    avgSalaryMin: role.avgSalaryMin ?? null,
    avgSalaryMax: role.avgSalaryMax ?? null,
  }));
};

module.exports = { getIndustryTrends };
