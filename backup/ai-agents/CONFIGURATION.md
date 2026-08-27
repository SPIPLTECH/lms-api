# Configuration — Schedulers, Cron Jobs, Thresholds

All cron expressions are hardcoded constants inside each agent's own `constants/` file (not environment variables — see `ENVIRONMENT.md`). All scheduler files use `node-cron` (shared dependency, also used by `src/modules/messages/messageCleanup.service.js` — do not remove the package).

## Scheduler / cron table

| Agent | Scheduler file | Cron | Frequency | Purpose |
|---|---|---|---|---|
| Observation | — | — | none | stateless, no scheduler |
| Student State | `reconciliation.scheduler.js` | `0 * * * *` | hourly | inactivity-risk decay for students active in last 45 days |
| Assessment | `reassessmentDue.scheduler.js` | `*/30 * * * *` | every 30 min | flips PENDING reassessment plans to DUE |
| Recommendation | `deadlineScan.scheduler.js` | `*/30 * * * *` | every 30 min | scans Quiz/Assignment dueDate directly (no Observation event exists for this) |
| Recommendation | `dailyDigest.scheduler.js` | `0 2 * * *` | daily 02:00 | expires stale ACTIVE recs, regenerates for every enrolled student; also covers "new course published"/"goal changed" triggers with no real-time hook |
| Motivation | `reminderDispatch.scheduler.js` | `*/15 * * * *` | every 15 min | dispatches due reminders |
| Motivation | `deadlineScan.scheduler.js` | `*/30 * * * *` | every 30 min | deadline-approaching nudges |
| Motivation | `engagementSweep.scheduler.js` | `0 3 * * *` | daily 03:00 | engagement/burnout sweep |
| Teacher Insight | `dailyClassSweep.scheduler.js` | `0 4 * * *` | daily 04:00 | per-course daily sweep |
| Teacher Insight | `weeklySummary.scheduler.js` | `0 5 * * 1` | Monday 05:00 | weekly summary generation |
| Teacher Insight | `monthlySummary.scheduler.js` | `0 6 1 * *` | 1st of month 06:00 | monthly summary generation |
| Analytics | `courseInstructorSweep.scheduler.js` | `0 * * * *` | hourly | course/instructor KPI sweep |
| Analytics | `platformDailySweep.scheduler.js` | `0 3 * * *` | daily 03:00 | platform sweep + snapshot |
| Analytics | `reportScheduler.js` | `0 5 * * 1` / `0 6 1 * *` / `0 7 1 1,4,7,10 *` / `0 8 1 1 *` | weekly/monthly/quarterly/annual | 4 report-generation crons |
| Career | `dailySafetySweep.scheduler.js` | `0 4 * * *` | daily 04:00 | catches course-completed/certificate-earned/project-completed triggers with no real-time hook |
| Career | `industryTaxonomyRefresh.scheduler.js` | `0 5 1 * *` | monthly (1st) 05:00 | refreshes IndustryRole.industryDemandScore/avgSalary via jobMarketProvider |
| Learning Path | `dailySweep.scheduler.js` | `0 4 * * *` | daily 04:00 | safety net for students with no recent trigger |
| Placement | `dailySweep.scheduler.js` | `0 4 * * *` | daily 04:00 | safety sweep |
| Placement | `catalogRefresh.scheduler.js` | `0 6 * * *` | daily 06:00 | re-seeds/verifies Company/JobOpportunity/InternshipOpportunity/PlacementDrive |
| Admin Intelligence | `dailySweep.scheduler.js` | `0 4 * * *` | daily 04:00 | runs after Analytics' 03:00 sweep, by design |
| Admin Intelligence | `reportScheduler.js` | `WEEKLY_REPORT_CRON` / `MONTHLY_REPORT_CRON` / `QUARTERLY_REPORT_CRON` / `ANNUAL_REPORT_CRON` / `SEMESTER_REPORT_CRON` | 5 crons | executive report generation |
| Mentor | — | — | none | `bootstrap()` only seeds PromptTemplate rows once |

## Bootstrap wiring (`server.js`)

11 of the 12 agents have a `.bootstrap()` call in `server.js` (Observation has none — it's stateless, no scheduler, no event subscriptions of its own). Restoration must re-add each `require(...)` + `.bootstrap()` call pair to `server.js`, matching the original order (dependency order matters for the hard-require chain — see `RESTORATION_STEPS.md`).

## Seeded reference data (idempotent, upserted at bootstrap)

- **Career**: `IndustryRole` — 10 roles, from `constants/industryRoles.seed.js`. Seeded by `career/index.js#bootstrap` → `seedIndustryTaxonomy()`, fails soft pre-migration.
- **Placement**: `Company` (6), `JobOpportunity` (9), `InternshipOpportunity` (5), `PlacementDrive` (2) — from `constants/companies.seed.js` + `constants/opportunities.seed.js`. Seeded by `placement/index.js#bootstrap` → `seedCatalog()`.
- **Mentor**: `PromptTemplate` — 5 rows (SYSTEM_STUDENT, SYSTEM_INSTRUCTOR, SYSTEM_ADMIN, CLARIFYING_QUESTION, FALLBACK_NOTICE), from `constants/promptTemplates.seed.js`. Seeded by `mentor/index.js#bootstrap` → `seedPromptTemplates()` (this is on the **dormant** orchestrator's data path — the live chat path doesn't read `PromptTemplate` at all, it uses the hardcoded `mentorPrompt.builder.js` instead — see `PROMPTS.md`).

All three seed functions are idempotent (safe to call on every boot) and fail soft (log + continue) if called before their tables' migration has run.

## Threshold constants (per-agent tuning — not exhaustive, see each agent's `source/<agent>/constants/thresholds.constants.js` for the complete set)

Every agent has its own `thresholds.constants.js` with domain-specific tuning numbers (mastery thresholds for entry-phase learning-mode assignment, risk score bands, streak-break windows, debounce delays, confidence thresholds for intent classification, etc.). These are numerous and agent-specific enough that transcribing them here would risk drift — restore verbatim from each `source/<agent>/constants/` directory.

One cross-agent constant worth calling out explicitly: **Recommendation's `RECOMPUTE_DEBOUNCE_MS`** — a per-student `setTimeout` debounce so that Observation/Student State/Assessment events arriving in a burst don't each trigger a full recompute; see `source/recommendation/events/eventConsumer.js`.
