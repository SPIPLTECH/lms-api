/**
 * Flexible course JSON — the one reader behind JSON import, AI course
 * generation and course.json packages.
 *
 * Two spellings of the same hierarchy are accepted, and may be mixed:
 *  - Template format (fixtures/course_json_template.json): `course`, plus
 *    `content` / `quiz` / `assignment` on any level.
 *  - Canonical V2: `metadata`, `settings`, plus `contents` / `quizzes` /
 *    `assignments` — what the exporter, ZIP packages and the draft Composer
 *    produce.
 *
 * The template shows HOW course JSON looks, not WHAT a course must contain.
 * Every level and every element is optional. Only what is present is
 * validated, and only against what the LMS itself needs: titles, a known
 * content type, an assignment due date, answer keys that match their options,
 * and ID references that agree with the nesting. Order is not part of the
 * JSON: it follows position. Nothing is added, removed or rearranged — the
 * output is the same hierarchy, spelled canonically (V2 keys at every level).
 */

const CONTENT_TYPES = [
  "VIDEO", "DOCUMENT", "TEXT", "LINK", "PRESENTATION", "IMAGE", "PDF", "FILE", "EXTERNAL_LINK",
  "HTML", "CODE", "ASSIGNMENT", "CODING_EXERCISE", "SCORM", "INTERACTIVE_LAB", "AUDIO", "EMBED", "SLIDE",
];
const QUESTION_TYPES = [
  "MCQ_SINGLE", "MCQ_MULTI", "ARRANGE_TOKENS", "MATCH_PAIRS", "SELF_ASSESSMENT", "MCQ",
  "MULTIPLE_CORRECT", "TRUE_FALSE", "FILL_BLANK", "SHORT_ANSWER", "LONG_ANSWER",
];
const OPTION_QUESTION_TYPES = new Set(["MCQ_SINGLE", "MCQ", "MCQ_MULTI", "MULTIPLE_CORRECT"]);
const MULTI_ANSWER_QUESTION_TYPES = new Set(["MCQ_MULTI", "MULTIPLE_CORRECT"]);
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const VISIBILITIES = ["PUBLIC", "PRIVATE", "UNLISTED"];

// The database stores two tags. The level-named assessment tags are the
// template's vocabulary for FINAL — the level itself is carried by where the
// quiz is nested, so nothing is lost in the mapping.
const QUIZ_TAG_TO_DB = {
  SELF_TEST: "SELF_TEST",
  FINAL: "FINAL",
  LESSON_ASSESSMENT: "FINAL",
  MODULE_ASSESSMENT: "FINAL",
  COURSE_ASSESSMENT: "FINAL",
};
const ASSESSMENT_TAG_LEVEL = {
  LESSON_ASSESSMENT: "lesson",
  MODULE_ASSESSMENT: "module",
  COURSE_ASSESSMENT: "course",
};

const LEVELS = {
  course: { childKey: "modules", childLevel: "module", refKey: "courseId" },
  module: { childKey: "lessons", childLevel: "lesson", refKey: "moduleId" },
  lesson: { childKey: "topics", childLevel: "topic", refKey: "lessonId" },
  topic: { childKey: null, childLevel: null, refKey: "topicId" },
};
const LEVEL_NAMES = Object.keys(LEVELS);

// Keys that hold a level's lists; they are rebuilt, never copied through.
const LIST_KEYS = ["content", "contents", "quiz", "quizzes", "assignment", "assignments", "modules", "lessons", "topics"];
// Root keys that are package plumbing rather than course fields.
const ROOT_KEYS = ["course", "metadata", "settings", "version", "$schema", "assetMap"];

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isPresent = (value) => value !== undefined && value !== null;
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const joinPath = (base, key) => (base ? `${base}.${key}` : key);
const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)));
const normalizeOptionText = (value) => String(value).trim().toLowerCase();
const quote = (value) => JSON.stringify(value);

