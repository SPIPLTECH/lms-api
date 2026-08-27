# AI Agent System — Architecture

This document describes the 12-agent AI system as it actually existed in `lms-api` at the time of removal. It combines the project's own authoritative design doc (`source/AI_AGENTS.md`, copied verbatim from `lms-api/docs/AI_AGENTS.md`) with facts verified directly against the source code during the removal audit. Where the two disagree, this document says so explicitly — see "Mentor: designed vs. live" below, which is the single most important correction to the original doc.

## What "agent" means here

Not a separately-deployed AI microservice. Each of the 12 is a self-contained module under `src/modules/<name>/` with its own routes, services, repositories, Prisma models, and in-process `EventEmitter` event bus. Only the Mentor agent calls an LLM in its fully-designed form; the rest are deterministic — rule engines, scoring formulas, and statistics over real LMS data.

## The 12 agents and how they fit together

```
Observation Agent (raw event log)
        │  publishes events
        ▼
Student State Agent  ──┐
        │               │
        ▼               │
Assessment Agent  ◄──────┘
        │
        ├──► Recommendation Agent ──► Motivation Agent
        │
        ├──► Teacher Insight Agent (course/teacher-scoped)
        │
        ├──► Career Guidance Agent ──► Placement Agent
        │
        └──► Learning Path Agent

Analytics Agent          — aggregates all of the above (student/instructor/course/platform)
Admin Intelligence Agent — aggregates Analytics + Teacher Insight + Student State (institution-wide)
Mentor Agent             — conversational layer, DESIGNED to query all 11 others + an LLM
                            (see "Mentor: designed vs. live" — this part was not actually wired up)
```

Communication rule (by design, followed everywhere except where noted): every agent past Observation talks to its peers only through the peer's own `index.js` public surface (`subscribe(eventName, handler)` + a handful of named getters like `getFullState(studentId)`) — never by reaching into another module's internals. Each agent owns its own event bus rather than sharing one.

## Verified dependency graph (hard `require()` edges, confirmed by source audit)

Every edge below is a **top-level, non-defensive** `require()` — i.e. deleting the target module breaks the source module's `require()` at boot time (`MODULE_NOT_FOUND`), not just a runtime call.

```
observation          ← student-state, assessment, recommendation, motivation,
                         teacher-insights, analytics, career, mentor
student-state         ← assessment, recommendation, motivation, teacher-insights,
                         analytics, career, placement, admin-intelligence,
                         learning-path, mentor
assessment            ← recommendation, teacher-insights, analytics, career,
                         placement, mentor
recommendation        ← motivation, teacher-insights, analytics, placement, mentor
learning-path         ← mentor (hard); assessment, recommendation, motivation,
                         teacher-insights, analytics, career (all via a defensive
                         try/require pattern — see note below)
motivation            ← teacher-insights, analytics, mentor
teacher-insights      ← analytics, admin-intelligence, mentor
analytics             ← admin-intelligence, career (broken call, see Known Gaps), mentor
career                ← placement, mentor
placement             ← mentor (only)
admin-intelligence    ← mentor (only)
mentor                ← (nobody — top of the stack, pure consumer, publishes nothing)
```

**`learning-path` defensive-require note:** six modules (assessment, recommendation, motivation, teacher-insights, analytics, career) wrap their `require("../../learning-path")` in `try { } catch { }`, because at the time those six were built, Learning Path didn't exist yet and its doc comments say so. Learning Path was built later and does exist now, so all six `try/require` blocks now succeed at runtime and actually subscribe to `learning-path:updated` — this is live behavior today even though the original per-module doc comments call it a future/optional integration.

**Admin Intelligence → Analytics** (the relationship the removal task specifically called out): `admin-intelligence/services/context/institutionContextBuilder.js` calls exactly `analytics.getPlatformKPIs()`, `analytics.getCourseKPIsBatch(courseIds)`, `analytics.getInstructorKPIsBatch(instructorIds)`, and subscribes to `analytics.ANALYTICS_EVENT_NAMES.ANALYTICS_UPDATED`. It also depends on Teacher Insight the same way (`getTeacherDashboard`, `TEACHER_INSIGHT_EVENT_NAMES`).

