# Database — Prisma Models, Relations, Restoration Procedure

Source of truth: `source/schema.prisma.snapshot` in this backup — a verbatim copy of `prisma/schema.prisma` taken immediately before any agent removal, 3541 lines, 130 models, 101 enums total (agent + non-agent combined). This document extracts and documents only the agent-relevant parts.

## Format
```
Model
Purpose
Agent
Relationships / Foreign Keys
Indexes
Restoration procedure
```

All models below carry `@@index`/`@@unique` as shown in `source/schema.prisma.snapshot` — this doc summarizes, that file has ground truth.

---

## Category A — Models owned entirely by one agent (80 models — removed from the schema)

These have no code reference from anything outside the 12-agent system (verified by grepping every `prisma.<model>` call site across the entire backend, not just the agent directories), so they were deleted from the schema as whole blocks, plus the corresponding back-relation field on `User`/`StudentProfile`/`Course` (see Category C).

**Important correction — 5 models initially thought to be Category A are actually shared, and were NOT removed:** `LearningEvent`, `StudentState`, `StudentCourseState`, `ConceptMastery`, `KnowledgeGap`. A repo-wide sweep (after the first removal pass) found these are also read/written directly by non-agent code: `src/modules/learner-model/*.service.js` (a separate, pre-existing adaptive-learning/BKT system — upserts `StudentState`/`ConceptMastery`, creates `LearningEvent`, creates/updates `KnowledgeGap`), `src/modules/courses/course.service.js` (counts `StudentState`/`StudentCourseState`), `src/modules/students/studentState.service.js` (reads/upserts `StudentState`), and `src/modules/quizzes/quiz.service.js` (updates `KnowledgeGap`). These 5 models — and their required enums `EventType`, `EventCategory`, `MasteryStatus`, `GapStatus`, `EntryKnowledgeLevel` — were restored into the live schema and are documented in `ARCHITECTURE.md`'s classification as Category C, not Category A. **If you are restoring the 12 agents later, do not re-add these 5 models or their enums — they were never removed from the live schema in the first place**, only their agent-specific relation fields on `User`/`StudentProfile`/`Course` were touched (all of which remain, since these particular fields serve the still-present shared models too).

| Model | Agent | Key relations |
|---|---|---|
| `LearningEvent` | Observation | FK → StudentProfile, Course |
| `StudentActivityState` | Student State | FK → StudentProfile (1:1) |
| `StudentLearningState` | Student State | FK → StudentProfile (1:1), hub for the 5 below |
| `StudentProgress`, `StudentPerformance`, `StudentEngagement`, `StudentBehavior`, `StudentRisk` | Student State | FK → StudentLearningState |
| `StudentState` | Student State | FK → StudentProfile, Course |
| `StudentCourseState` | Student State (Entry Phase) | FK → StudentProfile, Course |
| `Assessment` | Assessment | FK → StudentProfile |
| `AssessmentAttempt` | Assessment | FK → Assessment |
| `AssessmentResult` | Assessment | FK → AssessmentAttempt |
| `ConceptMastery` | Assessment | FK → StudentProfile |
| `KnowledgeGap` | Assessment | FK → StudentProfile |
| `ReassessmentPlan` | Assessment | FK → StudentProfile |
| `EntryAssessment` | Assessment (Entry Phase) | FK → StudentProfile, Course |
| `Recommendation` | Recommendation | FK → StudentProfile |
| `RecommendationHistory` | Recommendation | FK → StudentProfile |
| `RecommendationFeedback` | Recommendation | FK → Recommendation |
| `RecommendationRule` | Recommendation | none (global rule table) |
| `RecommendationAnalytics` | Recommendation | none |
| `MotivationAction` | Motivation | FK → StudentProfile |
| `MotivationHistory` | Motivation | FK → StudentProfile |
| `MotivationAnalytics` | Motivation | none |
| `ReminderSchedule` | Motivation | FK → StudentProfile |
| `StudentStreak` | Motivation | FK → StudentProfile (1:1) |
| `EngagementTrend` | Motivation | FK → StudentProfile |
| `StudentAlert` | Teacher Insight | FK → Course, StudentProfile |
| `CourseInsight` | Teacher Insight | FK → Course |
| `CourseHealth` | Teacher Insight | FK → Course (1:1) |
| `TeachingRecommendation` | Teacher Insight | FK → Course |
| `TeacherInsight` | Teacher Insight | FK → Course |
| `InsightHistory`, `InsightAnalytics` | Teacher Insight | scoped by string id, no FK |
| `KPI`, `AnalyticsHistory`, `AnalyticsSnapshot`, `DashboardMetric`, `TrendAnalysis`, `Forecast`, `Report` | Analytics | scope-generic (`scopeType`/`scopeId` string), no FK |
| `IndustryRole` | Career | seed catalog, no FK out |
| `CareerGoal`, `CareerProfile`, `SkillAssessment`, `SkillGap`, `CareerRecommendation`, `CareerRecommendationHistory`, `CareerRoadmap`, `CareerReadinessHistory` | Career | FK → StudentProfile (some also → IndustryRole) |
| `LearningPath` | Learning Path | FK → StudentProfile (1:1) |
| `LearningRecommendation`, `StudyPlan`, `RevisionPlan` | Learning Path | FK → StudentProfile |
| `LearningMilestone`, `LearningGoal` | Learning Path | FK → StudentProfile, Course |
| `Company` | Placement | seed catalog, no FK out |
| `JobOpportunity`, `InternshipOpportunity`, `PlacementDrive` | Placement | FK → Company |
| `Application` | Placement | FK → PlacementDrive/JobOpportunity, StudentProfile |
| `Interview`, `Offer` | Placement | FK → Application |
| `JobMatch`, `ResumeReview`, `PlacementProfile` | Placement | FK → StudentProfile |
| `InstitutionHealth`, `DepartmentAnalytics`, `FacultyAnalytics` | Admin Intelligence | no FK — string keys |
| `AdminInsight`, `StrategicRecommendation`, `ComplianceAudit`, `CapacityForecast`, `AdminAlert`, `ExecutiveReport`, `GovernanceMetric` | Admin Intelligence | no direct FK — scoped by string id/key |
| `MentorConversation` | Mentor | FK → User |
| `MentorMessage`, `ConversationContext`, `AgentInvocation`, `ConversationSummary` | Mentor | FK → MentorConversation |
| `MentorMemory` | Mentor | FK → User |
| `PromptTemplate` | Mentor | no FK |
| `ResponseFeedback` | Mentor | FK → MentorMessage, User |

