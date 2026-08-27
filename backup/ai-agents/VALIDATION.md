# Validation — Post-Restoration Smoke Tests

Run after completing `RESTORATION_STEPS.md`. No automated tests existed for any of the 12 agents at removal time (confirmed via repo-wide search of `test/` and every module's own directory) — these are manual/scripted smoke checks, not a pre-existing suite to re-run.

## 1. Boot check
```bash
node -e "require('./src/app.js'); console.log('OK')"
```
Must print `OK` with no `MODULE_NOT_FOUND`. If it fails, the error names the missing module — check that module was restored and its dependency-tier predecessors were restored first (see `AGENT_RESTORATION_PROMPT.md`'s tier order).

## 2. Schema check
```bash
npx prisma validate
```
Must pass clean. Then confirm row counts on a couple of seed tables after migration + first boot:
```sql
SELECT COUNT(*) FROM "IndustryRole";      -- expect 10
SELECT COUNT(*) FROM "Company";           -- expect 6
SELECT COUNT(*) FROM "JobOpportunity";    -- expect 9
SELECT COUNT(*) FROM "InternshipOpportunity"; -- expect 5
SELECT COUNT(*) FROM "PlacementDrive";    -- expect 2
SELECT COUNT(*) FROM "PromptTemplate";    -- expect 5
```

## 3. Per-agent HTTP smoke test

Requires a valid JWT for a real STUDENT (and separately INSTRUCTOR, ADMIN for the role-scoped agents). Replace `$TOKEN`/`$STUDENT_ID`/`$COURSE_ID`/`$INSTRUCTOR_ID`.

| Agent | Smoke request | Expect |
|---|---|---|
| Observation | `POST /events` with `{studentId, eventType:"LOGIN", ...}` | 200/201, row appears in `LearningEvent` |
| Student State | `GET /student-state/dashboard` (as the student) | 200, well-formed dashboard JSON |
| Assessment | `GET /assessment/mastery` | 200 (empty array is fine if no events processed yet) |
| Recommendation | `GET /recommendations/today` | 200 |
| Motivation | `GET /motivation/streak` | 200 |
| Teacher Insight | `GET /teacher-insights/course/$COURSE_ID` (as the owning instructor) | 200; as a different instructor → 403 |
| Analytics | `GET /analytics/platform` (any authorized role) | 200, read-only — confirm no write side effects |
| Career | `GET /career/roles` | 200, 10 seeded roles |
| Learning Path | `GET /learning-path/next` | 200 |
| Placement | `GET /placement/jobs` | 200, 9 seeded jobs |
| Admin Intelligence | `GET /admin-intelligence/dashboard` (as ADMIN) | 200; as STUDENT/INSTRUCTOR → 403 |
| Mentor | `POST /mentor/conversations` then `POST /mentor/conversations/:id/messages` with a real question | 200/201; reply arrives, either from Ollama (live path) or the fallback if `src/modules/llm` is unreachable |

## 4. Cross-agent wiring checks (the things most likely to silently break)

- **Event propagation**: trigger a `POST /events` with `eventType` that Student State listens for (e.g. `QUIZ_COMPLETED`), then poll `GET /student-state/dashboard` a few seconds later — confirm the state actually updated (proves the `observation → student-state` event subscription is live, not just that both modules loaded).
- **Admin Intelligence → Analytics**: `GET /admin-intelligence/dashboard` must not error even if Analytics has no data yet — confirm it degrades gracefully (per `services/context/institutionContextBuilder.js`'s design) rather than 500ing.
- **Mentor live path**: confirm it does NOT attempt to call any of the other 11 agents (check server logs during a chat request — if you see agent-call logs from `orchestrator/agentSelector.js`, something restored the dormant path's wiring into the live route by mistake, which is a behavior change from what was backed up, not a faithful restoration).
- **AI Student Entry Phase**: enroll a fresh test student in a course, confirm `POST /assessment/entry/:courseId/generate` succeeds (LLM-generated if `ANTHROPIC_API_KEY` set, else sampled from real quiz questions — confirm it does NOT fabricate MCQs when neither source has enough questions; it should return a `FAILED` status honestly in that case, per the documented behavior) and that the frontend's "skip for now" escape hatch still works if the assessment fails.
- **Career's known broken call**: `GET /career/profile/:studentId` should still succeed even though `analytics.getByStudent()` doesn't exist (the call is caught) — confirm this documented gap still behaves as a silent no-op, not a 500.

## 5. Non-agent regression check

Spot-check that restoring the 12 agents didn't disturb anything else:
- Login/auth still works
- Course browsing/enrollment still works
- The human-to-human chat feature (`modules/conversations` + `modules/messages`, socket.io) still works — confirm no accidental collision with `MentorConversation`/`MentorMessage` (similarly named, but confirmed separate models — see `ARCHITECTURE.md`'s naming-collision note)
- `course-import`'s LLM provider still works if `ANTHROPIC_API_KEY` is set (shares the env var with Assessment/Mentor but is a separate, non-agent code path)

## 6. Report format

When validation is complete, report: which of the above passed, which failed (with the exact error), and which couldn't be tested (e.g. no `ANTHROPIC_API_KEY` available in this environment — note what was validated via the fallback path instead).