## Mentor: designed vs. live (important correction to `docs/AI_AGENTS.md`)

The original design doc describes Mentor as the orchestrator that "queries all 11 others + an LLM." **That subsystem is fully built but was not actually reachable by any HTTP request in the running app.** Two separate, non-overlapping implementations coexist inside `src/modules/mentor/`:

### The dormant, fully-designed orchestrator (matches the doc)
- `orchestrator/agentSelector.js` + `orchestrator/index.js#runTurn` — the (role, intent) → [agent calls] table, full pipeline (intent detection → parallel agent execution via `Promise.allSettled` → context merge → prompt construction → LLM call → persist).
- `context-engine/`, `intent-engine/`, `memory/`, `prompt-builder/`, `llm/anthropicProvider.js` + `llm/fallbackProvider.js` (real `@anthropic-ai/sdk`, model `claude-sonnet-4-5`, gated on `ANTHROPIC_API_KEY`), all 8 Prisma repositories, `dto/mentorResponse.dto.js`, `services/mentor.service.js` (note: **inside `services/`**, distinct from the root-level file of the same name).
- `index.js` exports `chat`/`streamChat` bound to this subsystem. **Nothing in the codebase calls `mentor.chat(...)` or `mentor.streamChat(...)`.** This is real, complete, working code with no path to execution from a real request.

### The live, simpler implementation (what `/mentor/*` and the frontend actually use)
- Root-level `mentor.routes.js` → `mentor.controller.js` → root `mentor.service.js` (same directory as the module root, different file from `services/mentor.service.js` above) → `mentorPrompt.builder.js`, `mentor.validation.js`, `tools/{student,instructor,admin}.tools.js` + `tools/tool.registry.js`.
- LLM call goes through `src/modules/llm/llm.service.js` — a separate, platform-wide, **Ollama**-based service (`ollamaClient.chat()`), not Anthropic and not gated on `ANTHROPIC_API_KEY`.
- The live tool registry only calls into `dashboard`, `learner-model`, `quizzes`, `results` — **it never calls any of the other 11 agents.** The cross-agent orchestration described in the design doc simply does not execute today.
- Real mounted routes (all behind `verifyToken` + `checkRole(["STUDENT","INSTRUCTOR","ADMIN"])` + `mentorRateLimiter`):
  - `POST /mentor/conversations` — createConversation
  - `GET /mentor/conversations` — getUserConversations
  - `GET /mentor/conversations/:conversationId/messages` — getConversationMessages
  - `POST /mentor/conversations/:conversationId/messages` — sendMessage
  - `POST /mentor/conversations/:conversationId/messages/stream` — sendMessageStream (the real SSE endpoint)
- The doc-comment-described routes (`POST /mentor/chat`, `POST /mentor/stream`, `GET /mentor/history`, `GET /mentor/context`, `GET /mentor/recommendations`, `GET /mentor/conversation/:id`, `DELETE /mentor/conversation/:id`, `POST /mentor/feedback`) exist only as unreachable functions in `services/mentor.service.js` — no route file wires them to HTTP.
- This is exactly what `lms_web_demo`'s `MentorWindow.jsx`/`mentor.service.js` (frontend) actually calls, and it's the feature real users experience.

**Implication for restoration:** a future "restore Mentor exactly as it was" must restore *both* subsystems to reproduce current behavior faithfully — the live simple chat, and the dormant orchestrator sitting unused beside it — rather than "fixing" the wiring gap, unless a human explicitly decides to wire the orchestrator in as an improvement (that would be a deliberate enhancement, not a restoration).

## Known gaps / latent issues discovered during this audit (not fixed, documented for honesty)