const checkString = (obj, key, path, report) => {
  if (isPresent(obj[key]) && typeof obj[key] !== "string") report.errors.push(`${joinPath(path, key)} must be a string.`);
};
const checkBoolean = (obj, key, path, report) => {
  if (isPresent(obj[key]) && typeof obj[key] !== "boolean") report.errors.push(`${joinPath(path, key)} must be true or false.`);
};
const checkNumber = (obj, key, path, report, { integer = false, min, max } = {}) => {
  const value = obj[key];
  if (!isPresent(value)) return;
  const valid = typeof value === "number" && Number.isFinite(value) && (!integer || Number.isInteger(value));
  if (!valid || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    const kind = integer ? "a whole number" : "a number";
    const range = min !== undefined && max !== undefined ? ` between ${min} and ${max}` : min !== undefined ? ` of at least ${min}` : "";
    report.errors.push(`${joinPath(path, key)} must be ${kind}${range}.`);
  }
};
const checkDate = (obj, key, path, report) => {
  if (isPresent(obj[key]) && (typeof obj[key] !== "string" || Number.isNaN(Date.parse(obj[key])))) {
    report.errors.push(`${joinPath(path, key)} must be an ISO 8601 date, e.g. "2026-11-15T23:59:00.000Z".`);
  }
};
const checkEnum = (value, allowed, path, report) => {
  const normalized = String(value).trim().toUpperCase();
  if (allowed.includes(normalized)) return normalized;
  report.errors.push(`${path} ${quote(value)} is not supported. Use one of: ${allowed.join(", ")}.`);
  return value;
};

/**
 * Problems with one question, phrased without a path so both the parser and
 * the AI repair step can use them. Answer keys are compared the way
 * quiz.service.js grades them: trimmed and case-insensitive.
 */
function getQuestionProblems(question) {
  if (!isPlainObject(question)) return ["must be an object"];

  const problems = [];
  if (!isNonEmptyString(question.question)) problems.push(`"question" text is required`);

  const type = isPresent(question.questionType) ? String(question.questionType).trim().toUpperCase() : "MCQ_SINGLE";
  if (!QUESTION_TYPES.includes(type)) {
    problems.push(`questionType ${quote(question.questionType)} is not supported (use one of: ${QUESTION_TYPES.join(", ")})`);
    return problems;
  }
  if (!OPTION_QUESTION_TYPES.has(type)) return problems;

  const { options, correctAnswer } = question;
  if (!Array.isArray(options) || options.length < 2) {
    problems.push(`"options" must list at least two choices`);
    return problems;
  }

  const comparable = options.every((option) => typeof option === "string" || typeof option === "number");
  const optionSet = new Set(options.map(normalizeOptionText));
  const hasKey = (answer) => isPresent(answer) && String(answer).trim() !== "";
  const unmatched = (answers) => (comparable ? answers.filter((answer) => !optionSet.has(normalizeOptionText(answer))) : []);

  if (MULTI_ANSWER_QUESTION_TYPES.has(type)) {
    if (!Array.isArray(correctAnswer) || correctAnswer.length === 0 || !correctAnswer.every(hasKey)) {
      problems.push(`"correctAnswer" must be a non-empty array of the correct options for ${type}`);
    } else if (unmatched(correctAnswer).length > 0) {
      problems.push(`"correctAnswer" entries ${unmatched(correctAnswer).map(quote).join(", ")} do not match any option`);
    }
  } else if (!hasKey(correctAnswer)) {
    problems.push(`"correctAnswer" is required`);
  } else if (Array.isArray(correctAnswer)) {
    problems.push(`"correctAnswer" must be a single option for ${type}`);
  } else if (unmatched([correctAnswer]).length > 0) {
    problems.push(`"correctAnswer" ${quote(correctAnswer)} does not match any option`);
  }

  return problems;
}

/**
 * Order is automatic: an item's position in its list is its order, the way the
 * draft Composer numbers what it inserts. Any `order` value in the JSON is
 * ignored, so it can neither conflict nor be forgotten.
 */
