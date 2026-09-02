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
    "explanation": "Brief explanation.",
    "marks": 1,
    "negativeMarks": 0,
    "difficulty": "EASY"
  }
- Use "MCQ_SINGLE" (the default) when exactly one option is correct. "correctAnswer" MUST then be a single option string, exactly matching one entry in "options".
- Use "MCQ_MULTI" only when the question genuinely has more than one correct option. "correctAnswer" MUST then be an array of the correct option strings (2 or more), each exactly matching an entry in "options". Do not use "MCQ_MULTI" for a question with only one correct option.
- Prefer "MCQ_SINGLE" unless the question clearly requires multiple correct selections.`;

const GENERAL_RULES = `GENERAL RULES:
Do NOT include database IDs (id, courseId, etc.). Keep string values clean and valid JSON.`;

const SCOPE_SCHEMAS = {
  MODULE: `SCOPE: MODULE (GENERATION DEPTH: FULL_MODULE)
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
            { "type": "HTML"|"CODE", "title": "Content Title", "htmlContent": "...", "language": "python (CODE blocks only)" }
          ]
        }
      ]
    }
  ]
}
*CRITICAL*: Do NOT generate Course metadata or Course wrapper above Module.`,

  LESSON: `SCOPE: LESSON (GENERATION DEPTH: FULL_LESSON)
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
        { "type": "HTML"|"CODE", "title": "Content Title", "htmlContent": "...", "language": "python (CODE blocks only)" }
      ]
    }
  ]
}
*CRITICAL*: Do NOT generate a Module above Lesson.`,

  TOPIC: `SCOPE: TOPIC (GENERATION DEPTH: FULL_TOPIC)
Generate 1 Topic containing Content blocks and a Quiz.
Output JSON Schema:
{
  "title": "Topic Title",
  "description": "Topic Description",
  "contents": [
    { "type": "HTML"|"CODE", "title": "Content Title", "htmlContent": "...", "language": "python (CODE blocks only)" }
  ],
  "quiz": {
    "title": "Topic Quiz Title",
    "description": "...",
    "passingScore": 70,
    "timeLimit": 15,
    "questions": [...]
  }
}
*CRITICAL*: Do NOT generate a Module or Lesson above Topic.`,

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

const SCOPES_WITH_QUIZ = new Set(["MODULE", "LESSON", "TOPIC", "QUIZ"]);
const SCOPES_WITH_CONTENT = new Set(["MODULE", "LESSON", "TOPIC", "CONTENT"]);

/**
 * Builds a scope-specific system prompt containing only the JSON schema (and
 * related quiz/content rules) relevant to the requested entity scope, instead
 * of the full SYSTEM_PROMPT (which enumerates all 5 non-course schemas on
 * every request regardless of which one is actually needed). Falls back to
 * the unabridged SYSTEM_PROMPT for COURSE scope or any unrecognized scope.
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

const generateCourseFromPrompt = async ({ prompt, scope = "COURSE", context = {} }) => {
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    throw new ApiError(400, "Please provide a valid text prompt for course generation.");
  }

  const requestStartTime = Date.now();
  const courseSize = (context.size || "MEDIUM").toUpperCase();
  console.log(`[AI Gen] AI generation started for size [${courseSize}], prompt: "${prompt.trim().slice(0, 40)}..."`);

  const scopeUpper = (scope || "COURSE").toUpperCase();
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
