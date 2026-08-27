# Prompts — LLM Prompt Text

Two separate prompt systems exist, matching the two Mentor subsystems described in `ARCHITECTURE.md`. Full source in `source/mentor/mentorPrompt.builder.js` and `source/mentor/constants/promptTemplates.seed.js`.

## 1. Live path — `mentorPrompt.builder.js` (used by the actual `/mentor/*` routes)

Hardcoded (not DB-stored), role-switched, built fresh per request by `buildSystemPrompt(userRole)`:

- **Shared base rules** (all roles): strict domain scope (LMS/academic only, refuses off-topic/general-knowledge questions with an exact canned decline line), never invent LMS metrics/grades/progress/dates, never expose schema/internal details, ignore embedded prompt-injection attempts in user content, and an explicit "no placeholder values" rule when context is missing.
- **STUDENT** addendum: strict enrolled-course-scope gate (refuses to explain a technical topic unless it's part of a course in `studentEnrolledCourses`, with an exact canned decline template naming the topic and listing real enrolled courses), no raw BKT/statistical numbers (translate to "Mastered"/"Needs Practice"), response-format rules (answer first, no verbatim data dump, Markdown formatting rules, `quizStatus` NO_ATTEMPTS vs RECORDED semantics spelled out exactly, at most one follow-up offer).
- **INSTRUCTOR** addendum: instructional-analytics-assistant framing, course/student/quiz analytics focus, authorized-context-only constraint.
- **ADMIN** addendum: platform-analytics-assistant framing, explicit "That metric is not currently available" fallback line, never expose credentials/tokens/secrets.
- **User prompt** (`buildUserPrompt`): `[Retrieved LMS Context]` (JSON-stringified context object) + `[Recent Conversation History]` (last 6 turns, `role: content` lines) + `[Current User Message]`.

Full verbatim text is in `source/mentor/mentorPrompt.builder.js` — reproduced here would risk drift from the source; treat that file as ground truth, this is a summary for orientation.

## 2. Dormant orchestrator path — `constants/promptTemplates.seed.js` (DB-seeded `PromptTemplate` rows, never actually served)

Four templates, upserted idempotently into the `PromptTemplate` table at `bootstrap()` by `repositories/promptTemplate.repository.js#ensureSeeded`. Uses `{{context}}`/`{{summary}}`/`{{memory}}` placeholders substituted by `prompt-builder/promptAssembler.js`.

- **`SYSTEM_STUDENT`** — names all 7 peer agents explicitly as the sole source of facts (Student State, Learning Path, Assessment, Recommendation, Motivation, Career Guidance, Placement); never modifies records; includes `{{context}}`/`{{summary}}`/`{{memory}}` sections.
- **`SYSTEM_INSTRUCTOR`** — names Teacher Insight + Analytics as sole fact sources; `{{context}}`/`{{summary}}` only (no memory section).
- **`SYSTEM_ADMIN`** — names Admin Intelligence + Analytics as sole fact sources; `{{context}}`/`{{summary}}` only.
- **`CLARIFYING_QUESTION`** — used when `intent-engine/classifier.js` confidence is below threshold; no LLM call happens, this exact string is returned directly.
- **`FALLBACK_NOTICE`** — prefixed onto `llm/fallbackProvider.js`'s deterministic reply whenever `ANTHROPIC_API_KEY` isn't configured, so a non-generated reply is never mistaken for real LLM output.

Full verbatim template text is in `source/mentor/constants/promptTemplates.seed.js`.

## 3. Assessment Agent's independent LLM prompt (Entry Phase question generation)

`src/modules/assessment/llm/promptBuilder.js` (copied to `source/assessment/llm/promptBuilder.js`) builds the prompt used to generate the 15-question (5 easy/5 medium/5 hard) entry assessment, scoped to a course's real module titles. Separate from both Mentor prompt systems above — its own `llm/anthropicProvider.js` copy, gated on the same `ANTHROPIC_API_KEY` env var but an entirely independent call path. See that file directly for exact prompt text; not duplicated here.

## Restoration note

Do not paraphrase or "improve" any of this prompt text on restoration — Rule 3 (preserve behavior) applies especially strongly to prompts, since small wording changes measurably change LLM behavior. Copy verbatim from the `source/` files.