function normalizeOrderedList(entries, normalizeEntry) {
  return entries
    .map(normalizeEntry)
    .filter((value) => value !== null)
    .map((value, index) => Object.assign(value, { order: index + 1 }));
}

function normalizeContent({ value: item, path }, ctx) {
  const { report } = ctx;
  if (!isPlainObject(item)) {
    report.errors.push(`${path} must be an object.`);
    return null;
  }

  const rawType = isPresent(item.type) ? item.type : item.contentType;
  let type = null;
  if (isPresent(rawType) && typeof rawType !== "string") {
    report.errors.push(`${path}.type must be a string.`);
  } else if (isNonEmptyString(rawType)) {
    type = rawType.trim().toUpperCase();
  } else if (isNonEmptyString(item.htmlContent) || isNonEmptyString(item.data?.markdown)) {
    type = "HTML";
  } else if (isNonEmptyString(item.videoUrl)) {
    type = "VIDEO";
  } else {
    report.errors.push(`${path}.type is required (for example "HTML", "VIDEO" or "DOCUMENT").`);
  }
  if (type && !CONTENT_TYPES.includes(type)) {
    report.errors.push(`${path}.type ${quote(rawType)} is not a supported content type. Use one of: ${CONTENT_TYPES.join(", ")}.`);
  }

  for (const key of ["title", "htmlContent", "videoUrl", "fileUrl", "externalUrl", "mediaFile"]) checkString(item, key, path, report);
  checkNumber(item, "duration", path, report, { integer: true, min: 0 });

  if ((type === "HTML" || type === "TEXT") && !isNonEmptyString(item.htmlContent) && !isNonEmptyString(item.data?.markdown)) {
    report.warnings.push(`${path} is ${type} content with no htmlContent, so it will render empty.`);
  }
  if (type === "VIDEO" && !item.videoUrl && !item.mediaFile && !item.externalUrl) {
    report.warnings.push(`${path} is a VIDEO with no videoUrl, mediaFile or externalUrl.`);
  }

  const normalized = { ...item, ...(type && { type }) };
  ctx.paths.set(normalized, path);
  return normalized;
}

function normalizeQuiz({ value: quiz, path }, level, ctx) {
  const { report } = ctx;
  if (!isPlainObject(quiz)) {
    report.errors.push(`${path} must be an object.`);
    return null;
  }

  if (!isNonEmptyString(quiz.title)) report.errors.push(`${path}.title is required.`);
  checkString(quiz, "description", path, report);
  checkBoolean(quiz, "isPublished", path, report);
  checkNumber(quiz, "passingScore", path, report, { integer: true, min: 0, max: 100 });
  checkNumber(quiz, "timeLimit", path, report, { integer: true, min: 0 });

  let quizTag;
  if (isPresent(quiz.quizTag)) {
    const tag = String(quiz.quizTag).trim().toUpperCase();
    if (!QUIZ_TAG_TO_DB[tag]) {
      report.errors.push(`${path}.quizTag ${quote(quiz.quizTag)} is not supported. Use one of: ${Object.keys(QUIZ_TAG_TO_DB).join(", ")}.`);
    } else {
      quizTag = tag;
      const taggedLevel = ASSESSMENT_TAG_LEVEL[tag];
      if (taggedLevel && taggedLevel !== level) {
        report.warnings.push(`${path}.quizTag is ${tag}, but the quiz is nested at ${level} level; it is imported as a ${level}-level assessment.`);
      }
    }
  }

  let questions = [];
  if (isPresent(quiz.questions) && !Array.isArray(quiz.questions)) {
    report.errors.push(`${path}.questions must be an array.`);
  } else if (Array.isArray(quiz.questions)) {
    questions = quiz.questions.map((question, index) => {
      const questionPath = `${path}.questions[${index}]`;
      if (!isPlainObject(question)) {
        report.errors.push(`${questionPath} must be an object.`);
        return null;
      }
      if (ctx.checkAnswerKeys) {
        getQuestionProblems(question).forEach((problem) => report.errors.push(`${questionPath}: ${problem}.`));
      }
      checkNumber(question, "marks", questionPath, report, { integer: true, min: 0 });
      checkNumber(question, "negativeMarks", questionPath, report, { min: 0 });
      const normalized = { ...question };
      if (isPresent(question.questionType)) normalized.questionType = String(question.questionType).trim().toUpperCase();
      if (isPresent(question.difficulty)) normalized.difficulty = checkEnum(question.difficulty, DIFFICULTIES, `${questionPath}.difficulty`, report);
      return normalized;
    }).filter(Boolean);
  }
  if (questions.length === 0) report.warnings.push(`${path} ("${quiz.title || "untitled"}") has no questions.`);

  const normalized = { ...quiz, ...(quizTag && { quizTag }), questions };
  ctx.paths.set(normalized, path);
  return normalized;
}

