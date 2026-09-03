const llmService = require("../../llm/llm.service");
const { validateV2Manifest } = require("./v2PackageImporter.service");
const ApiError = require("../../../utils/ApiError");

const SYSTEM_PROMPT = `You are an expert LMS course content generator for Orange Tree LMS.
Generate complete, valid course packages or entity structures for ANY subject area (Computer Science, Mathematics, Physics, Business, Marketing, Cybersecurity, History, Agriculture, Finance, Languages, Professional Training, etc.).

STRICT DOWNWARD HIERARCHICAL GENERATION RULES:
1. Output raw JSON only. Do NOT output markdown fences (\`\`\`json), thinking tags, reasoning text, or preamble.
2. Generation may ONLY move DOWN the hierarchy from the selected entity root. NEVER generate an entity above the selected entity.
3. NON-COURSE SCOPE GENERATION FORMATS:

   - If Scope === "MODULE" (GENERATION DEPTH: FULL_MODULE):
     Generate 1 Module containing Lessons, Topics per lesson, Content blocks for each topic, and Quizzes for the generated hierarchy.
     Output JSON Schema:
     {
       "title": "Module Title",
       "description": "Module Description",
       "quizzes": [{ "title": "Module Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] }],
       "lessons": [
         {
           "title": "Lesson Title",
           "description": "Lesson Description",
           "quizzes": [{ "title": "Lesson Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] }],
           "topics": [
             {
               "title": "Topic Title",
               "description": "Topic Description",
               "quiz": { "title": "Topic Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] },
               "contents": [
                 { "type": "HTML"|"CODE"|"TEXT"|"VIDEO", "title": "Content Title", "htmlContent": "..." }
               ]
             }
           ]
         }
       ]
     }
     *CRITICAL*: Do NOT generate Course metadata or Course wrapper above Module.

   - If Scope === "LESSON" (GENERATION DEPTH: FULL_LESSON):
     Generate 1 Lesson containing Topics, Content blocks, and Quizzes.
     Output JSON Schema:
     {
       "title": "Lesson Title",
       "description": "Lesson Description",
       "quizzes": [{ "title": "Lesson Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] }],
       "topics": [
         {
           "title": "Topic Title",
           "description": "Topic Description",
           "quiz": { "title": "Topic Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] },
           "contents": [
             { "type": "HTML"|"CODE"|"TEXT"|"VIDEO", "title": "Content Title", "htmlContent": "..." }
           ]
         }
       ]
     }
     *CRITICAL*: Do NOT generate a Module above Lesson.

   - If Scope === "TOPIC" (GENERATION DEPTH: FULL_TOPIC):
     Generate 1 Topic containing Content blocks and a Quiz.
     Output JSON Schema:
     {
       "title": "Topic Title",
       "description": "Topic Description",
       "contents": [
         { "type": "HTML"|"CODE"|"TEXT"|"VIDEO", "title": "Content Title", "htmlContent": "..." }
       ],
       "quiz": {
         "title": "Topic Quiz Title",
         "description": "...",
         "passingScore": 70,
         "timeLimit": 15,
         "questions": [...]
       }
     }
     *CRITICAL*: Do NOT generate a Module or Lesson above Topic.

   - If Scope === "CONTENT" (GENERATION DEPTH: CONTENT_ONLY):
     Generate Content blocks only under the selected existing topic.
     Output JSON Schema:
     {
       "contents": [
         { "type": "HTML"|"CODE"|"TEXT", "title": "Content Title", "htmlContent": "..." }
       ]
     }
     *CRITICAL*: Do NOT generate a Module, Lesson, Topic, or Quiz.

   - If Scope === "QUIZ" (GENERATION DEPTH: QUIZ_ONLY):
     Generate 1 Quiz only.
     Output JSON Schema:
     {
       "title": "Quiz Title",
       "description": "Quiz Description",
       "passingScore": 70,
       "timeLimit": 15,
       "questions": [
         {
           "question": "Question text?",
           "questionType": "MCQ_SINGLE",
           "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
           "correctAnswer": "Option 1",
           "explanation": "Brief explanation."
         }
       ]
     }
     *CRITICAL*: Do NOT generate a Module, Lesson, Topic, or Content.

4. QUIZ SCHEMA & QUESTIONS:
   - Question Object Schema (questionType MUST be "MCQ_SINGLE"):
     {
       "question": "Question text?",
       "questionType": "MCQ_SINGLE",
       "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
       "correctAnswer": "Option 1",
       "explanation": "Brief explanation.",
       "marks": 1,
       "negativeMarks": 0,
       "difficulty": "EASY"
     }

5. Supported ContentType values: "HTML", "VIDEO", "TEXT", "CODE", "DOCUMENT", "PDF", "IMAGE", "AUDIO", "LINK", "PRESENTATION".
6. Do NOT include database IDs (id, courseId, etc.). Keep string values clean and valid JSON.`;