- **`career` → `analytics.getByStudent(studentId)`**: `career/services/context/studentContextBuilder.js` calls `analytics.getByStudent(...)`, but `analytics/index.js` exports no such function (only `getPlatformKPIs`, `getCourseKPIsBatch`, `getInstructorKPIsBatch`, `recalculate`, `generateForScope`). The call is wrapped in try/catch, so it silently returns null — Career's "activity trend from Analytics" context slice is a silent no-op today. Not fixed; documented as-found.
- **Admin Intelligence's schema-comment claim**: `admin-intelligence/index.js`'s header comment implies `schema.prisma` has doc-comment blocks tying models to this agent; no such section-header comments actually exist in `schema.prisma` for any of the 12 agents (verified directly) — the agent-to-model mapping in this backup is derived purely from `prisma.<model>`/`client.<model>` call-site evidence in each module's own source, which is unambiguous.

## Per-agent one-line summaries (from `source/AI_AGENTS.md`, verified accurate for scope/purpose — see that file for full detail and each agent's own "Honest gaps" section)

1. **Observation** (`/events`) — the raw event log every other agent is built on.
2. **Student State** (`/student-state`) — progress/performance/engagement/behavior/risk aggregate per student; also the per-course `StudentCourseState` baseline used by the AI Student Entry Phase.
3. **Assessment** (`/assessment`) — concept-level mastery, knowledge gaps, reassessment scheduling; also owns the Entry Phase's assessment flow at `/assessment/entry/*`.
4. **Recommendation** (`/recommendations`) — ranks Assessment's gaps + Student State's risk into a capped "what to do next" list.
5. **Motivation** (`/motivation`) — disengagement detection, reminders/nudges, streaks.
6. **Teacher Insight** (`/teacher-insights`) — the one course/instructor-scoped agent; at-risk students, course health, class performance.
7. **Analytics** (`/analytics`) — read-only cross-cutting KPIs/trends/forecasts across student/instructor/course/platform scopes.
8. **Career Guidance** (`/career`) — maps demonstrated skills (from Assessment) against a seeded industry-role taxonomy; roadmap generation.
9. **Learning Path** (`/learning-path`) — personalizes lesson order/pacing, daily/weekly study plans.
10. **Placement** (`/placement`) — job/internship matching against a seeded catalog, application/interview tracking.
11. **Admin Intelligence** (`/admin-intelligence`) — institution-wide view above Analytics + Teacher Insight; ADMIN-only.
12. **Mentor** (`/mentor`) — see "Mentor: designed vs. live" above.

## AI Student Entry Phase (cross-cutting, not one of the 12)

Triggered by course enrollment, not any agent's own event bus. Spans `StudentProfile`, Assessment, Student State, and (by design) Learning Path:
1. Student enrolls → a 15-question entry assessment (5 easy/5 medium/5 hard) generates, scoped to the course's real module titles — LLM-generated if `ANTHROPIC_API_KEY` is set (Assessment agent's own independent Anthropic integration, separate from Mentor's), else sampled from the course's real quiz questions.
2. Answers evaluate into per-concept mastery (`/assessment/entry/:courseId/...`).
3. Student State initializes a per-course baseline (`StudentCourseState`) and assigns a learning mode (Smart Revision / Standard / Deep Learning) per module.
4. Learning Path personalizes lesson duration from that mode.

Frontend: `src/app/student/entry-assessment/[courseId]/page.jsx`, backed by `src/services/entryAssessment.service.js` — has a "skip for now" escape hatch so a failed/unavailable assessment never blocks course access. This flow is genuinely user-facing and depends on 2 of the 12 removed agents; see `RESTORATION_STEPS.md` for how it was handled during removal.

## Shared architectural pattern (every agent, no exceptions)

- Own `EventEmitter` bus per module (not shared).
- Own copies of near-identical middleware (`resolveStudentAccess`, `validateQuery`) rather than a shared one.
- Consistent layering: `constants/ types/ utils/ services/ repositories/ dto/ events/ schedulers/ middleware/ validators/ controllers/ routes/`. Pure domain logic lives in `services/domain/`.
- Cross-agent reads only through another module's `index.js` surface — except where noted above (Mentor's dormant orchestrator would follow this too, if it were reachable).
- Each agent's `bootstrap()` is called once in `server.js` (11 of 12 — Observation has no bootstrap, it's stateless); its router is mounted in `src/app.js`.
