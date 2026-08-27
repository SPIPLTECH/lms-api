const router = require("./routes/career.routes");
const eventConsumer = require("./events/eventConsumer");
const dailySafetySweepScheduler = require("./schedulers/dailySafetySweep.scheduler");
const industryTaxonomyRefreshScheduler = require("./schedulers/industryTaxonomyRefresh.scheduler");
const { careerBus } = require("./events/eventBus");
const { CAREER_EVENT_NAMES } = require("./events/eventNames");
const careerService = require("./services/career.service");
const industryRoleRepository = require("./repositories/industryRole.repository");
const { INDUSTRY_ROLE_SEED_DATA } = require("./constants");

/** Idempotent — safe to call on every boot. Fails soft (logs, doesn't crash) before the migration that creates IndustryRole has run. */
const seedIndustryTaxonomy = async () => {
  try {
    const count = await industryRoleRepository.ensureSeeded(INDUSTRY_ROLE_SEED_DATA);
    console.log(`[career] industry role taxonomy seeded/verified (${count} role(s))`);
  } catch (error) {
    console.warn("[career] could not seed industry role taxonomy yet (likely pre-migration) — will retry on next restart:", error.message);
  }
};

/**
 * Public surface of the Career Guidance Agent:
 *
 *   const career = require("../career");
 *   career.subscribe(career.CAREER_EVENT_NAMES.CAREER_PROFILE_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /career in app.js. `bootstrap()` seeds the
 * IndustryRole skill taxonomy, wires the live event subscriptions
 * (Student State + Assessment update signals, Learning Path defensively —
 * see events/eventConsumer.js) and two schedulers: a daily safety-net sweep
 * (covers "course completed"/"certificate earned"/"project completed",
 * none of which has a real-time hook anywhere in this codebase) and a
 * monthly industry-taxonomy refresh via ai/jobMarketProvider.js.
 *
 * Future systems (Placement Agent, AI Mentor Agent, Admin Intelligence
 * Agent, Alumni Network, External Job Portals, Resume Builder, Mock
 * Interview System) integrate via `subscribe` or the REST API — never by
 * reaching into this module's internals.
 *
 * ---
 * This agent only analyzes, recommends, and guides — per the constraints,
 * it never applies for jobs on a student's behalf, modifies academic
 * records, alters course content, or replaces a human career counselor.
 * It owns no source-of-truth learning data, only its own career ledger,
 * and reads every peer signal through that agent's own public surface
 * (Assessment's ConceptMastery for technical skills, Student State's
 * performance/engagement scores, Analytics' activity trend, real
 * Certificate rows) — it aggregates the aggregators, it doesn't duplicate
 * a peer's domain logic.
 *
 * Several documented gaps in the current LMS domain shaped this module:
 *
 * 1. None of "Student Skills," "Student Projects," "Certifications"
 *    (external professional certs), or "Resume/Profile" exist as real
 *    models anywhere in this codebase. Technical skills are derived from
 *    Assessment's ConceptMastery (snapshotted into this agent's own
 *    SkillAssessment table); "certifications" ingested are this LMS's own
 *    course-completion Certificate rows, not external professional certs;
 *    there is nothing to read for prior projects or an existing resume —
 *    those recommendation types (PROJECT, CERTIFICATION, RESUME_IMPROVEMENT)
 *    are output-only, never verified against input data that doesn't exist.
 *
 * 2. "Industry Skill Taxonomy" and "Job Market Trends" are not integrated
 *    from any external system — IndustryRole is this agent's own seeded
 *    reference data (constants/industryRoles.seed.js), and
 *    ai/jobMarketProvider.js is a swappable adapter defaulting to that same
 *    static data. A real provider (LinkedIn Talent Insights, Naukri,
 *    Indeed, Glassdoor) implements the same getIndustryTrends() contract
 *    and swaps in with zero changes to the scheduler or service layer.
 *
 * 3. Skill-name matching between a role's required skills and a student's
 *    mastered concepts is normalized-string equality (utils/dedupeKey.util.js#normalizeSkillName)
 *    — there is no canonical skill-ID taxonomy in this LMS to join by ID.
 *
 * 4. The Learning Path Agent referenced in this agent's inputs does not
 *    exist in this codebase yet. The event subscription
 *    (events/eventConsumer.js) is defensive (try/require, no-op if absent).
 */
const bootstrap = () => {
  seedIndustryTaxonomy();
  eventConsumer.start();
  dailySafetySweepScheduler.start();
  industryTaxonomyRefreshScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: careerBus.subscribe.bind(careerBus),
  CAREER_EVENT_NAMES,
  recalculate: careerService.recalculate,
  generateForStudent: careerService.generateForStudent,
  getFullState: careerService.getFullState,
};