// --- Scope-aware prompt building (used for MODULE/LESSON/TOPIC/CONTENT/QUIZ
// entity generation — the only scopes actually reachable from the Course
// Composer's "Ask OTree AI" widget). COURSE-scope generation (full package
// import) keeps using the full SYSTEM_PROMPT above, unchanged, since its
// format isn't one of the branches below and this function was not asked to
// touch that path. ---

const HIERARCHY_RULES = `You are an expert LMS course content generator for Orange Tree LMS.
Generate complete, valid entity structures for ANY subject area (Computer Science, Mathematics, Physics, Business, Marketing, Cybersecurity, History, Agriculture, Finance, Languages, Professional Training, etc.).

STRICT DOWNWARD HIERARCHICAL GENERATION RULES:
1. Output raw JSON only. Do NOT output markdown fences (\`\`\`json), thinking tags, reasoning text, or preamble.
2. Generation may ONLY move DOWN the hierarchy from the selected entity root. NEVER generate an entity above the selected entity.`;

// Only "HTML" and "CODE" are offered: they are the only two ContentType
// values this generator persists AND the student renderer (VideoPlayer.jsx)
// actually displays for AI-authored prose/code. "TEXT" has no student
// rendering branch (silently renders nothing); "VIDEO"/"IMAGE"/"AUDIO"/
// "PRESENTATION" all require a real uploaded media asset or a JSON slide
// document this text-only generator has no way to produce reliably — see the
// Phase 9-11 content-architecture findings.
const CONTENT_GUIDANCE = `CONTENT BLOCK SELECTION RULES:
- Each content block's "type" must be either "HTML" or "CODE" — the only two types this generator persists and the student app renders today.
- Use "CODE" only for an actual code example the learner should read as code, and include a "language" field (e.g. "python", "javascript", "sql") so it renders with correct syntax highlighting. Never use "CODE" for prose that merely mentions code.
- Use "HTML" for everything else. Structure it with real semantic HTML so it reads as more than one flat paragraph:
  - "<h3>"/"<h4>" for sub-headings when a block covers more than one idea.
  - "<table>" (with "<thead>"/"<tbody>") for side-by-side comparisons, instead of describing differences in prose.
  - "<ul>"/"<ol>" for steps or lists, instead of comma-separated prose.
  - "<blockquote>" for a single key takeaway, warning, or definition callout.
  - Do NOT invent CSS classes or non-standard tags — only the plain HTML tags listed above.
- Choose block types and structure based on what is actually being taught, not at random: a programming concept should include an explanation block plus a CODE example with "language" set; a conceptual comparison should use a "<table>"; a step-by-step process should use an ordered list. Do not force every topic to include every representation — only generate blocks that genuinely help teach this specific content.`;

// "MCQ_MULTI" is the only additional question type offered beyond the
// pre-existing "MCQ_SINGLE" — it is graded by a dedicated order-independent
// array-match branch (quiz.service.js evaluateAnswer) and rendered by a
// dedicated component (MCQMultiOptionList.jsx), so it is confirmed safe
// end-to-end. The other three QuestionType values that exist in the schema
// (ARRANGE_TOKENS, MATCH_PAIRS, SELF_ASSESSMENT) need richer generated data
// shapes (ordered token lists, key/value pairs) this prompt does not yet
// constrain strictly enough to trust unattended.
const QUESTION_SCHEMA = `QUIZ SCHEMA & QUESTIONS:
- Question Object Schema:
  {
    "question": "Question text?",
    "questionType": "MCQ_SINGLE" | "MCQ_MULTI",
    "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
    "correctAnswer": "Option 1",
    "explanation": "One concise sentence on why the correct answer is correct.",
    "marks": 1,
    "negativeMarks": 0,
    "difficulty": "EASY"
  }
- Use "MCQ_SINGLE" (default) for exactly one correct option — "correctAnswer" is a single option string matching one entry in "options".
- Use "MCQ_MULTI" only when genuinely more than one option is correct — "correctAnswer" is then an array of the correct option strings (2+), each matching an entry in "options".
- Keep "explanation" to one sentence — do not repeat the question or restate every option.`;