function normalizeAssignment({ value: assignment, path }, ctx) {
  const { report } = ctx;
  if (!isPlainObject(assignment)) {
    report.errors.push(`${path} must be an object.`);
    return null;
  }

  if (!isNonEmptyString(assignment.title)) report.errors.push(`${path}.title is required.`);
  if (!isPresent(assignment.dueDate)) {
    report.errors.push(`${path}.dueDate is required — the LMS needs a due date for every assignment (ISO 8601, e.g. "2026-11-15T23:59:00.000Z").`);
  }
  for (const key of ["dueDate", "startDate", "availableFrom", "availableUntil"]) checkDate(assignment, key, path, report);
  for (const key of ["description", "assessmentType"]) checkString(assignment, key, path, report);
  for (const key of ["marks", "estimatedTime", "totalQuestions", "resources"]) checkNumber(assignment, key, path, report, { integer: true, min: 0 });
  checkBoolean(assignment, "isPublished", path, report);

  const normalized = { ...assignment };
  ctx.paths.set(normalized, path);
  return normalized;
}

/** `content` (template) and `contents` (V2) are two names for one list. */
function readContentEntries(node, path, report) {
  const hasContent = isPresent(node.content);
  if (hasContent && isPresent(node.contents)) {
    report.errors.push(`${path || "course"} has both "content" and "contents"; use one of them.`);
  }
  const key = hasContent ? "content" : "contents";
  const listPath = joinPath(path, key);
  if (!isPresent(node[key])) return { listPath, entries: [] };
  if (!Array.isArray(node[key])) {
    report.errors.push(`${listPath} must be an array.`);
    return { listPath, entries: [] };
  }
  return { listPath, entries: node[key].map((value, index) => ({ value, path: `${listPath}[${index}]` })) };
}

/** `quiz` / `assignment` hold one object (template); `quizzes` / `assignments` a list (V2). Both may appear. */
function readAssessmentEntries(node, path, singular, plural, report) {
  const entries = [];
  if (isPresent(node[singular])) {
    if (Array.isArray(node[singular])) report.errors.push(`${joinPath(path, singular)} must be a single object; use "${plural}" for a list.`);
    else entries.push({ value: node[singular], path: joinPath(path, singular) });
  }
  if (isPresent(node[plural])) {
    if (!Array.isArray(node[plural])) report.errors.push(`${joinPath(path, plural)} must be an array.`);
    else node[plural].forEach((value, index) => entries.push({ value, path: `${joinPath(path, plural)}[${index}]` }));
  }
  return entries;
}

