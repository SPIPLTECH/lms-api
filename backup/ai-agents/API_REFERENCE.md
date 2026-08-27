# API Reference — All 12 Agents

Exact request/response shapes are preserved byte-for-byte in each agent's `source/<agent>/dto/*.dto.js` (response shaping) and `source/<agent>/validators/*.validator.js` / `source/<agent>/routes/*.routes.js` (request validation, via `middleware/validateQuery.middleware.js` + Joi/express-validator schemas per route) — restore from those files rather than retyping schemas here, to avoid transcription drift. This document is the endpoint index: method, path, purpose, auth, and cross-agent dependencies.

All agents except Teacher Insight and Admin Intelligence use `verifyToken` + a `resolveStudentAccess`/`resolveStudentContext` middleware (own copy per agent, not shared — see ARCHITECTURE.md).

---

## Observation — `/events`
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| POST | `/` | Record one learning event (called internally via `publishEvent()`, also exposed over HTTP) | verifyToken + resolveStudentContext | none |
| GET | `/student/:studentId` | Raw event history for a student | same | none |
| GET | `/course/:courseId` | Raw event history for a course | same | none |
| GET | `/session/:sessionId` | Raw event history for a session | same | none |
| GET | `/statistics` | Aggregate event statistics | same | none |
| GET | `/today` | Today's events | same | none |

## Student State — `/student-state`
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/dashboard` | Full student-state dashboard | verifyToken + resolveStudentAccess | observation |
| GET | `/progress` | Progress slice | same | observation |
| GET | `/performance` | Performance slice | same | observation |
| GET | `/engagement` | Engagement slice | same | observation |
| GET | `/behavior` | Behavior slice | same | observation |
| GET | `/risk` | Risk slice | same | observation |
| GET | `/course/:courseId` | Per-course baseline (Entry Phase) | same | observation |
| POST | `/recalculate` | Force recompute | same | observation |
| GET | `/:studentId` | Catch-all get-by-id (must stay last) | same | observation |

## Assessment — `/assessment` (+ sub-router `/assessment/entry`)
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/mastery` | Concept mastery list | verifyToken + resolveStudentAccess | observation, student-state |
| GET | `/history` | Assessment history | same | " |
| GET | `/knowledge-gaps` | Knowledge gaps | same | " |
| GET | `/recommendations` | Assessment-driven recommendations | same | " |
| GET | `/reassessment-plan` | Current reassessment plan | same | " |
| POST | `/evaluate` | Evaluate a submitted assessment | same | " |
| POST | `/recalculate` | Force recompute | same | " |
| GET | `/:studentId` | Catch-all | same | " |
| POST | `/entry/:courseId/generate` | Generate Entry Phase assessment (LLM or fallback) | same | ANTHROPIC_API_KEY (optional) |
| GET | `/entry/:courseId` | Get current entry assessment | same | |
| POST | `/entry/:courseId/submit` | Submit entry assessment answers | same | |
| GET | `/entry/:courseId/result` | Get entry assessment result | same | |

## Recommendation — `/recommendations`
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/today` | Today's recommendations | verifyToken + resolveStudentAccess | observation, student-state, assessment |
| GET | `/high-priority` | High-priority only | same | " |
| GET | `/revision` | Revision-type recommendations | same | " |
| GET | `/learning` | Learning-type recommendations | same | " |
| POST | `/recalculate` | Force recompute | same | " |
| POST | `/feedback` | Record user feedback on a recommendation | same | " |
| GET | `/:studentId` | Catch-all | same | " |

## Motivation — `/motivation`
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/reminders` | Active reminders | verifyToken + resolveStudentAccess | student-state, recommendation |
| GET | `/streak` | Current streak | same | " |
| GET | `/actions` | Motivation actions | same | " |
| GET | `/history` | History | same | " |
| POST | `/recalculate` | Force recompute | same | " |
| POST | `/acknowledge` | Acknowledge a reminder/action | same | " |
| GET | `/:studentId` | Catch-all | same | " |

## Teacher Insight — `/teacher-insights` (course/instructor-scoped, NOT student-facing)
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/students-at-risk` | At-risk students for a course | verifyToken + resolveTeacherAccess/resolveCourseAccess | student-state, assessment, recommendation, motivation, observation |
| GET | `/course-health` | Course health score | same | " |
| GET | `/class-performance` | Class performance breakdown | same | " |
| GET | `/recommendations` | Teaching recommendations | same | " |
| GET | `/weekly-summary` | Weekly summary | same | " |
| GET | `/monthly-summary` | Monthly summary | same | " |
| POST | `/recalculate` | Force recompute | same | " |
| GET | `/course/:courseId` | By course | same | " |
| GET | `/:teacherId` | By teacher | same | " |

## Analytics — `/analytics` (read-only)
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/dashboard` | General dashboard | verifyToken + resolveAnalyticsAccess/resolveScopeAccess | student-state, assessment, recommendation, motivation, teacher-insights, observation |
| GET | `/student/:studentId` | Student-scope KPIs | same | " |
| GET | `/instructor/:instructorId` | Instructor-scope KPIs | same | " |
| GET | `/course/:courseId` | Course-scope KPIs | same | " |
| GET | `/platform` | Platform-scope KPIs | same | " |
| GET | `/kpis` | Raw KPI list | same | " |
| GET | `/reports` | Generated reports | same | " |
| GET | `/trends` | Trend detection | same | " |
| GET | `/forecast` | Linear-regression forecast | same | " |
| POST | `/recalculate` | Force recompute | same | " |
| POST | `/report/export` | Export report (JSON/CSV only — no PDF lib in repo) | same | " |

