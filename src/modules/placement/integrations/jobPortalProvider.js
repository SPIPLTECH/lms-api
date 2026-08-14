/**
 * External Job Portal Integration Strategy
 * -----------------------------------------
 * This module is the integration seam. No live job-portal API (LinkedIn
 * Jobs, Indeed, Naukri, ...) is wired into this codebase — there's no API
 * key, no network client, nothing to call. Rather than fabricate a fake
 * integration, this honestly returns an empty listing set by default.
 *
 * The starter catalog students match against today (constants/companies.seed.js,
 * constants/opportunities.seed.js, source: INTERNAL) is separate from this —
 * that's this agent's own seeded reference data, idempotently ensured on
 * every boot (see repositories/*.repository.js#ensureSeeded, called from
 * index.js#bootstrap). This module is specifically the seam for a *real*
 * external feed layered on top of that starter catalog.
 *
 * The contract a real provider needs to satisfy is exactly this function's
 * shape: `getExternalListings(): Promise<{jobs: JobListing[], internships:
 * InternshipListing[]}>`, where each listing carries `companyName` (resolved
 * to/created as a Company row on ingest) plus the same fields as the seed
 * data shape. schedulers/catalogRefresh.scheduler.js is the only caller —
 * swap this module's implementation for a real HTTP client against a real
 * provider and nothing else in the pipeline changes; rows it returns get
 * upserted with `source: EXTERNAL_API`, never touching INTERNAL rows.
 *
 * @returns {Promise<{jobs: Array, internships: Array}>}
 */
const getExternalListings = async () => {
  return { jobs: [], internships: [] };
};

module.exports = { getExternalListings };
