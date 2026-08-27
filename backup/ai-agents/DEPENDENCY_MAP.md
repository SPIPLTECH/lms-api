# Dependency Map — Per-Agent Breakdown

Format per agent, as requested:
```
Agent
 ├── files          (directory, file count — full list in source/<agent>/)
 ├── services       (entry-point exports from index.js)
 ├── routes         (HTTP mount + individual paths)
 ├── database       (Prisma models owned)
 ├── APIs           (external: LLM, third-party)
 ├── frontend       (lms_web_demo files that call this agent, if any)
 └── dependencies on other agents  (hard require = breaks at boot if target removed;
                                     defensive = try/catch, degrades gracefully)
```

Also see `Classification` at the end of this file for the Phase 2 shared-vs-agent-specific breakdown the removal was based on.

---

## 1. Observation Agent
```
files:      src/modules/observation/  (21 files, singular controller/repository/service dirs — differs from the other 11's plural convention)
services:   router, publishEvent, subscribe, getStudentEventLog, getEventById, OBSERVATION_EVENT_NAMES, EVENT_TYPES, EVENT_CATEGORIES
routes:     /events — POST /, GET /student/:studentId, GET /course/:courseId, GET /session/:sessionId, GET /statistics, GET /today
database:   LearningEvent, StudentActivityState
APIs:       none
frontend:   none
depends on: (none — root agent, publishes only)
depended on by: student-state, assessment, recommendation, motivation, teacher-insights, analytics, career, mentor (all hard require)
```

## 2. Student State Agent
```
files:      src/modules/student-state/  (37 files)
services:   router, bootstrap, subscribe, STUDENT_STATE_EVENT_NAMES, recalculate, getRiskSnapshot, getFullState, getBatchStates, getHighRiskStudents, initializeCourseState, getCourseState
routes:     /student-state — GET /dashboard, /progress, /performance, /engagement, /behavior, /risk, /course/:courseId, POST /recalculate, GET /:studentId (catch-all, last)
database:   StudentLearningState, StudentProgress, StudentPerformance, StudentEngagement, StudentBehavior, StudentRisk, StudentCourseState
APIs:       none
frontend:   src/services/entryAssessment.service.js → GET /student-state/course/:courseId (AI Student Entry Phase)
scheduler:  reconciliation.scheduler.js — hourly (`0 * * * *`), inactivity-risk decay for students active in last 45 days
depends on: observation (hard, subscribes to EVENT_CREATED)
depended on by: assessment, recommendation, motivation, teacher-insights, analytics, career, placement, admin-intelligence, learning-path, mentor (all hard require)
```

## 3. Assessment Agent
```
files:      src/modules/assessment/  (47 files)
services:   router, bootstrap, subscribe, ASSESSMENT_EVENT_NAMES, recalculate, getFullState, getKnowledgeGaps, getRecommendations, getBatchAssessmentSummary
routes:     /assessment — GET /mastery, /history, /knowledge-gaps, /recommendations, /reassessment-plan, POST /evaluate, POST /recalculate, GET /:studentId (catch-all);
            sub-router /assessment/entry — POST /:courseId/generate, GET /:courseId, POST /:courseId/submit, GET /:courseId/result
database:   Assessment, AssessmentAttempt, AssessmentResult, ConceptMastery, KnowledgeGap, ReassessmentPlan, EntryAssessment
APIs:       @anthropic-ai/sdk (own copy, `llm/anthropicProvider.js`, gated on ANTHROPIC_API_KEY, entry-assessment question generation; falls back to real quiz questions when unconfigured)
frontend:   src/services/entryAssessment.service.js → POST/GET /assessment/entry/... (AI Student Entry Phase, real user-facing onboarding flow)
scheduler:  reassessmentDue.scheduler.js — every 30 min (`*/30 * * * *`)
depends on: observation (hard, primary trigger), student-state (hard, secondary trigger), learning-path (defensive)
depended on by: recommendation, teacher-insights, analytics, career, placement, mentor (all hard require)
```

## 4. Recommendation Agent
```
files:      src/modules/recommendation/  (36 files, 12 per-type generators under services/domain/generators/)
services:   router, bootstrap, subscribe, RECOMMENDATION_EVENT_NAMES, recalculate, generateForStudent, getByStudent, getBatchActiveRecommendations
routes:     /recommendations — GET /today, /high-priority, /revision, /learning, POST /recalculate, POST /feedback, GET /:studentId (catch-all)
database:   Recommendation, RecommendationHistory, RecommendationFeedback, RecommendationRule, RecommendationAnalytics
            (NOT to be confused with other agents' similarly-named models: TeachingRecommendation [teacher-insights],
             CareerRecommendation/CareerRecommendationHistory [career], LearningRecommendation [learning-path],
             StrategicRecommendation [admin-intelligence] — all distinct models)
APIs:       none
frontend:   none (no standalone recommendation-agent UI found in lms_web_demo)
scheduler:  deadlineScan.scheduler.js — every 30 min; dailyDigest.scheduler.js — daily 02:00 (also covers "new course published"/"goal changed" triggers with no real-time hook)
depends on: observation (hard, allowlisted event types), student-state (hard), assessment (hard), learning-path (defensive)
depended on by: motivation, teacher-insights, analytics, placement, mentor (all hard require)
```