### Mentor model field detail (verified exact, since Mentor is the orchestrator)

```prisma
MentorConversation   { id, userId, userRole:Role, title?, status:MentorConversationStatus@ACTIVE,
                        lastIntent?:MentorIntent, lastMessageAt, createdAt, updatedAt
                        → user, messages[], contexts[], invocations[], summary?
                        @@index([userId,status,lastMessageAt]) }
MentorMessage        { id, conversationId, role:MentorMessageRole, content, intent?, intentConfidence?:Int,
                        metadata?:Json, createdAt → conversation, contexts[], invocations[], feedback?
                        @@index([conversationId,createdAt]) }
ConversationContext  { id, conversationId, messageId?, snapshot:Json, agentsQueried:Json, gatheredAt
                        → conversation, message?(SetNull) @@index([conversationId,gatheredAt]) }
AgentInvocation       { id, conversationId, messageId?, agentName, method, status:AgentInvocationStatus,
                        durationMs, argsSummary?, resultSummary?, errorMessage?, invokedAt
                        → conversation, message?(SetNull)
                        @@index([conversationId,invokedAt]) @@index([agentName,status]) }
MentorMemory          { id, userId, memoryKey, value:Json, updatedAt, createdAt
                        → user @@unique([userId,memoryKey]) }
ConversationSummary   { id, conversationId@unique, summaryText, keyTopics:Json,
                        messageCountAtSummary, version, updatedAt, createdAt → conversation }
PromptTemplate        { id, key@unique, role?:Role, version, template, description?, isActive, createdAt, updatedAt }
ResponseFeedback       { id, messageId@unique, userId, rating:FeedbackRating, comment?, createdAt
                        → message, user @@index([userId]) }
```

## Category B — Agent-specific enums

