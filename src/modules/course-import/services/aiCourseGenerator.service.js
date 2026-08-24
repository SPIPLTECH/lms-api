const llmService = require("../../llm/llm.service");
const { validateV2Manifest } = require("./v2PackageImporter.service");
const ApiError = require("../../../utils/ApiError");

const SYSTEM_PROMPT = `You are an expert LMS course content generator for Orange Tree LMS.
Generate complete, valid course packages in Canonical Course JSON v2 format for ANY subject area (Computer Science, Mathematics, Physics, Business, Marketing, Cybersecurity, History, Agriculture, Finance, Languages, Professional Training, etc.).

STRICT CONSTRAINTS & OUTPUT FORMAT:
1. Output raw JSON only. Do NOT output markdown fences (\`\`\`json), thinking tags, reasoning text, or preamble.
2. COURSE SIZING & HIERARCHY RULES:
   - If Requested Course Size is AUTO: Infer the appropriate course size from the user's prompt:
     * Short, introductory, quick, basics, overview -> SMALL (3-4 modules, 2-3 lessons/module, 1 quiz/module).
     * Comprehensive, full-stack, bootcamp, masterclass, multi-week -> LARGE (8-10 modules, 3-4 lessons/module, quizzes throughout).
     * General topics or unspecified -> MEDIUM (5-7 modules, 3-4 lessons/module, 1 quiz/module).
   - SMALL: Generate 3-4 modules, 2-3 lessons per module, concise text/code/media blocks, and 1 quiz per module.
   - MEDIUM: Generate 5-7 modules, 3-4 lessons per module, clear instructional content, and 1 quiz per module.
   - LARGE: Generate 8-10 modules, 3-4 lessons per module, comprehensive instructional content, and quizzes throughout.
3. CONCISE FORMATTING (PREVENT TRUNCATION & MAXIMIZE SPEED):
   - Course title: Infer an engaging, clear title if not explicitly provided.
   - Course description: 1-2 clear sentences summarizing the course.
   - Category: Infer relevant category (e.g., Computer Science, Business, Physics, History, etc.).
   - Level: Infer level (BEGINNER, INTERMEDIATE, ADVANCED). Default to BEGINNER if unspecified.
   - Module description: 1-2 clear sentences.
   - Lesson description: 1 short sentence.
   - Topic explanation / htmlContent: 1-2 informative paragraphs or structured HTML (<h3>, <p>, <code>, <ul>).
   - Quiz questions: Exactly 2-3 MCQ questions per quiz.
4. STRUCTURE:
   Course
   ├── metadata (title, description, category, level, estimatedLearningHours, language)
   ├── settings (visibility, certificatesEnabled, discussionEnabled, dripContentEnabled)
   ├── quizzes[] (Optional Course-level quizzes)
   └── modules[]
       ├── title, description, order, isPublished
       ├── quizzes[] (Module-level quizzes)
       │   └── title, description, passingScore, timeLimit, isPublished, questions[]
       └── lessons[]
           ├── title, description, order, isPublished
           └── topics[]
               ├── title, description, order, isPublished
               └── contents[] ({ type: "HTML"|"VIDEO"|"TEXT"|"CODE", title, order, htmlContent, videoUrl })

5. NON-COURSE SCOPE GENERATION FORMATS:
   - If Scope === "MODULE": Output JSON with { "title": "...", "description": "...", "lessons": [{ "title": "...", "description": "...", "topics": [{ "title": "...", "contents": [{ "type": "HTML", "title": "...", "htmlContent": "..." }] }] }] }.
   - If Scope === "LESSON": Output JSON with { "title": "...", "description": "...", "topics": [{ "title": "...", "description": "...", "contents": [{ "type": "HTML", "title": "...", "htmlContent": "..." }] }] }.
   - If Scope === "TOPIC": Output JSON with { "title": "...", "description": "...", "contents": [{ "type": "HTML", "title": "...", "htmlContent": "..." }] }.
   - If Scope === "CONTENT": Output JSON with { "contents": [{ "type": "HTML"|"CODE"|"TEXT", "title": "...", "htmlContent": "..." }] }.
   - If Scope === "QUIZ": Output JSON with { "title": "...", "description": "...", "passingScore": 70, "timeLimit": 15, "questions": [{ "question": "...", "questionType": "MCQ_SINGLE", "options": ["Option 1", "Option 2", "Option 3", "Option 4"], "correctAnswer": "Option 1", "explanation": "..." }] }.

6. QUIZ SCHEMA & PLACEMENT:
   - Quizzes belong ONLY in course.quizzes[], modules[].quizzes[], or returned as standalone QUIZ object. DO NOT place quizzes inside topics[].contents[].
   - Question Object Schema (questionType MUST be "MCQ_SINGLE"):
     {
       "question": "Question text?",
       "questionType": "MCQ_SINGLE",
       "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
       "correctAnswer": "Option 1",
       "explanation": "Brief answer explanation.",
       "marks": 1,
       "negativeMarks": 0,
       "difficulty": "EASY"
     }

7. Supported QuestionType values: "MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE", "FILL_BLANK", "SHORT_ANSWER".
8. Supported ContentType values: "HTML", "VIDEO", "TEXT", "CODE", "DOCUMENT", "PDF", "IMAGE", "AUDIO", "LINK", "PRESENTATION".
9. Do NOT include database IDs (id, courseId, etc.). Keep string values clean and valid JSON.`;

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

  const userPrompt = `Generate a complete LMS course package based on this request:

${prompt.trim()}

Requested Course Size: ${courseSize}
Scope: ${scope}
${context && Object.keys(context).length > 0 ? `Context Details: ${JSON.stringify(context, null, 2)}` : ""}`;

  const llmStartTime = Date.now();

  let llmResult;
  try {
    llmResult = await llmService.generate({
      systemPrompt: SYSTEM_PROMPT,
      prompt: userPrompt,
      context,
      think: false,
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