/** Reads one level's content, quizzes, assignments and child entities. */
function normalizeLevelLists(node, level, path, ctx) {
  const { report } = ctx;
  const { entries: contentEntries } = readContentEntries(node, path, report);

  const lists = {
    contents: normalizeOrderedList(contentEntries, (entry) => normalizeContent(entry, ctx)),
    quizzes: readAssessmentEntries(node, path, "quiz", "quizzes", report)
      .map((entry) => normalizeQuiz(entry, level, ctx))
      .filter(Boolean),
    assignments: readAssessmentEntries(node, path, "assignment", "assignments", report)
      .map((entry) => normalizeAssignment(entry, ctx))
      .filter(Boolean),
  };

  const { childKey, childLevel } = LEVELS[level];
  if (childKey) {
    const listPath = joinPath(path, childKey);
    const raw = node[childKey];
    lists[childKey] = [];
    if (isPresent(raw) && !Array.isArray(raw)) {
      report.errors.push(`${listPath} must be an array.`);
    } else if (Array.isArray(raw)) {
      const entries = raw.map((value, index) => ({ value, path: `${listPath}[${index}]` }));
      lists[childKey] = normalizeOrderedList(entries, (entry) => normalizeEntity(entry, childLevel, ctx));
    }
  }

  // Content and quizzes share one order sequence per parent (see
  // contents/contentOrder.util.js). A level's quizzes come after its content
  // and its children, as the template lists them — which also keeps quiz
  // orders unique on the level, as the database requires.
  const quizBase = Math.max(lists.contents.length, childKey ? lists[childKey].length : 0);
  lists.quizzes.forEach((quiz, index) => Object.assign(quiz, { order: quizBase + index + 1 }));

  return lists;
}

function normalizeEntity({ value: node, path }, level, ctx) {
  const { report } = ctx;
  if (!isPlainObject(node)) {
    report.errors.push(`${path} must be an object.`);
    return null;
  }

  if (!isNonEmptyString(node.title)) report.errors.push(`${path}.title is required.`);
  checkString(node, "description", path, report);
  checkBoolean(node, "isPublished", path, report);

  const normalized = { ...omit(node, LIST_KEYS), ...normalizeLevelLists(node, level, path, ctx) };
  ctx.paths.set(normalized, path);
  return normalized;
}

/**
 * Checks that every `courseId` / `moduleId` / `lessonId` / `topicId` agrees
 * with where the object is nested. A reference names the nearest enclosing
 * entity of that level — a lesson's `moduleId` names its module, a topic
 * quiz's `topicId` names its topic, a module's own `moduleId` names itself.
 * Nesting stays authoritative; these IDs only have to be consistent with it.
 * An entity whose references agree gets that ID as its `id`, so the draft
 * Composer keys it by the same value its descendants already refer to.
 */
function checkReferences(canonical, ctx) {
  const { report, paths } = ctx;
  const claimsByEntity = new Map();
  const labelOf = (obj) => paths.get(obj) || "course";

  const claim = (entity, level, value, path) => {
    if (!claimsByEntity.has(entity)) claimsByEntity.set(entity, { level, claims: [] });
    claimsByEntity.get(entity).claims.push({ value, path });
  };

  const visit = (obj, objPath, scope, ownEntity) => {
    for (const level of LEVEL_NAMES) {
      const key = LEVELS[level].refKey;
      const value = obj[key];
      if (!isPresent(value) || value === "") continue;
      if (typeof value !== "string" && typeof value !== "number") {
        report.errors.push(`${joinPath(objPath, key)} must be a string.`);
        continue;
      }
      if (!scope[level]) {
        report.errors.push(`${joinPath(objPath, key)} is ${quote(value)}, but ${objPath} is not inside a ${level}. Nest it under that ${level} or remove ${key}.`);
        continue;
      }
      claim(scope[level].entity, level, String(value), joinPath(objPath, key));
    }
    if (ownEntity && isPresent(obj.id) && obj.id !== "") claim(ownEntity.entity, ownEntity.level, String(obj.id), joinPath(objPath, "id"));
  };

  const walk = (entity, level, parentScope) => {
    const own = { entity, level };
    const scope = { ...parentScope, [level]: own };
    // The course's own fields live in metadata; every other entity is its own node.
    const self = level === "course" ? canonical.metadata : entity;
    visit(self, level === "course" ? paths.get(canonical.metadata) || "course" : labelOf(entity), scope, own);
    for (const item of [...entity.contents, ...entity.quizzes, ...entity.assignments]) visit(item, labelOf(item), scope, null);
    const { childKey, childLevel } = LEVELS[level];
    if (childKey) entity[childKey].forEach((child) => walk(child, childLevel, scope));
  };
  walk(canonical, "course", {});

  const ownerById = new Map();
  for (const [entity, { level, claims }] of claimsByEntity) {
    const first = claims[0];
    const conflicting = claims.find((c) => c.value !== first.value);
    if (conflicting) {
      report.errors.push(
        `${labelOf(entity)} is referred to by different ${level} IDs: ${quote(first.value)} (${first.path}) and ${quote(conflicting.value)} (${conflicting.path}).`
      );
      continue;
    }
    const ownerKey = `${level}:${first.value}`;
    if (ownerById.has(ownerKey)) {
      report.errors.push(`${level} ID ${quote(first.value)} is used for both ${ownerById.get(ownerKey)} and ${labelOf(entity)}; IDs must be unique.`);
      continue;
    }
    ownerById.set(ownerKey, labelOf(entity));
    if (entity !== canonical && !isPresent(entity.id)) entity.id = first.value;
  }
}