## 5. Motivation Agent
```
files:      src/modules/motivation/  (43 files, 11 detector files under services/domain/detectors/)
services:   router, bootstrap, subscribe, MOTIVATION_EVENT_NAMES, recalculate, generateForStudent, getBatchMotivationSummary, getStreak
routes:     /motivation — GET /reminders, /streak, /actions, /history, POST /recalculate, POST /acknowledge, GET /:studentId (catch-all)
database:   MotivationAction, MotivationHistory, MotivationAnalytics, ReminderSchedule, StudentStreak, EngagementTrend
APIs:       none (rule/heuristic-based: burnoutHeuristic.js, streakEvaluator.js)
frontend:   none (the frontend's "streak" card on /student/reports is sourced from the ordinary dashboard endpoint, NOT this agent's StudentStreak model — confirmed false positive)
scheduler:  reminderDispatch — every 15 min; deadlineScan — every 30 min; engagementSweep — daily 03:00
depends on: student-state (hard), recommendation (hard), learning-path (defensive)
depended on by: teacher-insights, analytics, mentor (all hard require)
```

## 6. Teacher Insight Agent
```
files:      src/modules/teacher-insights/  (42 files, 11 detector files)
services:   router, bootstrap, subscribe, TEACHER_INSIGHT_EVENT_NAMES, recalculate, generateForCourse, getTeacherDashboard
routes:     /teacher-insights — GET /students-at-risk, /course-health, /class-performance, /recommendations, /weekly-summary, /monthly-summary, POST /recalculate, GET /course/:courseId, GET /:teacherId
database:   CourseHealth, CourseInsight, InsightAnalytics, InsightHistory, StudentAlert, TeacherInsight, TeachingRecommendation
            (shares enums InsightPriority/InsightStatus with admin-intelligence's AdminAlert/AdminInsight)
APIs:       none
frontend:   src/services/teacherInsight.service.js → GET /teacher-insights/:teacherId; consumed by
            src/hooks/queries/instructor/useTeacherInsights.js (useTeacherInsights, useInstructorActionRecommendations, useTeachingSuggestions)
            → src/app/instructor/recommendations/page.jsx and src/app/instructor/suggestions/page.jsx
            (both linked from the instructor nav strip)
scheduler:  dailyClassSweep — daily 04:00; weeklySummary — Monday 05:00; monthlySummary — 1st of month 06:00
depends on: student-state, assessment, recommendation, motivation, observation (all hard), learning-path (defensive)
depended on by: analytics, admin-intelligence, mentor (all hard require)
```

## 7. Analytics Agent
```
files:      src/modules/analytics/  (41 files — the module root previously also had orphaned analytics.controller.js/
            analytics.routes.js duplicates from an earlier refactor; those were already removed in a prior, separate
            cleanup pass before this agent-removal audit — the live code has always been controllers/+routes/)
services:   router, bootstrap, subscribe, ANALYTICS_EVENT_NAMES, recalculate, generateForScope, getPlatformKPIs, getCourseKPIsBatch, getInstructorKPIsBatch
            NOTE: no getByStudent export exists, despite career/services/context/studentContextBuilder.js calling it
            (silently caught — see ARCHITECTURE.md "Known gaps")
routes:     /analytics — GET /dashboard, /student/:studentId, /instructor/:instructorId, /course/:courseId, /platform, /kpis, /reports, /trends, /forecast, POST /recalculate, POST /report/export
database:   KPI, AnalyticsHistory, AnalyticsSnapshot, DashboardMetric, TrendAnalysis, Forecast, Report (all scope-generic, no FK to User/Course)
APIs:       none (statistical forecastEngine.js/trendDetector.js, not ML/LLM)
frontend:   none — /instructor/analytics and /admin/analytics pages call ordinary LMS dashboard endpoints, not this agent
scheduler:  courseInstructorSweep — hourly; platformDailySweep — daily 03:00 + snapshot; reportScheduler — weekly/monthly/quarterly/annual crons
depends on: student-state, assessment, recommendation, motivation, teacher-insights, observation (all hard), learning-path (defensive)
depended on by: admin-intelligence, career (broken call), mentor (all hard require)
```