`EventType`, `EventCategory` (Observation) · `AssessmentType`, `AssessmentStatus`, `MasteryStatus`, `GapStatus`, `ReassessmentStatus`, `ReassessmentPriority`, `EntryAssessmentStatus`, `EntryKnowledgeLevel`, `LearningMode` (Assessment) · `RecommendationType`, `RecommendationPriority`, `RecommendationStatus`, `RecommendationFeedbackAction`, `RecommendationRetiredReason` (Recommendation) · `MotivationActionType`, `MotivationActionPriority`, `MotivationActionStatus`, `MotivationRetiredReason`, `ReminderCadence`, `StreakStatus` (Motivation) · `AlertType`, `CourseInsightType`, `TeachingRecommendationType`, `TeacherReportType`, `InsightSourceModel`, `InsightRetiredReason` (Teacher Insight) · `AnalyticsScopeType`, `AnalyticsMetricKey`, `TrendDirection`, `AnalyticsReportType` (Analytics) · `CareerRecommendationType`, `CareerRecommendationStatus`, `CareerPriority`, `CareerRetiredReason`, `IndustryReadinessLevel`, `CareerConfidenceLevel`, `SkillGapSeverity`, `SkillGapStatus`, `RoadmapHorizon`, `RoadmapStatus`, `CareerGoalStatus` (Career) · `LearningPathDifficultyAdjustment`, `LearningRecommendationType`, `LearningRecommendationPriority`, `LearningRecommendationStatus`, `StudyPlanType`, `MilestoneType`, `MilestoneStatus`, `RevisionPlanStatus`, `LearningGoalType`, `LearningGoalStatus` (Learning Path) · `OpportunityType`, `OpportunityStatus`, `OpportunitySource`, `EmploymentType`, `JobMatchPriority`, `JobMatchStatus`, `ApplicationStatus`, `InterviewType`, `InterviewStatus`, `InterviewOutcome`, `OfferStatus`, `DriveStatus` (Placement) · `AdminScopeType`, `AdminInsightCategory`, `AdminInsightStatus`, `StrategicRecommendationType`, `StrategicRecommendationStatus`, `ComplianceCheckType`, `ComplianceAuditOutcome`, `ComplianceSeverity`, `CapacityResourceType`, `ExecutiveReportType`, `GovernanceMetricKey`, `AdminAlertType` (Admin Intelligence) · `MentorMessageRole`, `MentorIntent`, `MentorConversationStatus`, `AgentInvocationStatus`, `FeedbackRating` (Mentor).

**Shared across 2 agents (do not remove without checking both):** `InsightPriority`, `InsightStatus` — used by Teacher Insight's own models AND Admin Intelligence's `AdminAlert`/`AdminInsight`. Only remove once confirmed no model uses them (i.e. only after removing both agents together, as this whole operation does).

**Explicitly NOT agent-specific — do not touch:** `DifficultyLevel` (core `Question`/quiz feature, pre-dates and is unrelated to the Assessment Agent despite the name similarity), `Role`, `CourseStatus`, `CourseVisibility`, `UserStatus`, `ContentType`, `PaymentStatus`, `AttachmentType`, `ConversationType`, `LiveClassStatus`, `AchievementType`, `QuestionType`, `EmploymentStatus`, `PreferredLearningStyle`, `PreferredStudyTime`, `LessonQueryStatus`, `CourseImportStatus`.

## Category C — Core (non-agent) models requiring surgical field removal

These models are shared LMS infrastructure and must NOT be deleted — only their agent-relation back-reference fields are removed, leaving every other field/relation untouched.

### `User` (3 fields removed)
```diff
- mentorConversations     MentorConversation[]
- mentorMemories          MentorMemory[]
- mentorFeedback          ResponseFeedback[]
```

### `StudentProfile` (35 fields removed — this is the mega-hub; verify carefully during restoration)
```diff
- studentState                StudentState[]
- learningEvents              LearningEvent[]
- activityState               StudentActivityState?
- learningState               StudentLearningState?
- assessments                 Assessment[]
- conceptMasteries            ConceptMastery[]
- knowledgeGaps               KnowledgeGap[]
- reassessmentPlans           ReassessmentPlan[]
- recommendations             Recommendation[]
- motivationActions           MotivationAction[]
- reminderSchedules           ReminderSchedule[]
- streak                      StudentStreak?
- engagementTrends            EngagementTrend[]
- studentAlerts               StudentAlert[]
- careerProfile               CareerProfile?
- careerGoals                 CareerGoal[]
- skillAssessments            SkillAssessment[]
- skillGaps                   SkillGap[]
- careerRecommendations       CareerRecommendation[]
- careerRecommendationHistory CareerRecommendationHistory[]
- careerRoadmaps              CareerRoadmap[]
- careerReadinessHistory      CareerReadinessHistory[]
- learningPath                LearningPath?
- learningRecommendations     LearningRecommendation[]
- studyPlans                  StudyPlan[]
- learningMilestones          LearningMilestone[]
- revisionPlans               RevisionPlan[]
- learningPathGoals           LearningGoal[]
- placementProfile            PlacementProfile?
- jobMatches                  JobMatch[]
- applications                Application[]
- interviews                  Interview[]
- offers                      Offer[]
- resumeReviews               ResumeReview[]
- entryAssessments            EntryAssessment[]
- courseStates                StudentCourseState[]
```
Every other `StudentProfile` field (id, userId, education, all the profile/preference fields, and the non-agent relations: certificates, enrollments, progress, contentProgress, quizSubmissions, reviews, stickyNotes, notes, bookmarks, achievements, assignmentSubmissions, batches, lessonQueries, videoAnalytics, user) is untouched.