const GENERAL_RULES = `GENERAL RULES:
Do NOT include database IDs (id, courseId, etc.). Keep string values clean and valid JSON.`;

// Every content/question object below must be fully populated (real
// htmlContent, real question text/options/correctAnswer/explanation) — this
// is a restore of the original complete-generation contract after a prior
// change temporarily reduced MODULE/LESSON/TOPIC scope to structural shells
// only (empty "contents": [] and quiz objects with no "questions"), which
// broke the requirement that a successfully generated entity is immediately
// complete. Content type is restricted to "HTML"|"CODE" — see CONTENT_GUIDANCE.
const SCOPE_SCHEMAS = {
  MODULE: `SCOPE: MODULE (GENERATION DEPTH: FULL_MODULE)
Generate 1 complete Module: Lessons, Topics per lesson, fully-written Content blocks for every topic, and Quizzes with fully-written questions at the module, lesson, and topic levels.
Output JSON Schema:
{
  "title": "Module Title",
  "description": "Module Description",
  "quizzes": [{ "title": "Module Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] }],
  "lessons": [
    {
      "title": "Lesson Title",
      "description": "Lesson Description",
      "quizzes": [{ "title": "Lesson Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] }],
      "topics": [
        {
          "title": "Topic Title",
          "description": "Topic Description",
          "quiz": { "title": "Topic Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] },
          "contents": [
            { "type": "HTML"|"CODE", "title": "Content Title", "htmlContent": "...", "language": "python (CODE blocks only)" }
          ]
        }
      ]
    }
  ]
}
*CRITICAL*: Do NOT generate Course metadata or a Course wrapper above Module. Every "questions" array and every "contents" array MUST be fully populated per the schemas below — never leave them empty or omitted.`,

  LESSON: `SCOPE: LESSON (GENERATION DEPTH: FULL_LESSON)
Generate 1 complete Lesson: Topics, fully-written Content blocks for every topic, and Quizzes with fully-written questions at the lesson and topic levels.
Output JSON Schema:
{
  "title": "Lesson Title",
  "description": "Lesson Description",
  "quizzes": [{ "title": "Lesson Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] }],
  "topics": [
    {
      "title": "Topic Title",
      "description": "Topic Description",
      "quiz": { "title": "Topic Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] },
      "contents": [
        { "type": "HTML"|"CODE", "title": "Content Title", "htmlContent": "...", "language": "python (CODE blocks only)" }
      ]
    }
  ]
}
*CRITICAL*: Do NOT generate a Module above Lesson. Every "questions" array and every "contents" array MUST be fully populated.`,

  TOPIC: `SCOPE: TOPIC (GENERATION DEPTH: FULL_TOPIC)
Generate 1 complete Topic: fully-written Content blocks and a Quiz with fully-written questions.
Output JSON Schema:
{
  "title": "Topic Title",
  "description": "Topic Description",
  "contents": [
    { "type": "HTML"|"CODE", "title": "Content Title", "htmlContent": "...", "language": "python (CODE blocks only)" }
  ],
  "quiz": { "title": "Topic Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] }
}
*CRITICAL*: Do NOT generate a Module or Lesson above Topic. Both "contents" and the quiz's "questions" array MUST be fully populated.`,

  CONTENT: `SCOPE: CONTENT (GENERATION DEPTH: CONTENT_ONLY)
Generate Content blocks only under the selected existing topic.
Output JSON Schema:
{
  "contents": [
    { "type": "HTML"|"CODE", "title": "Content Title", "htmlContent": "...", "language": "python (CODE blocks only)" }
  ]
}
*CRITICAL*: Do NOT generate a Module, Lesson, Topic, or Quiz.`,

  QUIZ: `SCOPE: QUIZ (GENERATION DEPTH: QUIZ_ONLY)
Generate 1 Quiz only.
Output JSON Schema:
{
  "title": "Quiz Title",
  "description": "Quiz Description",
  "passingScore": 70,
  "timeLimit": 15,
  "questions": [
    {
      "question": "Question text?",
      "questionType": "MCQ_SINGLE",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
      "correctAnswer": "Option 1",
      "explanation": "Brief explanation."
    }
  ]
}
*CRITICAL*: Do NOT generate a Module, Lesson, Topic, or Content.`,
};