## 8. Career Guidance Agent
```
files:      src/modules/career/  (46 files; `ai/` directory is deterministic scoring/ranking, NOT an LLM integration despite the name)
services:   router, bootstrap (also seeds IndustryRole taxonomy idempotently), subscribe, CAREER_EVENT_NAMES, recalculate, generateForStudent, getFullState
routes:     /career — GET /profile/:studentId, /readiness, /roles, /roadmap, /skill-gaps, /recommendations, /interview-plan, POST /recalculate, POST /goal
database:   IndustryRole (seed catalog), CareerGoal, CareerProfile, SkillAssessment, SkillGap, CareerRecommendation, CareerRecommendationHistory, CareerRoadmap, CareerReadinessHistory
APIs:       none — ai/jobMarketProvider.js is an honest stub returning static seed data (no real job-market API wired)
frontend:   none
scheduler:  dailySafetySweep — daily 04:00; industryTaxonomyRefresh — monthly (1st, 05:00)
depends on: student-state, assessment (hard), learning-path (defensive), analytics (hard, but the specific call is broken — see gaps)
depended on by: placement, mentor (both hard require)
```

## 9. Learning Path Agent
```
files:      src/modules/learning-path/  (26 files — module root previously also had orphaned learningPath.controller.js/
            .routes.js/.service.js duplicates from a refactor; already removed in a prior, separate cleanup pass —
            live code has always been controllers/+routes/+services/)
services:   router, bootstrap, subscribe, LEARNING_PATH_EVENT_NAMES, recalculate, generateForStudent, getFullState (returns null not throw), getBatchStates
routes:     /learning-path — GET /next, /daily-plan, /weekly-plan, /recommendations, /milestones, POST /recalculate, GET /:studentId (catch-all)
database:   LearningPath, LearningGoal, LearningMilestone, LearningRecommendation, RevisionPlan, StudyPlan
APIs:       none
frontend:   none currently (a prior, unrelated cleanup pass removed an orphaned useLearningPath.js/PersonalizedPathCard.jsx
            pair that once existed in lms_web_demo — nothing calls this agent from the frontend today)
scheduler:  dailySweep — daily 04:00 (safety net for students with no recent student-state:updated trigger)
depends on: student-state (hard, the only hard dependency this agent has on another of the 4 "hub" agents)
depended on by: assessment, recommendation, motivation, teacher-insights, analytics, career (all via the now-live defensive
            try/require — see ARCHITECTURE.md), mentor (hard)
```

## 10. Placement Agent
```
files:      src/modules/placement/  (39 files)
services:   router, bootstrap (also seeds Company/JobOpportunity/InternshipOpportunity/PlacementDrive catalog), subscribe, PLACEMENT_EVENT_NAMES, recalculate, generateForStudent, getProfile
routes:     /placement — GET /jobs, /internships, /drives, /matches, /applications, /interviews, /offers, POST /recalculate, POST /application, GET /profile/:studentId
database:   Application, Company, InternshipOpportunity, Interview, JobMatch, JobOpportunity, Offer, PlacementDrive, PlacementProfile, ResumeReview
APIs:       none — integrations/jobPortalProvider.js is an honest empty-default adapter (no real job-portal API wired)
frontend:   none
scheduler:  dailySweep — daily 04:00; catalogRefresh — daily 06:00
depends on: career, assessment, student-state (all hard)
depended on by: mentor (only)
```

## 11. Admin Intelligence Agent
```
files:      src/modules/admin-intelligence/  (46 files)
services:   router, bootstrap, subscribe, ADMIN_INTELLIGENCE_EVENT_NAMES, recalculate, generateInsights, getDashboard
routes:     /admin-intelligence (ADMIN-only) — GET /dashboard, /institution-health, /departments, /faculty, /student-risk, /compliance, /reports, /forecasts, /alerts, POST /recalculate, POST /report/export
database:   AdminAlert, AdminInsight, CapacityForecast, ComplianceAudit, DepartmentAnalytics, ExecutiveReport, FacultyAnalytics, GovernanceMetric, InstitutionHealth, StrategicRecommendation
            ("department"/"faculty" are proxies: Course.category and instructor Users — no real Department/Faculty model exists in this schema)
APIs:       none
frontend:   none
scheduler:  dailySweep — daily 04:00 (after Analytics' 03:00 sweep, by design); reportScheduler — weekly/monthly/quarterly/annual/semester crons
depends on: analytics, teacher-insights (both hard, exact exports: getPlatformKPIs, getCourseKPIsBatch, getInstructorKPIsBatch, getTeacherDashboard, subscribe), student-state (hard)
depended on by: mentor (only)
```

