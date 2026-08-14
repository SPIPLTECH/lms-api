const router = require("./routes/placement.routes");
const eventConsumer = require("./events/eventConsumer");
const dailySweepScheduler = require("./schedulers/dailySweep.scheduler");
const catalogRefreshScheduler = require("./schedulers/catalogRefresh.scheduler");
const { placementBus } = require("./events/eventBus");
const { PLACEMENT_EVENT_NAMES } = require("./events/eventNames");
const placementService = require("./services/placement.service");

/** Idempotent — safe to call on every boot. Fails soft (logs, doesn't crash) before the migration that creates these tables has run. */
const seedCatalog = async () => {
  try {
    const result = await catalogRefreshScheduler.runOnce();
    console.log(`[placement] starter catalog seeded/verified:`, result);
  } catch (error) {
    console.warn("[placement] could not seed the opportunity catalog yet (likely pre-migration) — will retry on next restart:", error.message);
  }
};

/**
 * Public surface of the Placement Agent:
 *
 *   const placement = require("../placement");
 *   placement.subscribe(placement.PLACEMENT_EVENT_NAMES.PLACEMENT_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /placement in app.js. `bootstrap()` seeds the
 * starter Company/JobOpportunity/InternshipOpportunity/PlacementDrive
 * catalog, wires the live event subscriptions (Career Guidance's
 * career:profile-updated, Assessment's assessment:updated, Student
 * State's student-state:updated) and two schedulers: a daily safety-net
 * sweep and a catalog refresh (re-verifies the seeded catalog and pulls
 * whatever a real external job-portal integration would offer).
 *
 * Future systems (AI Mentor Agent, Admin Intelligence Agent, Alumni
 * Network, Company Portal, Resume Builder, Mock Interview Platform,
 * External ATS) integrate via `subscribe` or the REST API — never by
 * reaching into this module's internals.
 *
 * ---
 * This agent only analyzes opportunities, ranks them, and assists students
 * through the placement process — per the constraints, it never applies
 * for jobs automatically, modifies resumes without approval, accepts or
 * rejects offers, modifies academic records, or replaces a human
 * placement officer. `POST /placement/application` only *records* that a
 * student says they applied; it never submits anything to a real
 * ATS/company. It reads Career Guidance's skill vector/readiness (via the
 * `career.getFullState` getter added for this agent), Student State's
 * performance/engagement, and Assessment's mastery through their own
 * public surfaces — it aggregates the aggregators, it doesn't duplicate a
 * peer's domain logic.
 *
 * Several documented gaps in the current LMS domain shaped this module:
 *
 * 1. None of "Student Resume," "Portfolio," "Projects," "Company Job
 *    Listings," "Internship Listings," or "Placement Drive Data" exist as
 *    real models anywhere in this codebase. Company/JobOpportunity/
 *    InternshipOpportunity/PlacementDrive are this agent's own seeded
 *    reference catalog (constants/companies.seed.js,
 *    constants/opportunities.seed.js), the same pattern Career Guidance's
 *    IndustryRole taxonomy already established. resumeQualityScore/
 *    portfolioQualityScore are honest proxies computed from real signals
 *    (credentials, skill breadth, profile completeness) — there's no
 *    actual resume/portfolio content anywhere to analyze.
 *
 * 2. "External Job APIs" is not integrated from any real provider —
 *    integrations/jobPortalProvider.js is the real adapter seam, honestly
 *    returning an empty listing set by default. A real provider (LinkedIn
 *    Jobs, Indeed, Naukri) implements the same getExternalListings()
 *    contract and swaps in with zero changes to the scheduler or service
 *    layer.
 *
 * 3. Skill-name matching between an opportunity's required skills and a
 *    student's skill vector is normalized-string equality (same
 *    limitation Career Guidance's skillMatchEngine.js already documents)
 *    — there is no canonical skill-ID taxonomy in this LMS to join by ID.
 *
 * 4. The spec's Database Design lists no dedicated recommendation-ledger
 *    model for "Mock Interviews"/"Coding Assessments"/"Resume
 *    Improvements"/"Portfolio Improvements" (unlike Career Guidance's
 *    CareerRecommendation) — these are computed and embedded as
 *    PlacementProfile.preparationSuggestions rather than a fabricated 11th
 *    model.
 */
const bootstrap = () => {
  seedCatalog();
  eventConsumer.start();
  dailySweepScheduler.start();
  catalogRefreshScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: placementBus.subscribe.bind(placementBus),
  PLACEMENT_EVENT_NAMES,
  recalculate: placementService.recalculate,
  generateForStudent: placementService.generateForStudent,
  getProfile: placementService.getProfile,
};