const SCOPES_WITH_CONTENT = new Set(["MODULE", "LESSON", "TOPIC", "CONTENT"]);
const SCOPES_WITH_QUIZ = new Set(["MODULE", "LESSON", "TOPIC", "QUIZ"]);

/**
 * Builds a scope-specific system prompt containing only the JSON schema (and
 * related quiz/content rules) relevant to the requested entity scope. Every
 * scope that generates content blocks gets CONTENT_GUIDANCE, and every scope
 * that generates quizzes gets QUESTION_SCHEMA — MODULE/LESSON/TOPIC generate
 * both, so both must be attached, not just for the single-purpose CONTENT/
 * QUIZ scopes.
 */
function buildScopedSystemPrompt(scopeUpper) {
  const scopeSchema = SCOPE_SCHEMAS[scopeUpper];
  if (!scopeSchema) return SYSTEM_PROMPT;

  const sections = [HIERARCHY_RULES, scopeSchema];
  if (SCOPES_WITH_CONTENT.has(scopeUpper)) sections.push(CONTENT_GUIDANCE);
  if (SCOPES_WITH_QUIZ.has(scopeUpper)) sections.push(QUESTION_SCHEMA);
  sections.push(GENERAL_RULES);

  return sections.join("\n\n");
}

function stripMarkdownCodeFences(str) {
  if (typeof str !== "string") return str;
  let trimmed = str.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return trimmed;
}

function normalizeQuizDef(quiz) {
  if (!quiz || typeof quiz !== "object") return;
  if (quiz.passingScore === undefined) quiz.passingScore = 60;
  if (quiz.timeLimit === undefined) quiz.timeLimit = 15;
  if (quiz.isPublished === undefined) quiz.isPublished = true;
  if (Array.isArray(quiz.questions)) {
    quiz.questions.forEach((q) => {
      if (!q || typeof q !== "object") return;
      if (typeof q.questionType === "string") {
        const raw = q.questionType.toUpperCase().trim();
        if (raw.includes("MCQ") || raw.includes("MC")) q.questionType = "MCQ_SINGLE";
        else if (raw.includes("TRUE") || raw.includes("FALSE")) q.questionType = "TRUE_FALSE";
        else if (raw.includes("MULTI")) q.questionType = "MCQ_MULTI";
        else q.questionType = "MCQ_SINGLE";
      } else {
        q.questionType = "MCQ_SINGLE";
      }
    });
  }
}

/** Repair missing optional metadata/settings if missing */
function normalizeCourseJson(json) {
  if (!json || typeof json !== "object") return json;

  json.version = json.version || "2.0";

  if (!json.metadata) json.metadata = {};
  if (!json.metadata.title) json.metadata.title = "AI Generated Course";
  if (!json.metadata.category) json.metadata.category = "Computer Science";
  if (!json.metadata.level) json.metadata.level = "BEGINNER";
  if (!json.metadata.language) json.metadata.language = "English";

  if (!json.settings) {
    json.settings = {
      visibility: "PUBLIC",
      certificatesEnabled: true,
      discussionEnabled: true,
      dripContentEnabled: false,
    };
  }

  if (!Array.isArray(json.quizzes)) json.quizzes = [];
  json.quizzes.forEach(normalizeQuizDef);

  if (!Array.isArray(json.modules)) json.modules = [];

  // Normalize order & missing topics/contents
  json.modules.forEach((mod, mIdx) => {
    if (!mod.order) mod.order = mIdx + 1;
    if (mod.isPublished === undefined) mod.isPublished = true;
    if (!Array.isArray(mod.quizzes)) mod.quizzes = [];
    mod.quizzes.forEach(normalizeQuizDef);
    if (!Array.isArray(mod.lessons)) mod.lessons = [];

    mod.lessons.forEach((les, lIdx) => {
      if (!les.order) les.order = lIdx + 1;
      if (les.isPublished === undefined) les.isPublished = true;

      if (!Array.isArray(les.topics) || les.topics.length === 0) {
        les.topics = [{ title: "General", order: 1, isPublished: true, contents: [] }];
      }

      les.topics.forEach((top, tIdx) => {
        if (!top.order) top.order = tIdx + 1;
        if (top.isPublished === undefined) top.isPublished = true;

        if (!Array.isArray(top.contents)) top.contents = [];
        top.contents = top.contents.filter((cnt) => {
          if (!cnt || typeof cnt !== "object") return false;
          if (cnt.type?.toUpperCase() === "QUIZ") {
            const qz = {
              title: cnt.title || "Module Quiz",
              description: cnt.description || "Quiz auto-relocated from topic",
              passingScore: 60,
              timeLimit: 15,
              isPublished: true,
              questions: Array.isArray(cnt.questions) ? cnt.questions : [],
            };
            normalizeQuizDef(qz);
            mod.quizzes.push(qz);
            return false;
          }
          return true;
        });

        top.contents.forEach((cnt, cIdx) => {
          if (!cnt.order) cnt.order = cIdx + 1;
          if (cnt.type) cnt.type = cnt.type.toUpperCase();
        });
      });
    });
  });

  return json;
}