## 12. Mentor Agent
```
files:      src/modules/mentor/  (48 files) — TWO parallel subsystems, see ARCHITECTURE.md "Mentor: designed vs. live"
            LIVE:    mentor.routes.js, mentor.controller.js, mentor.service.js, mentor.validation.js,
                     mentorPrompt.builder.js, tools/ (all at module root)
            DORMANT: orchestrator/, context-engine/, intent-engine/, memory/, prompt-builder/,
                     llm/{anthropicProvider,fallbackProvider,index}.js, repositories/ (8 files),
                     dto/mentorResponse.dto.js, services/mentor.service.js, utils/{accessControl,safeInvoke}.util.js
            (module root also previously had orphaned controllers/mentor.controller.js, routes/mentor.routes.js,
             middleware/{resolveMentorActor,validateQuery}.middleware.js, validators/mentor.validator.js —
             already removed in a prior, separate cleanup pass; NOT the same thing as the dormant orchestrator above,
             which is real un-orphaned code, just unreachable)
services:   router, bootstrap (seeds PromptTemplate rows), chat + streamChat (bound to the DORMANT services/mentor.service.js —
            nothing calls these two exports)
routes:     /mentor (live) — POST /conversations, GET /conversations, GET /conversations/:id/messages,
            POST /conversations/:id/messages, POST /conversations/:id/messages/stream (real SSE endpoint)
database:   MentorConversation, MentorMessage, ConversationContext, AgentInvocation, MentorMemory,
            ConversationSummary, PromptTemplate, ResponseFeedback (all 8 verified present in schema.prisma
            with exact fields/relations — see DATABASE.md)
APIs:       LIVE path: src/modules/llm/llm.service.js (Ollama, shared platform service, not agent-exclusive — do not remove)
            DORMANT path: @anthropic-ai/sdk direct, model claude-sonnet-4-5, gated on ANTHROPIC_API_KEY
frontend:   src/components/mentor/ (MentorButton, MentorWindow, MentorWidget, MentorMarkdown), rendered via
            DashboardLayout.jsx and student/learn/[courseId]/page.jsx; src/services/mentor.service.js (frontend);
            src/hooks/queries/mentor/useMentorQueries.js — this is real, working, user-facing chat
depends on: observation, student-state, learning-path, assessment, recommendation, motivation, teacher-insights,
            analytics, career, placement, admin-intelligence — ALL 11, but only inside the DORMANT
            orchestrator/agentSelector.js. The LIVE path depends on none of the other 11 agents —
            it only touches dashboard/learner-model/quizzes/results via its own tool registry.
depended on by: nobody (top of the stack)
```

---

## Classification (Phase 2 — shared vs. agent-specific)

**A. Agent-specific (removed, backed up)** — everything listed above under each of the 12 agents' `files:` line, plus the frontend files listed under each agent's `frontend:` line, plus the AI Student Entry Phase frontend flow (`src/app/student/entry-assessment/`, `src/services/entryAssessment.service.js` — this is agent-specific because it exclusively calls Assessment + Student State routes, even though it's a real user-facing feature).

**B. Shared LMS infrastructure (kept, untouched)** — everything in `src/modules/` outside the 12 named directories; core Prisma models (`User`, `StudentProfile`, `Course`, `Module`, `Lesson`, `Topic`, `Content`, `Quiz`, `Question`, `Enrollment`, etc.); `node-cron` (also used by `src/modules/messages/messageCleanup.service.js`); `@anthropic-ai/sdk` (also used by `src/modules/course-import`'s LLM provider); `ANTHROPIC_API_KEY` env var (also read by course-import); `src/socket/` (confirmed used only by the human-to-human chat/notification feature, never by any of the 12 agents, including Mentor's SSE streaming which uses plain HTTP, not socket.io); `src/modules/llm/` and `src/modules/adaptive-learning/` and `src/modules/learner-model/` (separate, non-agent-list backend features that happen to also do LLM/adaptive things — NOT part of the 12-agent system, explicitly out of scope for this removal).

**C. Mixed/shared (refactored carefully, not deleted)** — `User`, `StudentProfile`, and `Course` Prisma models each carry many agent-relation array fields (e.g. `StudentProfile.recommendations`, `Course.teacherInsights`) that had to be stripped from the schema without touching the models themselves or their non-agent fields/relations. See `DATABASE.md` for the exact field-by-field list removed from each. **Also Category C, discovered only after the first removal pass**: the Prisma models `LearningEvent`, `StudentState`, `StudentCourseState`, `ConceptMastery`, and `KnowledgeGap` look agent-owned (Observation/Student State/Assessment) but are also directly read/written by non-agent code — `src/modules/learner-model` (a separate BKT/adaptive-learning system) and pieces of `src/modules/courses`, `src/modules/students`, `src/modules/quizzes`. These 5 models (and their enums) were kept in the schema — see `DATABASE.md`'s correction note for the full explanation.
