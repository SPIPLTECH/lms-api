const llmService = require("../../llm/llm.service");
const { validateV2Manifest } = require("./v2PackageImporter.service");
const ApiError = require("../../../utils/ApiError");

const SYSTEM_PROMPT = `You are an expert LMS course content generator for Orange Tree LMS.
Generate complete, valid course packages in Canonical Course JSON v2 format.

STRICT CONSTRAINTS & OUTPUT SIZE LIMITS:
1. Output raw JSON only. Do NOT output markdown fences (\`\`\`json), thinking tags, reasoning text, or preamble.
2. ULTRA-CONCISE BREVITY RULES (MINIMIZE OUTPUT TOKENS FOR MAXIMUM SPEED):
   - Course description: maximum 1 short sentence.
   - Module description: maximum 1 short sentence.
   - Lesson description: maximum 1 short sentence.
   - Topic explanation / htmlContent: maximum 1 short sentence.
   - Code example: 3-5 lines of code.
   - Quiz question: maximum 1 short sentence.
   - Quiz option: maximum 3-5 words.
   - Quiz feedback/explanation: maximum 1 short sentence.
   - Exactly 3 quiz questions per requested quiz.
   - No unnecessary topics, extra lessons, extra quizzes, or verbose educational prose.

3. STRUCTURE:
   Course
   ├── metadata (title, description, category, level, estimatedLearningHours)
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

4. QUIZ SCHEMA & PLACEMENT:
   - Quizzes belong ONLY in course.quizzes[] or modules[].quizzes[]. DO NOT place quizzes inside topics[].contents[].
   - Question Object Schema (questionType MUST be exactly "MCQ_SINGLE"):
     {
       "question": "Question text?",
       "questionType": "MCQ_SINGLE",
       "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
       "correctAnswer": "Option 1",
       "explanation": "Brief 1-sentence explanation.",
       "marks": 1,
       "negativeMarks": 0,
       "difficulty": "EASY"
     }

5. Supported QuestionType values: "MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE", "FILL_BLANK", "SHORT_ANSWER", "LONG_ANSWER".
6. Supported ContentType values: "HTML", "VIDEO", "TEXT", "CODE", "DOCUMENT", "PDF", "IMAGE", "AUDIO", "LINK", "PRESENTATION".
7. Do NOT include database IDs (id, courseId, etc.). Keep string values concise.`;

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
      dripContentEnabled: false
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
              questions: Array.isArray(cnt.questions) ? cnt.questions : []
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
  console.log(`[AI Gen] AI generation started for prompt: "${prompt.trim().slice(0, 40)}..."`);

  const userPrompt = `Generate a complete LMS course package based on this request:

${prompt.trim()}

Scope: ${scope}
${context && Object.keys(context).length > 0 ? `Context: ${JSON.stringify(context)}` : ""}`;

  const ollamaStartTime = Date.now();
  console.log(`[AI Gen] Ollama request started...`);

  let llmResult;
  try {
    llmResult = await llmService.generate({
      systemPrompt: SYSTEM_PROMPT,
      prompt: userPrompt,
      context,
      think: false, // Ensure reasoning/thinking is explicitly disabled
    });
  } catch (err) {
    console.error("LLM Generation call error:", err);
    throw new ApiError(502, `AI generation failed: ${err.message || "Could not reach LLM service."}`);
  }

  const ollamaDuration = Date.now() - ollamaStartTime;
  console.log(`[AI Gen] Ollama response received: ${ollamaDuration} ms`);

  const parseStartTime = Date.now();
  const rawResponse = llmResult.response || "";
  const cleanedJsonText = stripMarkdownCodeFences(rawResponse);

  let parsedJson;
  try {
    parsedJson = JSON.parse(cleanedJsonText);
  } catch (parseErr) {
    console.error("Malformed AI JSON Response:", rawResponse);
    throw new ApiError(502, `The AI returned an invalid JSON response format. Raw excerpt: ${cleanedJsonText.slice(0, 100)}...`);
  }

  const parseDuration = Date.now() - parseStartTime;
  console.log(`[AI Gen] JSON parsed: ${parseDuration} ms`);

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
  console.log(`[AI Gen] Total AI generation: ${totalDuration} ms`);

  return normalizedJson;
};

module.exports = { generateCourseFromPrompt };
