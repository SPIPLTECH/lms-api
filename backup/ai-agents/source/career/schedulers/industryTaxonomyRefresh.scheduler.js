const cron = require("node-cron");

const jobMarketProvider = require("../ai/jobMarketProvider");
const industryRoleRepository = require("../repositories/industryRole.repository");
const { TAXONOMY_REFRESH_CRON } = require("../constants");

/** "New industry skill data is available" — since no external push source exists, this monthly pull is how that trigger is realized (see ai/jobMarketProvider.js for the integration seam). Only touches market fields, never requiredSkills/category. */
const runOnce = async () => {
  const trends = await jobMarketProvider.getIndustryTrends();

  let updated = 0;
  for (const trend of trends) {
    await industryRoleRepository.updateMarketFields(trend.roleName, trend);
    updated += 1;
  }

  console.log(`[career:industryTaxonomyRefresh] refreshed market fields for ${updated} role(s)`);
  return { updated };
};

const start = () => {
  cron.schedule(TAXONOMY_REFRESH_CRON, () => {
    runOnce().catch((error) => console.error("[career:industryTaxonomyRefresh] run failed:", error));
  });

  console.log(`[career:industryTaxonomyRefresh] scheduled (${TAXONOMY_REFRESH_CRON})`);
};

module.exports = { start, runOnce };