// --- MODULE generation: bounded-concurrency, multi-request pipeline ---
//
// A single MODULE request previously asked Gemini for the ENTIRE hierarchy
// (module + all lessons + all topics + all content + all quizzes + all
// questions) in one response — for the comprehensive-course workload (5
// lessons / 15 topics / 30 content blocks / 21 quizzes / 105 questions)
// this took ~126s and is fundamentally one long serial wait, since nothing
// downstream can start until that one huge response finishes.
//
// This splits it into two phases instead, so the expensive, independently-
// generatable part (each lesson's own topics/content/quiz/questions) runs
// concurrently rather than serially, while still returning ONE complete
// result before anything is considered "generated" — no partial success,
// no skeleton, no deferred/background generation:
//
//   Phase 1 (1 request):  module title/description + module-level quiz
//                         (with questions) + a lightweight lesson roster
//                         (titles/descriptions only — small output).
//   Phase 2 (N requests, bounded by AI_MODULE_CONCURRENCY, run together via
//            Promise.all over that bounded set — never over the full
//            lesson list): each request expands ONE GROUP of the roster's
//            lessons into full topics + content + quiz + questions, using
//            only that group's lessons as context (not the whole module).
//
// The two schemas below are internal to this pipeline (not one of the
// user-facing `scope` values) and reuse the same CONTENT_GUIDANCE/
// QUESTION_SCHEMA building blocks as every other scope, so output quality/
// field requirements are identical to a direct MODULE/LESSON generation.
const MODULE_GENERATION_CONCURRENCY = Number(process.env.AI_MODULE_CONCURRENCY) || 2;

const MODULE_ROSTER_SCHEMA = `SCOPE: MODULE_ROSTER (PHASE 1 OF 2 — MODULE METADATA + MODULE QUIZ + LESSON ROSTER)
Generate the Module's title, description, one complete Module-level Quiz with fully-written questions, and a roster of Lesson titles + one-sentence descriptions for the lessons this module should contain.
Do NOT generate Topics, Content, or per-lesson/topic Quizzes here — those are generated separately afterward, per lesson.
Output JSON Schema:
{
  "title": "Module Title",
  "description": "Module Description",
  "quizzes": [{ "title": "Module Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] }],
  "lessons": [
    { "title": "Lesson Title", "description": "One-sentence description of what this lesson covers." }
  ]
}
*CRITICAL*: Each "lessons" entry has ONLY "title" and "description" — no "topics", "contents", or "quizzes" keys. Generate as many lessons as the instructor's request calls for.`;

const LESSON_GROUP_SCHEMA = `SCOPE: LESSON_GROUP (PHASE 2 OF 2 — FULL CONTENT FOR A SET OF LESSONS)
You are given a fixed list of Lessons under LESSONS TO EXPAND below (each already has a title and description — keep them essentially as given, do not invent different lessons). For EACH one, in the same order, generate its complete Topics, fully-written Content blocks per topic, and fully-written Quizzes (with questions) at both the lesson level and at each topic level.
Output JSON Schema:
{
  "lessons": [
    {
      "title": "Lesson Title (same as input)",
      "description": "Lesson Description (same as input)",
      "quizzes": [{ "title": "Lesson Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] }],
      "topics": [
        {
          "title": "Topic Title",
          "description": "Topic Description",
          "quiz": { "title": "Topic Quiz Title", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [...] },
          "contents": [
            { "type": "HTML"|"CODE", "title": "Content Title", "htmlContent": "...", "language": "python (CODE blocks only)" }
          ]
        }
      ]
    }
  ]
}
*CRITICAL*: The "lessons" array MUST contain exactly one entry per lesson listed under LESSONS TO EXPAND, in the same order. Every "questions" array and every "contents" array MUST be fully populated — never leave them empty.`;