## Career Guidance — `/career`
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/profile/:studentId` | Career profile | verifyToken + resolveStudentAccess | student-state, assessment |
| GET | `/readiness` | Readiness score | same | " |
| GET | `/roles` | Industry role catalog (seeded, 10 roles) | same | " |
| GET | `/roadmap` | Career roadmap | same | " |
| GET | `/skill-gaps` | Skill gaps vs. target role | same | " |
| GET | `/recommendations` | Career recommendations | same | " |
| GET | `/interview-plan` | Interview prep plan | same | " |
| POST | `/recalculate` | Force recompute | same | " |
| POST | `/goal` | Set/update career goal | same | " |

## Learning Path — `/learning-path`
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/next` | Next lesson to study | verifyToken + resolveStudentAccess | student-state |
| GET | `/daily-plan` | Daily study plan | same | " |
| GET | `/weekly-plan` | Weekly study plan | same | " |
| GET | `/recommendations` | Path recommendations | same | " |
| GET | `/milestones` | Milestones | same | " |
| POST | `/recalculate` | Force recompute | same | " |
| GET | `/:studentId` | Catch-all | same | " |

## Placement — `/placement`
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/jobs` | Job opportunity catalog (seeded) | verifyToken + resolveStudentAccess | career, assessment, student-state |
| GET | `/internships` | Internship catalog (seeded) | same | " |
| GET | `/drives` | Placement drive catalog (seeded) | same | " |
| GET | `/matches` | Job matches for student | same | " |
| GET | `/applications` | Application history | same | " |
| GET | `/interviews` | Interview history | same | " |
| GET | `/offers` | Offer history | same | " |
| POST | `/recalculate` | Force recompute | same | " |
| POST | `/application` | Submit an application | same | " |
| GET | `/profile/:studentId` | Placement profile | same | " |

## Admin Intelligence — `/admin-intelligence` (ADMIN-only)
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| GET | `/dashboard` | Institution dashboard | verifyToken + resolveAdminAccess | analytics, teacher-insights, student-state |
| GET | `/institution-health` | Institution health score | same | " |
| GET | `/departments` | Department analytics (Course.category proxy) | same | " |
| GET | `/faculty` | Faculty analytics (instructor Users proxy) | same | " |
| GET | `/student-risk` | Institution-wide student risk | same | " |
| GET | `/compliance` | Compliance audit ledger | same | " |
| GET | `/reports` | Executive reports | same | " |
| GET | `/forecasts` | Capacity forecasts | same | " |
| GET | `/alerts` | Admin alerts | same | " |
| POST | `/recalculate` | Force recompute | same | " |
| POST | `/report/export` | Export executive report | same | " |

## Mentor — `/mentor` (LIVE routes only — see ARCHITECTURE.md for the dormant orchestrator's designed-but-unwired route set)
| Method | Path | Purpose | Auth | Depends on |
|---|---|---|---|---|
| POST | `/conversations` | Create a conversation | verifyToken + checkRole(STUDENT/INSTRUCTOR/ADMIN) + mentorRateLimiter | none (live path calls no other agent) |
| GET | `/conversations` | List user's conversations | same | none |
| GET | `/conversations/:conversationId/messages` | Get messages in a conversation | same | none |
| POST | `/conversations/:conversationId/messages` | Send a message (non-streaming) | same | src/modules/llm (Ollama, shared, not agent-exclusive) |
| POST | `/conversations/:conversationId/messages/stream` | Send a message (SSE streaming) | same | same |

**Dormant orchestrator's designed routes** (functions exist in `services/mentor.service.js`, never wired to a route file — see ARCHITECTURE.md): `POST /chat`, `POST /stream`, `GET /history`, `GET /context`, `GET /recommendations`, `GET /conversation/:id` (get/delete), `POST /feedback`. If restoration wires these in, they would depend on all 11 other agents via `orchestrator/agentSelector.js` (exact per-role/intent call table in `ARCHITECTURE.md`).

## Internal (non-HTTP) agent-to-agent calls, for completeness

These are function calls through each agent's `index.js` public surface, not HTTP requests — listed because a restoration must also restore this wiring, not just the routes:

- `admin-intelligence` → `analytics.getPlatformKPIs()`, `analytics.getCourseKPIsBatch(courseIds)`, `analytics.getInstructorKPIsBatch(instructorIds)`, `teacherInsights.getTeacherDashboard(instructorId)`
- `mentor` (dormant orchestrator only) → see the full (role, intent) table in `ARCHITECTURE.md`
- Every agent's `events/eventConsumer.js` → `subscribe(EVENT_NAME, handler)` calls into whichever peer agents it listens to (full list per agent in `DEPENDENCY_MAP.md`)