function summarizeCourse(canonical) {
  const summary = { modules: 0, lessons: 0, topics: 0, contents: 0, quizzes: 0, questions: 0, assignments: 0 };
  if (!canonical) return summary;

  const walk = (entity, level) => {
    summary.contents += (entity.contents || []).length;
    summary.quizzes += (entity.quizzes || []).length;
    summary.questions += (entity.quizzes || []).reduce((sum, quiz) => sum + (quiz.questions || []).length, 0);
    summary.assignments += (entity.assignments || []).length;
    const { childKey, childLevel } = LEVELS[level];
    if (!childKey) return;
    (entity[childKey] || []).forEach((child) => {
      summary[childKey] += 1;
      walk(child, childLevel);
    });
  };
  walk(canonical, "course");
  return summary;
}

function describeSummary(summary) {
  const parts = [
    [summary.modules, "module"],
    [summary.lessons, "lesson"],
    [summary.topics, "topic"],
    [summary.contents, "content item"],
    [summary.quizzes, "quiz", "quizzes"],
    [summary.questions, "question"],
    [summary.assignments, "assignment"],
  ]
    .filter(([count]) => count > 0)
    .map(([count, singular, plural]) => `${count} ${count === 1 ? singular : plural || `${singular}s`}`);
  return parts.join(", ");
}

/** True when the object is course JSON in either spelling (used to route packages). */
function looksLikeCourseJson(json) {
  if (!isPlainObject(json)) return false;
  return json.version === "2.0" || isPlainObject(json.course) || isPlainObject(json.metadata) || LIST_KEYS.some((key) => isPresent(json[key]));
}

/**
 * Validates and normalizes course JSON.
 *
 * @param {object} input Course JSON in template or V2 spelling.
 * @param {object} [options]
 * @param {boolean} [options.checkReferences=true] Check ID references against nesting. Off once a job
 *   has been ingested: the draft Composer then owns the IDs, and nesting alone defines the structure.
 * @param {boolean} [options.checkAnswerKeys=true] Require MCQ answer keys that match their options.
 * @returns {{ isValid: boolean, errors: string[], warnings: string[], canonical: object|null, summary: object }}
 */
