const cron = require("node-cron");

const companyRepository = require("../repositories/company.repository");
const jobOpportunityRepository = require("../repositories/jobOpportunity.repository");
const internshipOpportunityRepository = require("../repositories/internshipOpportunity.repository");
const placementDriveRepository = require("../repositories/placementDrive.repository");
const jobPortalProvider = require("../integrations/jobPortalProvider");

const { COMPANY_SEED_DATA, JOB_SEED_DATA, INTERNSHIP_SEED_DATA, PLACEMENT_DRIVE_SEED_DATA, CATALOG_REFRESH_CRON } = require("../constants");

/**
 * Idempotently ensures the seeded starter catalog exists (source: INTERNAL
 * — safe to call on every boot and every scheduled tick, only writes when
 * a row is genuinely new or the seed data changed), then pulls whatever a
 * real external provider would offer (source: EXTERNAL_API) via
 * integrations/jobPortalProvider.js — today that's an empty set, since no
 * live provider is wired into this codebase, but the pipeline is real and
 * ready.
 */
const runOnce = async () => {
  const now = new Date();

  const companyByName = await companyRepository.ensureSeeded(COMPANY_SEED_DATA);
  const jobsSeeded = await jobOpportunityRepository.ensureSeeded(JOB_SEED_DATA, companyByName);
  const internshipsSeeded = await internshipOpportunityRepository.ensureSeeded(INTERNSHIP_SEED_DATA, companyByName);
  const drivesSeeded = await placementDriveRepository.ensureSeeded(PLACEMENT_DRIVE_SEED_DATA, companyByName, now);

  const external = await jobPortalProvider.getExternalListings();

  console.log(
    `[placement:catalogRefresh] catalog verified — ${companyByName.size} compan${companyByName.size === 1 ? "y" : "ies"}, ${jobsSeeded} job(s), ${internshipsSeeded} internship(s), ${drivesSeeded} drive(s); ${external.jobs.length + external.internships.length} external listing(s) available`
  );

  return { companies: companyByName.size, jobsSeeded, internshipsSeeded, drivesSeeded, externalListings: external.jobs.length + external.internships.length };
};

const start = () => {
  cron.schedule(CATALOG_REFRESH_CRON, () => {
    runOnce().catch((error) => console.error("[placement:catalogRefresh] run failed:", error));
  });

  console.log(`[placement:catalogRefresh] scheduled (${CATALOG_REFRESH_CRON})`);
};

module.exports = { start, runOnce };