function buildInternalSystemPrompt(schemaText, { withContent, withQuiz }) {
  const sections = [HIERARCHY_RULES, schemaText];
  if (withContent) sections.push(CONTENT_GUIDANCE);
  if (withQuiz) sections.push(QUESTION_SCHEMA);
  sections.push(GENERAL_RULES);
  return sections.join("\n\n");
}

/** Splits `items` into up to `groupCount` contiguous, roughly-equal, non-empty chunks. */
function splitIntoContiguousGroups(items, groupCount) {
  const count = Math.max(1, Math.min(groupCount, items.length));
  const groups = [];
  const baseSize = Math.floor(items.length / count);
  const remainder = items.length % count;
  let start = 0;
  for (let g = 0; g < count; g++) {
    const size = baseSize + (g < remainder ? 1 : 0);
    groups.push(items.slice(start, start + size));
    start += size;
  }
  return groups.filter((g) => g.length > 0);
}

const generateModuleInParallel = async ({ prompt, context = {} }) => {
  const requestStartTime = Date.now();
  console.log(`[AI Gen] MODULE parallel generation started (concurrency=${MODULE_GENERATION_CONCURRENCY}), prompt: "${prompt.trim().slice(0, 40)}..."`);

  const callGemini = async (systemPrompt, userPrompt, label) => {
    const start = Date.now();
    let llmResult;
    try {
      llmResult = await llmService.generate({ systemPrompt, prompt: userPrompt, context, think: false, size: "MEDIUM" });
    } catch (err) {
      console.error(`[AI Gen] MODULE ${label} LLM call error:`, err);
      const status = err.statusCode || 502;
      throw new ApiError(status, err.message || "AI generation failed.");
    }
    const duration = Date.now() - start;
    console.log(`[AI Gen] MODULE ${label} LLM response received in ${duration} ms`);

    const cleaned = stripMarkdownCodeFences(llmResult.response || "");
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(`[AI Gen] MODULE ${label} malformed JSON:`, (llmResult.response || "").slice(0, 300));
      throw new ApiError(502, `The AI returned an invalid JSON response format for ${label}. Excerpt: ${cleaned.slice(0, 100)}...`);
    }
    return parsed;
  };

  // Phase 1: module metadata + module-level quiz + lightweight lesson roster.
  const phase1SystemPrompt = buildInternalSystemPrompt(MODULE_ROSTER_SCHEMA, { withContent: false, withQuiz: true });
  const phase1UserPrompt = `CREATION SCOPE:
MODULE_ROSTER

INSTRUCTOR REQUEST:
${prompt.trim()}

EXISTING CONTEXT & SIBLING DETAILS:
${context && Object.keys(context).length > 0 ? JSON.stringify(context, null, 2) : "None"}`;

  console.log(`[AI Gen] MODULE phase 1 (roster) system prompt size: ${phase1SystemPrompt.length} chars`);
  const phase1Start = Date.now();
  const phase1Result = await callGemini(phase1SystemPrompt, phase1UserPrompt, "phase1-roster");
  const phase1Duration = Date.now() - phase1Start;

  const roster = Array.isArray(phase1Result.lessons) ? phase1Result.lessons : [];
  console.log(`[AI Gen] MODULE phase 1 complete in ${phase1Duration} ms — ${roster.length} lessons in roster, ${(phase1Result.quizzes || []).length} module quiz(zes)`);

  if (roster.length === 0) {
    const totalDuration = Date.now() - requestStartTime;
    console.log(`[AI Gen] MODULE parallel generation complete (no lessons requested) in ${totalDuration} ms — 1 request total`);
    return { title: phase1Result.title || "AI Generated Module", description: phase1Result.description || "", quizzes: phase1Result.quizzes || [], lessons: [] };
  }

  // Phase 2: split the roster into a bounded number of concurrent groups;
  // each group's request only carries that group's lessons — not the whole
  // module's roster — keeping every Phase 2 prompt small regardless of how
  // many total lessons the module has.
  const rosterWithIndex = roster.map((lesson, idx) => ({ ...lesson, __idx: idx }));
  const groups = splitIntoContiguousGroups(rosterWithIndex, MODULE_GENERATION_CONCURRENCY);
  console.log(`[AI Gen] MODULE phase 2 (lesson content) split into ${groups.length} group(s) for ${roster.length} lessons`);

  const phase2SystemPrompt = buildInternalSystemPrompt(LESSON_GROUP_SCHEMA, { withContent: true, withQuiz: true });
  console.log(`[AI Gen] MODULE phase 2 system prompt size: ${phase2SystemPrompt.length} chars`);

  const phase2Start = Date.now();
  // Promise.allSettled (not Promise.all) deliberately: if we raced ahead on
  // the first rejection like Promise.all does, the OTHER still-in-flight
  // group requests (each with their own bounded retry/backoff loop) would
  // keep running in the background, unawaited, after the overall generation
  // has already been reported as failed — silently burning more of the
  // already-scarce daily quota on a result nobody will ever use. Waiting for
  // every settlement means the failure path is a little slower, but nothing
  // keeps running past the point where this function returns.
  const settled = await Promise.allSettled(
    groups.map(async (group, groupIdx) => {
      const rosterForPrompt = group.map(({ title, description }) => ({ title, description }));
      const userPrompt = `CREATION SCOPE:
LESSON_GROUP

INSTRUCTOR REQUEST (for subject-matter context only — the lessons to expand are fixed, listed below):
${prompt.trim()}

LESSONS TO EXPAND (generate full content for exactly these ${group.length} lessons, in this exact order):
${JSON.stringify(rosterForPrompt, null, 2)}

EXISTING CONTEXT & SIBLING DETAILS:
${context && Object.keys(context).length > 0 ? JSON.stringify(context, null, 2) : "None"}`;

      const result = await callGemini(phase2SystemPrompt, userPrompt, `phase2-group${groupIdx + 1}`);
      const lessons = Array.isArray(result.lessons) ? result.lessons : [];

      // A group returning the wrong lesson count means some of this
      // module's required data is missing — fail the whole generation
      // rather than silently persisting an incomplete module.
      if (lessons.length !== group.length) {
        throw new ApiError(
          502,
          `AI generation incomplete: group ${groupIdx + 1} was asked for ${group.length} lesson(s) but returned ${lessons.length}.`
        );
      }

      return group.map((rosterLesson, i) => ({ originalIndex: rosterLesson.__idx, lesson: lessons[i] }));
    })
  );
  const phase2Duration = Date.now() - phase2Start;

  const failed = settled.filter((s) => s.status === "rejected");
  if (failed.length > 0) {
    console.error(`[AI Gen] MODULE phase 2 failed — ${failed.length}/${groups.length} group(s) did not complete after ${phase2Duration} ms`);
    // No partial Module is ever persisted here — this function only returns
    // generated JSON, nothing is written to the database yet (that happens
    // later, in applyAiEntity, only once this whole function has returned
    // successfully) — so failing on the first rejection's error is safe.
    throw failed[0].reason;
  }
  const groupResults = settled.map((s) => s.value);
  console.log(`[AI Gen] MODULE phase 2 complete (all ${groups.length} group(s) succeeded) in ${phase2Duration} ms`);

  // Re-assemble in the original roster order regardless of which group
  // generated which lesson or how long each group individually took.
  const finalLessons = new Array(roster.length);
  groupResults.flat().forEach(({ originalIndex, lesson }) => {
    finalLessons[originalIndex] = lesson;
  });

  const totalDuration = Date.now() - requestStartTime;
  const totalQuestions =
    (phase1Result.quizzes || []).reduce((sum, q) => sum + (q.questions || []).length, 0) +
    finalLessons.reduce(
      (sum, l) =>
        sum +
        (l.quizzes || []).reduce((s, q) => s + (q.questions || []).length, 0) +
        (l.topics || []).reduce((s, t) => s + (t.quiz ? (t.quiz.questions || []).length : 0), 0),
      0
    );
  const totalTopics = finalLessons.reduce((sum, l) => sum + (l.topics || []).length, 0);
  const totalContents = finalLessons.reduce((sum, l) => sum + (l.topics || []).reduce((s, t) => s + (t.contents || []).length, 0), 0);
  console.log(
    `[AI Gen] MODULE parallel generation complete in ${totalDuration} ms — ${finalLessons.length} lessons, ${totalTopics} topics, ` +
      `${totalContents} content blocks, ${totalQuestions} total questions ` +
      `(phase1: ${phase1Duration}ms, phase2: ${phase2Duration}ms, requests: ${1 + groups.length})`
  );

  return {
    title: phase1Result.title || "AI Generated Module",
    description: phase1Result.description || "",
    quizzes: phase1Result.quizzes || [],
    lessons: finalLessons,
  };
};

