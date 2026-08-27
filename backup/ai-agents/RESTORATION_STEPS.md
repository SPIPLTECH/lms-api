# Restoration Checklist

Companion checklist to `AGENT_RESTORATION_PROMPT.md` (which has the full narrative + dependency-tier ordering). Use this as a literal check-off list during restoration.

- [ ] **1. Restore source** — copy each `source/<agent>/` back to `src/modules/<agent>/`, in dependency-tier order (Observation → Student State → Assessment/Learning Path → Recommendation → Motivation/Career → Teacher Insight/Placement → Analytics → Admin Intelligence → Mentor).
- [ ] **2. Restore dependencies** — confirm `node-cron` and `@anthropic-ai/sdk` are in `package.json` (they may already be present, used by non-agent code); `npm install` if not.
- [ ] **3. Restore database (schema)** — add back the Category A models + Category B enums from `DATABASE.md` into `prisma/schema.prisma`, and the Category C field diffs onto `User`/`StudentProfile`/`Course`. Use `source/schema.prisma.snapshot` as the exact-syntax reference. **Skip `LearningEvent`/`StudentState`/`StudentCourseState`/`ConceptMastery`/`KnowledgeGap` and their 5 enums — these were never removed from the live schema (see `DATABASE.md`'s correction note); adding them again would create duplicate-model errors.**
- [ ] **4. Restore schema** — run `npx prisma format`, `npx prisma validate`, then `npx prisma db push` (**not** `prisma migrate dev`  — this project has no `prisma/migrations/` directory and has never used tracked migrations; `migrate dev` will try to reset the entire database. Use `db push`, review what it reports before confirming, same as the removal did). If you exported table data during removal (`data-export.json` in this backup), re-insert it after the push succeeds.
- [ ] **5. Restore environment variables** — confirm `ANTHROPIC_API_KEY` per `ENVIRONMENT.md` (optional; both consumers have honest fallbacks).
- [ ] **6. Restore configuration** — nothing separate needed; scheduler cron expressions and seed data are hardcoded in the restored source files (see `CONFIGURATION.md`).
- [ ] **7. Restore APIs** — verified by step 1 (routes live inside each module) + step 8.
- [ ] **8. Restore routes** — add each agent's `require(...)` + `app.use("/<path>", <agent>.router)` back to `src/app.js` (12 lines, see `DEPENDENCY_MAP.md`).
- [ ] **9. Restore agent orchestration** — add each agent's `require(...)` + `.bootstrap()` back to `server.js` (11 of 12 — not Observation).
- [ ] **10. Restore frontend integration** — Mentor components/hooks/services, Teacher Insight recommendations/suggestions pages + nav items, AI Student Entry Phase page + service. See `AGENT_RESTORATION_PROMPT.md`'s frontend section for exact file destinations.
- [ ] **11. Restore background jobs** — verified automatically once each module's `bootstrap()` runs (schedulers start themselves); no separate step.
- [ ] **12. Regenerate client** — done in step 4's `db push` implicitly, but re-run `npx prisma generate` explicitly to be sure.
- [ ] **13. Run tests** — none existed for any of the 12 agents at removal time (confirmed during the original audit); if you write new tests during restoration, that's an addition beyond scope — flag it to the user rather than assuming it's expected.
- [ ] **14. Run build** — `npm run build` / equivalent for both `lms-api` and `lms_web_demo` if frontend pieces were restored.
- [ ] **15. Validate every agent** — run through `VALIDATION.md`'s per-agent smoke-test list.
- [ ] **16. Validate Mentor orchestration** — confirm the LIVE path (`/mentor/conversations/*`) works end-to-end. If the user has explicitly asked to also wire in the dormant orchestrator (`chat`/`streamChat` exports → a real route), validate that separately and call out clearly that this is new wiring, not a restoration of prior live behavior.
- [ ] **17. Validate Admin Intelligence** — confirm `GET /admin-intelligence/dashboard` succeeds and its Analytics + Teacher Insight dependency calls (`getPlatformKPIs`, `getCourseKPIsBatch`, `getInstructorKPIsBatch`, `getTeacherDashboard`) resolve without error.

## Final safety check (mirrors the original removal's own checklist)

**Restoration**
- [ ] All 12 agents restored from `source/`
- [ ] Prisma schema fully reconciled against `source/schema.prisma.snapshot`
- [ ] `server.js` and `src/app.js` both updated
- [ ] Frontend pieces restored (Mentor, Teacher Insight pages, Entry Phase)
- [ ] Environment variables confirmed

**Project safety**
- [ ] Backend boots (`node -e "require('./src/app.js')"` succeeds)
- [ ] Frontend builds (if touched)
- [ ] Lint passes
- [ ] No broken imports (`MODULE_NOT_FOUND` anywhere in logs)
- [ ] No broken Prisma relations (`npx prisma validate` clean)
- [ ] Existing non-agent LMS functionality still works (spot-check a few core flows: login, course browsing, enrollment)