function parseCourseJson(input, { checkReferences: withReferences = true, checkAnswerKeys = true } = {}) {
  const report = { errors: [], warnings: [] };
  if (!isPlainObject(input)) {
    return { isValid: false, errors: ["Course JSON must be an object."], warnings: [], canonical: null, summary: summarizeCourse(null) };
  }

  const ctx = { report, paths: new WeakMap(), checkAnswerKeys };

  // Where the course's own fields live: `course` (template), `metadata` (V2), or the root itself.
  const infoKey = isPlainObject(input.course) ? "course" : isPlainObject(input.metadata) ? "metadata" : null;
  const info = infoKey ? input[infoKey] : input;
  if (infoKey === "course" && isPlainObject(input.metadata)) {
    report.warnings.push(`Both "course" and "metadata" are present; "metadata" was ignored.`);
  }
  // An older shape nests the lists inside `course` itself.
  const listsHolder = infoKey === "course" && !LIST_KEYS.some((key) => isPresent(input[key])) && LIST_KEYS.some((key) => isPresent(info[key]))
    ? info
    : input;
  const listsPath = listsHolder === input ? "" : "course";

  const infoPath = infoKey || "course";
  if (!isNonEmptyString(info.title)) report.errors.push(`${infoPath}.title is required.`);
  for (const key of ["description", "category", "level", "language", "thumbnail", "thumbnailUrl"]) checkString(info, key, infoKey || "", report);
  checkNumber(info, "estimatedLearningHours", infoKey || "", report, { min: 0 });
  if (isPresent(info.tags) && (!Array.isArray(info.tags) || !info.tags.every((tag) => typeof tag === "string"))) {
    report.errors.push(`${joinPath(infoKey || "", "tags")} must be an array of strings.`);
  }
  if (isPresent(info.status) && String(info.status).trim().toUpperCase() !== "DRAFT") {
    report.warnings.push(`${joinPath(infoKey || "", "status")} is ${quote(info.status)}, but imported courses are always created as DRAFT.`);
  }

  if (isPresent(input.settings) && !isPlainObject(input.settings)) report.errors.push("settings must be an object.");
  const settingsSource = isPlainObject(input.settings) ? input.settings : {};
  const settings = { ...settingsSource };
  // A setting written on the course itself (template) wins over a `settings` block.
  for (const key of ["visibility", "certificatesEnabled", "discussionEnabled"]) {
    if (isPresent(info[key])) settings[key] = info[key];
  }
  const settingsPath = (key) => (isPresent(info[key]) ? joinPath(infoKey || "", key) : `settings.${key}`);
  if (isPresent(settings.visibility)) settings.visibility = checkEnum(settings.visibility, VISIBILITIES, settingsPath("visibility"), report);
  for (const key of ["certificatesEnabled", "discussionEnabled"]) {
    if (isPresent(settings[key]) && typeof settings[key] !== "boolean") report.errors.push(`${settingsPath(key)} must be true or false.`);
  }

  const metadata = omit(info, infoKey ? LIST_KEYS : [...LIST_KEYS, ...ROOT_KEYS]);
  if (infoKey) ctx.paths.set(metadata, infoKey);

  const canonical = {
    version: "2.0",
    ...(isPresent(input.$schema) && { $schema: input.$schema }),
    metadata,
    settings,
    ...normalizeLevelLists(listsHolder, "course", listsPath, ctx),
    assetMap: isPlainObject(input.assetMap) ? input.assetMap : {},
  };

  if (withReferences) checkReferences(canonical, ctx);

  const summary = summarizeCourse(canonical);
  if (Object.values(summary).every((count) => count === 0)) {
    report.warnings.push("The course has no content, modules, quizzes or assignments yet — only its details will be created.");
  }

  return { isValid: report.errors.length === 0, errors: report.errors, warnings: report.warnings, canonical, summary };
}

/** The job's validationReport, in the shape the import UI already reads. */
function buildValidationReport(parsed, extraWarnings = []) {
  const described = describeSummary(parsed.summary);
  return {
    isValid: parsed.isValid,
    errors: parsed.errors,
    warnings: [...extraWarnings, ...parsed.warnings],
    info: parsed.isValid
      ? [`Course JSON is valid${described ? `: ${described}` : ""}.`]
      : [`Course JSON has ${parsed.errors.length} problem${parsed.errors.length === 1 ? "" : "s"} to fix before it can be imported.`],
    summary: parsed.summary,
  };
}

const toDbQuizTag = (tag) => (isPresent(tag) && QUIZ_TAG_TO_DB[String(tag).trim().toUpperCase()] === "SELF_TEST" ? "SELF_TEST" : "FINAL");

module.exports = {
  CONTENT_TYPES,
  QUIZ_TAG_TO_DB,
  LEVELS,
  parseCourseJson,
  buildValidationReport,
  getQuestionProblems,
  summarizeCourse,
  looksLikeCourseJson,
  toDbQuizTag,
};