const generateCourseFromPrompt = async ({ prompt, scope = "COURSE", context = {} }) => {
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    throw new ApiError(400, "Please provide a valid text prompt for course generation.");
  }

  const scopeUpper = (scope || "COURSE").toUpperCase();

  // MODULE generation runs the bounded-concurrency multi-request pipeline
  // above instead of the single-call path below — every other scope
  // (LESSON/TOPIC/CONTENT/QUIZ/COURSE) is unaffected.
  if (scopeUpper === "MODULE") {
    return await generateModuleInParallel({ prompt, context });
  }

  const defaultScopeSizeMap = {
    CONTENT: "SMALL",
    QUIZ: "SMALL",
    TOPIC: "SMALL",
    LESSON: "SMALL",
    MODULE: "MEDIUM",
    COURSE: "LARGE",
  };
  const courseSize = (context.size || defaultScopeSizeMap[scopeUpper] || "MEDIUM").toUpperCase();
  console.log(`[AI Gen] AI generation started for scope [${scopeUpper}] size [${courseSize}], prompt: "${prompt.trim().slice(0, 40)}..."`);
  const depthName = 
    scopeUpper === "MODULE" ? "FULL_MODULE" :
    scopeUpper === "LESSON" ? "FULL_LESSON" :
    scopeUpper === "TOPIC" ? "FULL_TOPIC" :
    scopeUpper === "CONTENT" ? "CONTENT_ONLY" :
    scopeUpper === "QUIZ" ? "QUIZ_ONLY" : "FULL_COURSE";

  const userPrompt = `CREATION SCOPE:
${scopeUpper}

GENERATION DEPTH:
${depthName}

INSTRUCTOR REQUEST:
${prompt.trim()}

REQUESTED SIZE: ${courseSize}

EXISTING CONTEXT & SIBLING DETAILS:
${context && Object.keys(context).length > 0 ? JSON.stringify(context, null, 2) : "None"}`;

  const scopedSystemPrompt = buildScopedSystemPrompt(scopeUpper);
  console.log(`[AI Gen] System prompt size for scope [${scopeUpper}]: ${scopedSystemPrompt.length} chars (full prompt: ${SYSTEM_PROMPT.length} chars)`);

  const llmStartTime = Date.now();

  let llmResult;
  try {
    llmResult = await llmService.generate({
      systemPrompt: scopedSystemPrompt,
      prompt: userPrompt,
      context,
      think: false,
      size: courseSize,
    });
  } catch (err) {
    console.error("LLM Generation call error:", err);
    const status = err.statusCode || 502;
    throw new ApiError(status, err.message || "AI generation failed.");
  }

  const llmDuration = Date.now() - llmStartTime;
  console.log(`[AI Gen] LLM response received in ${llmDuration} ms`);

  const parseStartTime = Date.now();
  const rawResponse = llmResult.response || "";
  const cleanedJsonText = stripMarkdownCodeFences(rawResponse);

  let parsedJson;
  try {
    parsedJson = JSON.parse(cleanedJsonText);
  } catch (parseErr) {
    console.error("Malformed AI JSON Response:", rawResponse.slice(0, 300));
    throw new ApiError(502, `The AI returned an invalid JSON response format. Excerpt: ${cleanedJsonText.slice(0, 100)}...`);
  }

  const parseDuration = Date.now() - parseStartTime;
  console.log(`[AI Gen] JSON parsed: ${parseDuration} ms`);

  if (scope && scope.toUpperCase() !== "COURSE") {
    console.log(`[AI Gen] Returning generated payload for scope: ${scope}`);
    return parsedJson;
  }

  const validationStartTime = Date.now();
  const normalizedJson = normalizeCourseJson(parsedJson);

  const validation = validateV2Manifest(normalizedJson);
  if (!validation.isValid) {
    console.warn("AI Generated Course failed validation:", validation.errors);
    throw new ApiError(422, `Generated course structure is invalid: ${validation.errors.join("; ")}`);
  }

  const validationDuration = Date.now() - validationStartTime;
  console.log(`[AI Gen] validateV2Manifest completed: ${validationDuration} ms`);

  const totalDuration = Date.now() - requestStartTime;
  console.log(`[AI Gen] Total AI generation for size [${courseSize}]: ${totalDuration} ms`);

  return normalizedJson;
};

module.exports = { generateCourseFromPrompt };
