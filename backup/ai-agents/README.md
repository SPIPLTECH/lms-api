# AI Agent System — Removal Backup

This directory is a complete backup of the 12-agent AI system that was removed from `lms-api` (and its two small frontend integration points in `lms_web_demo`) to temporarily simplify the LMS. It contains everything needed to rebuild the system exactly as it worked at removal time.

**If you just want to restore the agents:** hand `AGENT_RESTORATION_PROMPT.md` to Claude Code as your prompt. It's self-contained and references every other file in here.

## What's in this backup

| File | Contents |
|---|---|
| `ARCHITECTURE.md` | The full system design — how the 12 agents fit together, the verified dependency graph, and the important discovery that Mentor has two coexisting implementations (a live simple chat, and a dormant fully-built 11-agent orchestrator that nothing currently calls). Start here. |
| `DEPENDENCY_MAP.md` | Per-agent breakdown (files/services/routes/database/APIs/frontend/dependencies), plus the shared-vs-agent-specific classification that governed what got touched during removal. |
| `DATABASE.md` | Every Prisma model and enum by agent, plus the exact field-level diffs removed from the shared `User`/`StudentProfile`/`Course` models. |
| `API_REFERENCE.md` | Every HTTP endpoint across all 12 agents — method, path, purpose, auth, cross-agent dependencies. |
| `ENVIRONMENT.md` | Env vars used by the agents (no real secret values — placeholders only). |
| `CONFIGURATION.md` | Every scheduler/cron job, and the seeded reference data (industry roles, job catalog, prompt templates). |
| `PROMPTS.md` | The exact LLM prompt text for both Mentor subsystems and Assessment's Entry Phase question generator. |
| `AGENT_RESTORATION_PROMPT.md` | **The self-contained prompt to give a future Claude Code session to do the actual restoration.** |
| `RESTORATION_STEPS.md` | A literal step-by-step checklist companion to the prompt above. |
| `VALIDATION.md` | Post-restoration smoke tests, per agent and cross-agent. |
| `MANIFEST.md` | Complete, programmatically-generated listing of every file under `source/`. |
| `source/` | The actual, verbatim source code for all 12 agent modules, plus the two frontend integration points (Mentor UI + Teacher Insight pages + AI Student Entry Phase), plus a full `schema.prisma` snapshot taken before removal, plus a copy of the original `docs/AI_AGENTS.md`/`.pdf` design doc. |
| `data-export.json` | Raw-SQL row dump of all 354 rows that existed across the 80 dropped tables at removal time (see `DATABASE.md`'s "Migration procedure" — the physical `DROP TABLE` step itself was deliberately left for a human to run). |

## The 12 agents (one line each — full detail in `ARCHITECTURE.md`)

1. Observation — raw event log
2. Student State — progress/performance/engagement/behavior/risk aggregate
3. Assessment — concept mastery, knowledge gaps
4. Recommendation — ranked "what to do next" list
5. Motivation — disengagement detection, reminders, streaks
6. Teacher Insight — course/instructor-scoped dashboard
7. Analytics — read-only cross-cutting KPIs/trends/forecasts
8. Career Guidance — skill-to-role mapping, roadmaps
9. Learning Path — lesson order/pacing personalization
10. Placement — job/internship matching
11. Admin Intelligence — institution-wide view, sits above Analytics
12. Mentor — conversational layer (see the live/dormant caveat in `ARCHITECTURE.md`)

## What this backup does NOT include

- **Table data.** This backup preserves database *structure* (models, fields, relations) exactly, not the rows that existed in those tables before removal. See `DATABASE.md`'s "Migration procedure" section for what to check before removing agent tables in an environment with real data.
- **Any real secrets.** `ENVIRONMENT.md` lists variable names and purposes only.
- **Tests.** None existed for any of the 12 agents at removal time — this is a documented fact, not an omission from this backup.

## Provenance

This backup was created by an AI-assisted audit of the live codebase immediately before removal (not from the project's own `docs/AI_AGENTS.md` alone — that file is included verbatim in `source/AI_AGENTS.md`/`.pdf` as the authoritative *design* reference, but this backup's `ARCHITECTURE.md` corrects it in the one place it was found to disagree with actual runtime behavior — see "Mentor: designed vs. live"). Where something couldn't be determined with confidence from the source code, it's marked `UNKNOWN — REQUIRES MANUAL VERIFICATION` rather than guessed.
