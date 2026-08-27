# Master Restoration Prompt

Give this entire file to Claude Code as your prompt when you're ready to restore the 12-agent AI system into this LMS. It is self-contained — it does not assume you remember why the agents were removed or what this backup contains.

---

## Prompt begins here

You are restoring a previously-removed AI agent system into this LMS backend (`lms-api`) and, where applicable, its frontend (`lms_web_demo`). A complete backup exists at `lms-api/backup/ai-agents/`. **Do not redesign these agents. Restore them according to the backed-up architecture and behavior exactly, unless the user explicitly instructs otherwise in this conversation.** If you find yourself wanting to "improve," "clean up," or "modernize" something while restoring it, stop and ask the user first — that's a design decision, not a restoration task.

### Before you start

1. Read, in this order:
   - `backup/ai-agents/README.md` — orientation.
   - `backup/ai-agents/ARCHITECTURE.md` — the full system design, including the important "Mentor: designed vs. live" section (the Mentor agent has two coexisting implementations — a live simple chat and a dormant, fully-built 11-agent orchestrator that nothing currently calls; restore both, don't merge or "fix" the gap between them unless asked).
   - `backup/ai-agents/DEPENDENCY_MAP.md` — exact per-agent file/service/route/database/dependency breakdown, plus the Phase-2-style A/B/C classification (agent-specific / shared-infrastructure / mixed-shared) that governed what was and wasn't touched during removal.
   - `backup/ai-agents/DATABASE.md` — every Prisma model/enum to restore, plus the exact field-level diffs that were removed from the shared `User`/`StudentProfile`/`Course` models (you'll be reversing those diffs).
   - `backup/ai-agents/API_REFERENCE.md` — every HTTP endpoint, method, auth requirement, and cross-agent dependency.
   - `backup/ai-agents/ENVIRONMENT.md`, `backup/ai-agents/CONFIGURATION.md`, `backup/ai-agents/PROMPTS.md` — env vars, cron schedules/seed data, and exact LLM prompt text.
   - `backup/ai-agents/MANIFEST.md` — the complete file listing, to confirm nothing is missing before you finish.
2. Check `git status` and current branch, per the standard git-safety rules — don't restore on top of unrelated uncommitted work without checking first.
3. Confirm what state the current codebase is in: are any of the 12 agent directories partially present? Is the Prisma schema already back to its pre-removal state, or does it still have the agent models/fields removed? Don't assume — check.

### Restoration order (dependency-driven — follow this exactly, do not restore out of order)

The 12 agents form a hard-require dependency chain (see `DEPENDENCY_MAP.md` for the full graph). Restoring out of order will cause `MODULE_NOT_FOUND` errors the moment you `require()` a module whose dependency isn't back yet. Tier order:

1. **Tier 0 (no agent dependencies):** Observation
2. **Tier 1 (depends only on Tier 0):** Student State
3. **Tier 2:** Assessment, Learning Path (both depend on Student State; Learning Path only)
4. **Tier 3:** Recommendation (depends on Observation, Student State, Assessment)
5. **Tier 4:** Motivation, Career (Motivation depends on Student State + Recommendation; Career depends on Student State + Assessment)
6. **Tier 5:** Teacher Insight, Placement (Teacher Insight depends on Student State/Assessment/Recommendation/Motivation/Observation; Placement depends on Career/Assessment/Student State)
7. **Tier 6:** Analytics (depends on Student State/Assessment/Recommendation/Motivation/Teacher Insight/Observation)
8. **Tier 7:** Admin Intelligence (depends on Analytics + Teacher Insight + Student State)
9. **Tier 8:** Mentor (depends on all 11 others — restore last)

Within each tier, restore in the order listed. For each agent, in this exact sequence:
1. Copy `backup/ai-agents/source/<agent>/` back to `src/modules/<agent>/` verbatim.
2. Add its Prisma models + enums back into `prisma/schema.prisma` (from `DATABASE.md` Category A/B — use `source/schema.prisma.snapshot` as the exact source of truth for field syntax).
3. Add back this agent's specific fields onto `User`/`StudentProfile`/`Course` (from `DATABASE.md` Category C — only this agent's fields, not all of them yet, if you're restoring incrementally; if restoring all 12 at once, you can just replace the three models wholesale from the snapshot).
4. Add the `require(...)` + `app.use(...)` pair back to `src/app.js` (exact lines are in `DEPENDENCY_MAP.md`'s cross-cutting section / were originally at `src/app.js:51-62` and `:153-164`).
5. Add the `require(...)` + `.bootstrap()` call back to `server.js` (all except Observation, which has no bootstrap).
6. Run `npx prisma format && npx prisma validate` after each tier (not each agent) to catch schema errors early.

After all 12 tiers: run `npx prisma format`, `npx prisma validate`, then `npx prisma db push` — **not** `prisma migrate dev`. This project has no `prisma/migrations/` directory and has never used Prisma's tracked-migration workflow; `migrate dev` will detect unmanaged drift and try to reset the *entire* database (confirmed the hard way during removal — it offered to drop all 131 tables, not just the agent ones, and was aborted before that happened). `db push` is the correct tool and is how this project's schema has always been synced. Review what it reports before confirming any data-loss prompt. Then run `npx prisma generate`. If `backup/ai-agents/data-export.json` exists, offer to re-insert that data after the push succeeds — it's the real row data from the 80 agent tables at removal time.

Do not re-add `LearningEvent`, `StudentState`, `StudentCourseState`, `ConceptMastery`, or `KnowledgeGap` (or their enums `EventType`/`EventCategory`/`MasteryStatus`/`GapStatus`/`EntryKnowledgeLevel`) to the schema — these were discovered to be shared with non-agent code (`src/modules/learner-model` and others) and were never actually removed. Adding them again will cause duplicate-model errors.

### Frontend restoration

Only two pieces of frontend integration existed (see `ARCHITECTURE.md` and `DEPENDENCY_MAP.md` per-agent `frontend:` lines — everything else had zero frontend wiring, nothing to restore there):

1. **Mentor** — copy back `backup/ai-agents/source/_frontend/components/mentor/`, `services/mentor.service.js`, `hooks/mentor/useMentorQueries.js`, `constants/mentorSuggestions.js`, `utils/mentorConversation.js` into their original `lms_web_demo/src/...` locations. Re-add the `<MentorWidget />` render in `DashboardLayout.jsx` and the mentor integration in `student/learn/[courseId]/page.jsx` (check `RESTORATION_STEPS.md` for exactly what was removed there).
2. **Teacher Insight** — copy back `services/teacherInsight.service.js`, `hooks/instructor/useTeacherInsights.js`, and the `app-instructor-recommendations`/`app-instructor-suggestions` page directories (rename back to `src/app/instructor/recommendations/` and `src/app/instructor/suggestions/`). Re-add the nav items in `NavigationStrip/navigationItems.ts`.
3. **AI Student Entry Phase** — copy back `entry-assessment/entryAssessment.service.js` → `src/services/entryAssessment.service.js`, and `entry-assessment/app-entry-assessment/` → `src/app/student/entry-assessment/`. This flow depends on both Assessment and Student State being restored first.

### Environment / configuration

- `ANTHROPIC_API_KEY` — if already set (for course-import's LLM provider), you don't need a new one; both Mentor's dormant path and Assessment's Entry Phase question generation will pick it up automatically. If not set, both have documented honest fallbacks (see `PROMPTS.md`/`ARCHITECTURE.md`) — the system is fully functional without it, just less capable.
- All scheduler cron expressions and seed data are hardcoded in the restored source files — no separate config step needed beyond copying the files back.
- `node-cron` and `@anthropic-ai/sdk` npm packages: check `package.json` — they may still be present (both are also used by non-agent code, `messageCleanup.service.js` and `course-import` respectively, so they may never have been removed even if all 12 agents were). If missing, `npm install node-cron @anthropic-ai/sdk`.

### After restoring all 12 agents

1. `node -e "require('./src/app.js')"` — confirm no `MODULE_NOT_FOUND` at require time.
2. Start the server and confirm it boots without throwing (check for the 11 `bootstrap()` console logs / any startup errors).
3. Run `backup/ai-agents/VALIDATION.md`'s checklist in full.
4. Run the project's lint/build/test commands.
5. Manually smoke-test at least: `POST /events` (Observation), `GET /student-state/dashboard` (Student State — needs a real studentId), `GET /mentor/conversations` (Mentor live path), and if the dormant orchestrator was explicitly wired in per user request, a `POST /mentor/chat` call.
6. Report back exactly what was restored, what (if anything) couldn't be verified, and any deviations from this backup you had to make and why.

### Rules while restoring (same as during removal)

- Never fabricate a file, field, prompt, or endpoint that isn't in this backup. If something referenced in these docs is missing from `source/`, say `UNKNOWN — REQUIRES MANUAL VERIFICATION` rather than inventing it.
- Preserve behavior exactly, including the Mentor live/dormant split and the Career→Analytics broken-call gap documented in `ARCHITECTURE.md`'s "Known gaps" section — don't silently fix them as part of a routine restore.
- Never put real secrets into any file — `ANTHROPIC_API_KEY` etc. stay as environment variables, never hardcoded.
- Don't touch any shared LMS code beyond what's listed in `DEPENDENCY_MAP.md`'s Category B/C.
- Ask before committing anything, per standard git safety rules, unless already instructed otherwise for this restoration.