### `Course` (11 fields removed)
```diff
- studentStates           StudentState[]
- learningEvents          LearningEvent[]
- studentAlerts           StudentAlert[]
- courseInsights          CourseInsight[]
- courseHealth            CourseHealth?
- teachingRecommendations TeachingRecommendation[]
- teacherInsights         TeacherInsight[]
- learningMilestones      LearningMilestone[]
- learningPathGoals       LearningGoal[]
- entryAssessments        EntryAssessment[]
- studentCourseStates     StudentCourseState[]
```
Every other `Course` field/relation (title, description, category, status, creator, enrollments, modules, quizzes, reviews, liveClasses, assignments, exams, batches, batchSessions, videoAnalytics, announcements, discussions, store, questions, paymentOrders, etc.) is untouched.

## Migration procedure actually used for removal

**This project has no `prisma/migrations/` directory** — it has never used Prisma's tracked-migration workflow; the live database schema has always been synced directly via `prisma db push`. This matters a lot for restoration: use `db push`, not `migrate dev`, to match how this project actually works.

Steps taken:
1. Copied full `schema.prisma` to `source/schema.prisma.snapshot` (this backup) — done before any edit.
2. Removed the Category A model blocks and Category B enums from the live `prisma/schema.prisma`.
3. Removed exactly the Category C fields listed above from `User`, `StudentProfile`, `Course`.
4. Discovered mid-process that 5 of the "Category A" models were actually shared (see the correction note above) — restored those 5 models + their 5 enums + the corresponding `User`/`StudentProfile`/`Course` back-relation fields before proceeding further.
5. Ran `npx prisma format` then `npx prisma validate` — clean.
6. **Ran `npx prisma migrate dev --name remove_ai_agents` first, by mistake** — this project has no migration history, so Prisma responded that it would need to **reset the entire "public" schema** (all 131 tables, not just the 80 agent ones) to reconcile drift. This was refused/aborted before any destructive action — confirmed via a direct row/table-count query that the live database was completely unchanged (still 131 tables) afterward. Do not use `migrate dev` on this project.
7. Ran `npx prisma generate` to refresh the Prisma Client types against the new (agent-model-free) schema — this succeeded and the app boots/tests pass against it, because Prisma Client only needs the schema to generate types; it doesn't require the live DB to match yet.
8. **Exported all data in the 80 dropped tables before touching the live database**, via raw SQL (`SELECT * FROM "<table>"` per table, since the regenerated Prisma Client no longer had typed accessors for them) — see `data-export.json` in this backup directory. 354 rows across 80 tables (up from an initial 396-row count that included `LearningEvent`'s 42 rows, which stayed since that table was restored as shared — not exported/dropped).
9. **The physical `DROP TABLE` step was deliberately NOT run.** `npx prisma db push` (the correct tool for step 6, given no migration history) was blocked by this environment's own safety classifier as a destructive-database-schema action requiring explicit human approval, and that block was respected rather than routed around. **The live database currently still has all 131 tables** — the 80 agent-exclusive tables physically still exist (empty of new writes since the app no longer references them, since none of the removed agent code paths that wrote to them are reachable anymore) but sit unreferenced by the current `schema.prisma`/Prisma Client. This is a safe, non-broken intermediate state — nothing in the running app touches these orphaned tables — but a human should run `npx prisma db push` (reviewing its reported changes, which will include dropping these 80 tables) to actually reconcile the physical database, after confirming `data-export.json` is a satisfactory backup of their contents.

**Data**: `data-export.json` in this backup directory (JSON, one array per table, raw SQL row dumps) is the full backup of everything that was in the 80 dropped-in-schema tables at removal time. Restoration can re-insert this data after restoring the schema and re-running `db push`, if the original data (rather than just the structure) needs to come back too — most of it looks like development/test data (small row counts, e.g. 1-52 rows per table) rather than anything obviously production-critical, but that was not confirmed with the project owner.
