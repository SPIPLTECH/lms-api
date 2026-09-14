const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Readable } = require("stream");
const csvParser = require("csv-parser");
const { marked } = require("marked");

const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const { normalizeQuestion } = require("../../../utils/helpers/question.helper");

/**
 * Importer for *physical* course packages — ZIPs where the Course -> Modules ->
 * Lessons -> Topics hierarchy exists as real directories and each artifact is a
 * file in the folder that gives it meaning. There is no course.json; the tree
 * itself is the manifest.
 *
 * Deliberately kept separate from v2PackageImporter.service.js: that one parses
 * a declared JSON document, this one derives structure from directory layout.
 * They share the database shape and nothing else.
 *
 * Parsing and validation complete before a single row is written, and the write
 * then happens inside one transaction, so a package either imports whole or not
 * at all.
 */

/** Structural directory names. These are the contract. */
const DIR = {
  ROOT: "course",
  MODULES: "modules",
  LESSONS: "lessons",
  TOPICS: "topics",
  DIRECT_QUIZ: "direct quiz",
  DIRECT_ASSIGNMENT: "direct assignment",
  DIRECT_CONTENT: "direct content",
  TOPIC_QUIZ: "quiz",
  TOPIC_ASSIGNMENT: "assignment",
  TOPIC_CONTENT: "content",
};

const QUIZ_TAGS = new Set(["FINAL", "SELF_TEST"]);

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".html", ".htm", ".txt"]);
const MEDIA_TYPE_BY_EXTENSION = {
  ".png": "IMAGE", ".jpg": "IMAGE", ".jpeg": "IMAGE", ".gif": "IMAGE",
  ".svg": "IMAGE", ".webp": "IMAGE", ".bmp": "IMAGE",
  ".mp4": "VIDEO", ".webm": "VIDEO", ".mov": "VIDEO", ".avi": "VIDEO", ".mkv": "VIDEO",
  ".mp3": "AUDIO", ".wav": "AUDIO", ".ogg": "AUDIO", ".m4a": "AUDIO", ".aac": "AUDIO",
  ".pdf": "PDF", ".docx": "DOCUMENT", ".doc": "DOCUMENT",
  ".pptx": "PRESENTATION", ".ppt": "PRESENTATION",
};

const VALID_CONTENT_TYPES = new Set([
  "VIDEO", "DOCUMENT", "TEXT", "LINK", "PRESENTATION", "IMAGE", "PDF", "FILE",
  "EXTERNAL_LINK", "HTML", "CODE", "ASSIGNMENT", "CODING_EXERCISE", "SCORM",
  "INTERACTIVE_LAB", "AUDIO", "EMBED", "SLIDE",
]);

/* -------------------------------------------------------------------------- */
/* Filesystem helpers                                                          */
/* -------------------------------------------------------------------------- */

const listEntries = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return [];
  }
};

/** Directories, sorted lexically so ordering is stable across machines. */
const listDirs = (dir) =>
  listEntries(dir)
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "en"));

/** Files, lexically sorted, ignoring OS cruft. */
const listFiles = (dir) =>
  listEntries(dir)
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => name !== ".DS_Store" && name !== "Thumbs.db" && !name.startsWith("._"))
    .sort((a, b) => a.localeCompare(b, "en"));

/** Case-insensitive lookup of a child directory by its structural name. */
const findDir = (parent, lowerName) => {
  const match = listEntries(parent).find(
    (e) => e.isDirectory() && e.name.toLowerCase() === lowerName
  );
  return match ? path.join(parent, match.name) : null;
};

/** Guards against a resolved path escaping the package root. */
const isInside = (root, target) => {
  const normalizedRoot = path.normalize(root) + path.sep;
  return path.normalize(target).startsWith(normalizedRoot);
};

/** "sample_course_package" -> "Sample Course Package" */
const humanize = (value) =>
  String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Imported Course";

/* -------------------------------------------------------------------------- */
/* Detection                                                                   */
/* -------------------------------------------------------------------------- */

/** True when a directory looks like the root of a physical course package. */
const looksLikeCourseRoot = (dir) =>
  Boolean(
    findDir(dir, DIR.MODULES) ||
      findDir(dir, DIR.DIRECT_QUIZ) ||
      findDir(dir, DIR.DIRECT_ASSIGNMENT) ||
      findDir(dir, DIR.DIRECT_CONTENT)
  );

/**
 * Locates the course root inside an extracted job directory. Accepts the root at
 * the top level or wrapped in a single containing folder, matching how the
 * course.json path already tolerates a wrapper directory.
 *
 * @returns {{ isPhysical: boolean, rootDir: string|null, courseTitleHint: string|null }}
 */
const detectPhysicalPackage = (jobDir) => {
  const direct = findDir(jobDir, DIR.ROOT);
  if (direct && looksLikeCourseRoot(direct)) {
    return { isPhysical: true, rootDir: direct, courseTitleHint: null };
  }

  for (const name of listDirs(jobDir)) {
    const candidate = path.join(jobDir, name);

    // A wrapper folder containing Course/
    const nested = findDir(candidate, DIR.ROOT);
    if (nested && looksLikeCourseRoot(nested)) {
      return { isPhysical: true, rootDir: nested, courseTitleHint: null };
    }

    // A course root named after the course itself rather than "Course"
    if (looksLikeCourseRoot(candidate)) {
      return { isPhysical: true, rootDir: candidate, courseTitleHint: name };
    }
  }

  if (looksLikeCourseRoot(jobDir)) {
    return { isPhysical: true, rootDir: jobDir, courseTitleHint: null };
  }

  return { isPhysical: false, rootDir: null, courseTitleHint: null };
};

/* -------------------------------------------------------------------------- */
/* Frontmatter                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Reads a leading `---` YAML block. Deliberately supports only flat
 * `key: value` pairs — the whole vocabulary the package format uses — so
 * parsing is deterministic and needs no YAML dependency.
 */
const parseFrontmatter = (raw) => {
  const text = String(raw).replace(/\r\n/g, "\n").replace(/^﻿/, "");
  if (!text.startsWith("---\n")) return { data: {}, body: text, hasBlock: false };

  const closing = text.indexOf("\n---", 3);
  if (closing === -1) {
    return { data: {}, body: text, hasBlock: true, malformed: true };
  }

  const block = text.slice(4, closing);
  const body = text.slice(closing + 4).replace(/^\n/, "");
  const data = {};

  for (const line of block.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) return { data, body, hasBlock: true, malformed: true };

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }

  return { data, body, hasBlock: true, malformed: false };
};

/* -------------------------------------------------------------------------- */
/* Quiz CSV                                                                    */
/* -------------------------------------------------------------------------- */

/** Parses CSV text into row objects using the same parser the V1 quiz extractor uses. */
const parseCsv = (text) =>
  new Promise((resolve, reject) => {
    const rows = [];
    Readable.from([text])
      .pipe(csvParser())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });

/**
 * Reads one quiz CSV into a quiz definition. Quiz-level settings live in the
 * leading columns and must agree across every row of the file.
 */
const readQuizFile = async (filePath, label, errors) => {
  const title = path.basename(filePath, path.extname(filePath));
  let rows;

  try {
    rows = await parseCsv(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    errors.push(`${label}: could not read quiz CSV (${err.message}).`);
    return null;
  }

  if (!rows.length) {
    errors.push(`${label}: quiz CSV has no question rows.`);
    return null;
  }

  const tags = new Set();
  const questions = [];

  rows.forEach((row, index) => {
    const rowLabel = `${label} row ${index + 2}`;

    const tag = String(row.quizTag || "").trim().toUpperCase();
    if (!tag) {
      errors.push(`${rowLabel}: quizTag is required (FINAL or SELF_TEST).`);
    } else if (!QUIZ_TAGS.has(tag)) {
      errors.push(`${rowLabel}: quizTag "${row.quizTag}" is invalid; expected FINAL or SELF_TEST.`);
    } else {
      tags.add(tag);
    }

    const normalized = normalizeQuestion(row);
    if (!normalized.question || !String(normalized.question).trim()) {
      errors.push(`${rowLabel}: question text is required.`);
      return;
    }

    const answer = normalized.correctAnswer;
    const hasAnswer = Array.isArray(answer) ? answer.length > 0 : String(answer ?? "").trim() !== "";
    if (!hasAnswer) {
      errors.push(`${rowLabel}: correctAnswer is required.`);
      return;
    }

    questions.push(normalized);
  });

  if (tags.size > 1) {
    errors.push(`${label}: every row must carry the same quizTag; found ${[...tags].join(" and ")}.`);
  }

  const first = rows[0] || {};
  const passingScoreRaw = String(first.passingScore ?? "").trim();
  const passingScore = passingScoreRaw === "" ? 50 : Number(passingScoreRaw);
  if (!Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100) {
    errors.push(`${label}: passingScore must be a number between 0 and 100.`);
  }

  const timeLimitRaw = String(first.timeLimit ?? "").trim();
  let timeLimit = null;
  if (timeLimitRaw !== "") {
    timeLimit = Number(timeLimitRaw);
    if (!Number.isFinite(timeLimit) || timeLimit < 0) {
      errors.push(`${label}: timeLimit must be a non-negative number of minutes.`);
      timeLimit = null;
    }
  }

  const quizTag = tags.size === 1 ? [...tags][0] : "FINAL";

  return {
    title,
    quizTag,
    passingScore: Number.isFinite(passingScore) ? passingScore : 50,
    // A self-test is never timed, matching the course.json importer's rule.
    timeLimit: quizTag === "SELF_TEST" ? null : timeLimit,
    questions,
  };
};

/* -------------------------------------------------------------------------- */
/* Assignment markdown                                                         */
/* -------------------------------------------------------------------------- */

const readAssignmentFile = (filePath, label, errors) => {
  const fallbackTitle = path.basename(filePath, path.extname(filePath));
  const { data, body, hasBlock, malformed } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));

  if (!hasBlock) {
    errors.push(`${label}: assignment is missing its --- frontmatter block (dueDate is required).`);
    return null;
  }
  if (malformed) {
    errors.push(`${label}: assignment frontmatter is malformed; expected flat "key: value" lines.`);
    return null;
  }

  const dueRaw = String(data.dueDate || "").trim();
  if (!dueRaw) {
    errors.push(`${label}: assignment frontmatter must include dueDate.`);
    return null;
  }
  const dueDate = new Date(dueRaw);
  if (Number.isNaN(dueDate.getTime())) {
    errors.push(`${label}: dueDate "${dueRaw}" is not a valid date.`);
    return null;
  }

  const numeric = (key) => {
    const raw = String(data[key] ?? "").trim();
    if (raw === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${label}: ${key} must be a non-negative number.`);
      return null;
    }
    return Math.trunc(value);
  };

  return {
    title: String(data.title || "").trim() || fallbackTitle,
    description: body.trim() || null,
    dueDate: dueDate.toISOString(),
    marks: numeric("marks"),
    estimatedTime: numeric("estimatedTime"),
    totalQuestions: numeric("totalQuestions"),
    assessmentType: String(data.assessmentType || "").trim() || null,
  };
};

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

/** Local (non-URL, non-anchor) file references inside markdown or HTML. */
const collectLocalReferences = (text) => {
  const references = new Set();
  const add = (raw) => {
    if (!raw) return;
    const value = decodeURIComponent(String(raw).trim().split(/[?#]/)[0]);
    if (!value || /^[a-z]+:/i.test(value) || value.startsWith("//") || value.startsWith("#")) return;
    references.add(value);
  };

  for (const match of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) add(match[1]);
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)/g)) add(match[1]);
  for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) add(match[1]);

  return references;
};

/**
 * Reads one content folder into content definitions.
 *
 * A media file referenced by a sibling text file is that content's asset and its
 * reference is rewritten to the uploaded URL — it does not also become a content
 * row of its own. A media file nobody references becomes its own content row, so
 * nothing in the folder is ever silently dropped.
 */
const readContentFolder = (dir, label, errors, registerAsset) => {
  const files = listFiles(dir);
  if (!files.length) return [];

  const subdirs = listDirs(dir);
  if (subdirs.length) {
    errors.push(`${label}: content folders may not contain subfolders (found "${subdirs[0]}").`);
  }

  const textFiles = files.filter((f) => TEXT_EXTENSIONS.has(path.extname(f).toLowerCase()));
  const mediaFiles = files.filter((f) => !TEXT_EXTENSIONS.has(path.extname(f).toLowerCase()));

  for (const file of mediaFiles) {
    const extension = path.extname(file).toLowerCase();
    if (!MEDIA_TYPE_BY_EXTENSION[extension]) {
      errors.push(`${label}: "${file}" has unsupported type "${extension || "(none)"}".`);
    }
  }

  const referenced = new Set();
  const definitions = [];

  for (const file of textFiles) {
    const filePath = path.join(dir, file);
    const extension = path.extname(file).toLowerCase();
    const fileLabel = `${label}/${file}`;
    const raw = fs.readFileSync(filePath, "utf8");

    let data = {};
    let body = raw;
    if (extension === ".md" || extension === ".markdown") {
      const parsed = parseFrontmatter(raw);
      if (parsed.malformed) {
        errors.push(`${fileLabel}: frontmatter is malformed; expected flat "key: value" lines.`);
        continue;
      }
      data = parsed.data;
      body = parsed.body;
    }

    // Resolve every local reference against this folder before rendering.
    const rewrites = [];
    for (const reference of collectLocalReferences(body)) {
      const target = path.resolve(dir, reference);
      if (!isInside(dir, target) || !fs.existsSync(target)) {
        errors.push(`${fileLabel}: references "${reference}", which is not present in this folder.`);
        continue;
      }
      referenced.add(path.basename(target));
      rewrites.push({ reference, absolutePath: target });
    }

    let html;
    if (extension === ".html" || extension === ".htm") {
      html = body;
    } else if (extension === ".txt") {
      html = body;
    } else {
      html = marked.parse(body);
    }

    const declaredType = String(data.type || "").trim().toUpperCase();
    if (declaredType && !VALID_CONTENT_TYPES.has(declaredType)) {
      errors.push(`${fileLabel}: type "${data.type}" is not a supported content type.`);
    }

    const orderRaw = String(data.order ?? "").trim();
    const durationRaw = String(data.duration ?? "").trim();

    definitions.push({
      kind: "text",
      type: declaredType && VALID_CONTENT_TYPES.has(declaredType)
        ? declaredType
        : extension === ".txt" ? "TEXT" : "HTML",
      title: String(data.title || "").trim() || path.basename(file, extension),
      order: orderRaw === "" ? null : Number(orderRaw),
      duration: durationRaw === "" ? null : Number(durationRaw),
      html,
      rewrites,
      sourceName: file,
    });
  }

  for (const file of mediaFiles) {
    if (referenced.has(file)) continue;
    const extension = path.extname(file).toLowerCase();
    const type = MEDIA_TYPE_BY_EXTENSION[extension];
    if (!type) continue;

    definitions.push({
      kind: "media",
      type,
      title: path.basename(file, extension),
      order: null,
      duration: null,
      absolutePath: path.join(dir, file),
      sourceName: file,
    });
  }

  // Explicit order wins; everything else keeps the folder's lexical order.
  definitions.sort((a, b) => {
    const aHas = Number.isFinite(a.order);
    const bHas = Number.isFinite(b.order);
    if (aHas && bHas && a.order !== b.order) return a.order - b.order;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return a.sourceName.localeCompare(b.sourceName, "en");
  });

  return definitions.map((definition, index) => {
    const resolved = { ...definition, order: index + 1 };
    if (definition.kind === "media") {
      resolved.assetUrl = registerAsset(definition.absolutePath);
      delete resolved.absolutePath;
    } else {
      let html = definition.html;
      for (const rewrite of definition.rewrites) {
        const url = registerAsset(rewrite.absolutePath);
        html = html.split(rewrite.reference).join(url);
        html = html.split(encodeURI(rewrite.reference)).join(url);
      }
      resolved.html = html;
      delete resolved.rewrites;
    }
    return resolved;
  });
};

/* -------------------------------------------------------------------------- */
/* Level parsing                                                               */
/* -------------------------------------------------------------------------- */

/** Reads the Direct Quiz / Direct Assignment / Direct Content trio at one level. */
const readLevelArtifacts = async (levelDir, label, names, errors, registerAsset) => {
  const quizzes = [];
  const assignments = [];
  let contents = [];

  const quizDir = findDir(levelDir, names.quiz);
  if (quizDir) {
    for (const file of listFiles(quizDir)) {
      const fileLabel = `${label}/${path.basename(quizDir)}/${file}`;
      if (path.extname(file).toLowerCase() !== ".csv") {
        errors.push(`${fileLabel}: quiz folders may only contain .csv files.`);
        continue;
      }
      const quiz = await readQuizFile(path.join(quizDir, file), fileLabel, errors);
      if (quiz) quizzes.push(quiz);
    }
    const nested = listDirs(quizDir);
    if (nested.length) errors.push(`${label}/${path.basename(quizDir)}: unexpected subfolder "${nested[0]}".`);
  }

  const assignmentDir = findDir(levelDir, names.assignment);
  if (assignmentDir) {
    for (const file of listFiles(assignmentDir)) {
      const fileLabel = `${label}/${path.basename(assignmentDir)}/${file}`;
      const extension = path.extname(file).toLowerCase();
      if (extension !== ".md" && extension !== ".markdown") {
        errors.push(`${fileLabel}: assignment folders may only contain .md files.`);
        continue;
      }
      const assignment = readAssignmentFile(path.join(assignmentDir, file), fileLabel, errors);
      if (assignment) assignments.push(assignment);
    }
    const nested = listDirs(assignmentDir);
    if (nested.length) errors.push(`${label}/${path.basename(assignmentDir)}: unexpected subfolder "${nested[0]}".`);
  }

  const contentDir = findDir(levelDir, names.content);
  if (contentDir) {
    contents = readContentFolder(contentDir, `${label}/${path.basename(contentDir)}`, errors, registerAsset);
  }

  const duplicateQuiz = quizzes.map((q) => q.title).find((t, i, arr) => arr.indexOf(t) !== i);
  if (duplicateQuiz) errors.push(`${label}: duplicate quiz name "${duplicateQuiz}".`);
  const duplicateAssignment = assignments.map((a) => a.title).find((t, i, arr) => arr.indexOf(t) !== i);
  if (duplicateAssignment) errors.push(`${label}: duplicate assignment name "${duplicateAssignment}".`);

  return { quizzes, assignments, contents };
};

/** Flags stray files and unknown subfolders at a structural level. */
const checkLevelShape = (levelDir, label, allowedDirs, errors) => {
  const strayFiles = listFiles(levelDir);
  if (strayFiles.length) {
    errors.push(
      `${label}: unexpected file "${strayFiles[0]}" — artifacts must live inside their own folder.`
    );
  }
  for (const name of listDirs(levelDir)) {
    if (!allowedDirs.includes(name.toLowerCase())) {
      errors.push(`${label}: unexpected folder "${name}" makes the package ambiguous.`);
    }
  }
};

const DIRECT_NAMES = {
  quiz: DIR.DIRECT_QUIZ,
  assignment: DIR.DIRECT_ASSIGNMENT,
  content: DIR.DIRECT_CONTENT,
};
const TOPIC_NAMES = {
  quiz: DIR.TOPIC_QUIZ,
  assignment: DIR.TOPIC_ASSIGNMENT,
  content: DIR.TOPIC_CONTENT,
};

/**
 * Walks the package into a plain structure, collecting every validation problem
 * rather than stopping at the first.
 */
const parsePhysicalPackage = async (rootDir, { sourceFileName, courseTitleHint }) => {
  const errors = [];
  const assets = [];
  const assetIndexByPath = new Map();

  // Media is registered during parsing and copied only once the package is
  // known to be valid, so a rejected package leaves nothing behind.
  const registerAsset = (absolutePath) => {
    if (!isInside(rootDir, absolutePath)) {
      errors.push(`Security: asset "${path.basename(absolutePath)}" escapes the package root.`);
      return "";
    }
    if (!assetIndexByPath.has(absolutePath)) {
      assetIndexByPath.set(absolutePath, assets.length);
      assets.push({ absolutePath, extension: path.extname(absolutePath).toLowerCase() });
    }
    return `__ASSET_${assetIndexByPath.get(absolutePath)}__`;
  };

  checkLevelShape(
    rootDir,
    "Course",
    [DIR.MODULES, DIR.DIRECT_QUIZ, DIR.DIRECT_ASSIGNMENT, DIR.DIRECT_CONTENT],
    errors
  );

  const courseArtifacts = await readLevelArtifacts(rootDir, "Course", DIRECT_NAMES, errors, registerAsset);

  const modules = [];
  const modulesDir = findDir(rootDir, DIR.MODULES);

  if (!modulesDir) {
    errors.push('Course: a "Modules" folder is required.');
  } else {
    const moduleNames = listDirs(modulesDir);
    const strayModuleFiles = listFiles(modulesDir);
    if (strayModuleFiles.length) {
      errors.push(`Course/Modules: unexpected file "${strayModuleFiles[0]}".`);
    }
    if (!moduleNames.length) {
      errors.push("Course/Modules: at least one module folder is required.");
    }

    for (const [moduleIndex, moduleName] of moduleNames.entries()) {
      const moduleDir = path.join(modulesDir, moduleName);
      const moduleLabel = `Course/Modules/${moduleName}`;

      checkLevelShape(
        moduleDir,
        moduleLabel,
        [DIR.LESSONS, DIR.DIRECT_QUIZ, DIR.DIRECT_ASSIGNMENT, DIR.DIRECT_CONTENT],
        errors
      );

      const moduleArtifacts = await readLevelArtifacts(moduleDir, moduleLabel, DIRECT_NAMES, errors, registerAsset);
      const lessons = [];
      const lessonsDir = findDir(moduleDir, DIR.LESSONS);

      if (lessonsDir) {
        const lessonNames = listDirs(lessonsDir);
        const strayLessonFiles = listFiles(lessonsDir);
        if (strayLessonFiles.length) {
          errors.push(`${moduleLabel}/Lessons: unexpected file "${strayLessonFiles[0]}".`);
        }

        for (const [lessonIndex, lessonName] of lessonNames.entries()) {
          const lessonDir = path.join(lessonsDir, lessonName);
          const lessonLabel = `${moduleLabel}/Lessons/${lessonName}`;

          checkLevelShape(
            lessonDir,
            lessonLabel,
            [DIR.TOPICS, DIR.DIRECT_QUIZ, DIR.DIRECT_ASSIGNMENT, DIR.DIRECT_CONTENT],
            errors
          );

          const lessonArtifacts = await readLevelArtifacts(lessonDir, lessonLabel, DIRECT_NAMES, errors, registerAsset);
          const topics = [];
          const topicsDir = findDir(lessonDir, DIR.TOPICS);

          if (topicsDir) {
            const topicNames = listDirs(topicsDir);
            const strayTopicFiles = listFiles(topicsDir);
            if (strayTopicFiles.length) {
              errors.push(`${lessonLabel}/Topics: unexpected file "${strayTopicFiles[0]}".`);
            }

            for (const [topicIndex, topicName] of topicNames.entries()) {
              const topicDir = path.join(topicsDir, topicName);
              const topicLabel = `${lessonLabel}/Topics/${topicName}`;

              checkLevelShape(
                topicDir,
                topicLabel,
                [DIR.TOPIC_QUIZ, DIR.TOPIC_ASSIGNMENT, DIR.TOPIC_CONTENT],
                errors
              );

              const topicArtifacts = await readLevelArtifacts(topicDir, topicLabel, TOPIC_NAMES, errors, registerAsset);
              topics.push({ title: topicName, order: topicIndex + 1, ...topicArtifacts });
            }
          }

          lessons.push({ title: lessonName, order: lessonIndex + 1, ...lessonArtifacts, topics });
        }
      }

      modules.push({ title: moduleName, order: moduleIndex + 1, ...moduleArtifacts, lessons });
    }
  }

  const title =
    (courseTitleHint && courseTitleHint.trim()) || humanize(sourceFileName);

  return {
    errors,
    assets,
    course: { title, ...courseArtifacts, modules },
  };
};

/* -------------------------------------------------------------------------- */
/* Process                                                                     */
/* -------------------------------------------------------------------------- */

/** Copies validated media into permanent uploads storage. */
const copyAssets = (assets) => {
  const uploadsRoot = path.resolve(__dirname, "../../../../uploads");
  const contentsDir = path.join(uploadsRoot, "contents");
  if (!fs.existsSync(contentsDir)) fs.mkdirSync(contentsDir, { recursive: true });

  return assets.map((asset) => {
    const uniqueName = `${Date.now()}_${Math.round(Math.random() * 1e9)}${asset.extension}`;
    fs.copyFileSync(asset.absolutePath, path.join(contentsDir, uniqueName));
    return `/uploads/contents/${uniqueName}`;
  });
};

/** Replaces the placeholder tokens left by parsing with real upload URLs. */
const resolveAssetTokens = (course, assetUrls) => {
  const swap = (value) =>
    typeof value === "string"
      ? value.replace(/__ASSET_(\d+)__/g, (match, index) => assetUrls[Number(index)] ?? match)
      : value;

  const walkContents = (contents) =>
    (contents || []).map((content) => ({
      ...content,
      html: swap(content.html),
      assetUrl: swap(content.assetUrl),
    }));

  return {
    ...course,
    contents: walkContents(course.contents),
    modules: (course.modules || []).map((mod) => ({
      ...mod,
      contents: walkContents(mod.contents),
      lessons: (mod.lessons || []).map((lesson) => ({
        ...lesson,
        contents: walkContents(lesson.contents),
        topics: (lesson.topics || []).map((topic) => ({
          ...topic,
          contents: walkContents(topic.contents),
        })),
      })),
    })),
  };
};

const countArtifacts = (course) => {
  let quizzes = 0;
  let assignments = 0;
  let contents = 0;
  let modules = 0;
  let lessons = 0;
  let topics = 0;

  const tally = (level) => {
    quizzes += (level.quizzes || []).length;
    assignments += (level.assignments || []).length;
    contents += (level.contents || []).length;
  };

  tally(course);
  for (const mod of course.modules || []) {
    modules += 1;
    tally(mod);
    for (const lesson of mod.lessons || []) {
      lessons += 1;
      tally(lesson);
      for (const topic of lesson.topics || []) {
        topics += 1;
        tally(topic);
      }
    }
  }

  return { modules, lessons, topics, quizzes, assignments, contents };
};

/**
 * Validates an extracted physical package and returns the canonical payload the
 * import step consumes. Throws before touching storage if anything is wrong.
 */
const processPhysicalPackage = async (rootDir, { sourceFileName, courseTitleHint }) => {
  const { errors, assets, course } = await parsePhysicalPackage(rootDir, {
    sourceFileName,
    courseTitleHint,
  });

  if (errors.length > 0) {
    const error = new ApiError(400, `Invalid course package: ${errors[0]}`);
    error.errors = errors;
    throw error;
  }

  const assetUrls = copyAssets(assets);
  const resolved = resolveAssetTokens(course, assetUrls);
  const counts = countArtifacts(resolved);

  return {
    canonicalJson: {
      packageFormat: "PHYSICAL_V1",
      version: "1.0",
      metadata: { title: resolved.title },
      course: resolved,
    },
    validationReport: {
      isValid: true,
      errors: [],
      warnings: [],
      info: [
        `Physical course package validated: ${counts.modules} module(s), ${counts.lessons} lesson(s), ${counts.topics} topic(s).`,
        `Artifacts: ${counts.quizzes} quiz(zes), ${counts.assignments} assignment(s), ${counts.contents} content item(s), ${assetUrls.length} media file(s).`,
      ],
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Writes a validated physical package into the database in one transaction.
 * Mirrors the row shapes the course.json importer produces so both formats
 * yield identical courses.
 */
const importPhysicalPackage = async (canonicalJson, instructorId) => {
  const course = canonicalJson?.course;
  if (!course) throw new ApiError(400, "Physical package payload is missing its course.");

  return prisma.$transaction(
    async (tx) => {
      const courseRecord = await tx.course.create({
        data: {
          title: course.title || "Imported Course",
          description: null,
          status: "DRAFT",
          visibility: "PUBLIC",
          creatorId: instructorId,
        },
      });

      const moduleRows = [];
      const lessonRows = [];
      const topicRows = [];
      const contentRows = [];
      const assignmentRows = [];
      const quizRows = [];
      const questionRows = [];
      const quizQuestionRows = [];

      const addQuizzes = (quizzes, { moduleId = null, lessonId = null, topicId = null }) => {
        for (const quizDef of quizzes || []) {
          const quizId = crypto.randomUUID();
          quizRows.push({
            id: quizId,
            title: quizDef.title,
            description: null,
            quizTag: quizDef.quizTag === "SELF_TEST" ? "SELF_TEST" : "FINAL",
            passingScore: quizDef.passingScore,
            timeLimit: quizDef.quizTag === "SELF_TEST" ? null : quizDef.timeLimit,
            isPublished: true,
            status: "ACTIVE",
            courseId: courseRecord.id,
            moduleId,
            lessonId,
            topicId,
            batchId: null,
          });

          (quizDef.questions || []).forEach((questionDef, index) => {
            const questionId = crypto.randomUUID();
            questionRows.push({
              id: questionId,
              quizId: null,
              courseId: courseRecord.id,
              moduleId,
              question: questionDef.question,
              questionType: (questionDef.questionType || "MCQ").toUpperCase(),
              options: questionDef.options ?? [],
              correctAnswer: questionDef.correctAnswer ?? "",
              explanation: questionDef.explanation ?? null,
              marks: questionDef.marks ? Number(questionDef.marks) : 1,
              negativeMarks: questionDef.negativeMarks ? Number(questionDef.negativeMarks) : 0,
              difficulty: (questionDef.difficulty || "MEDIUM").toUpperCase(),
              createdBy: instructorId,
            });

            quizQuestionRows.push({
              id: crypto.randomUUID(),
              quizId,
              questionId,
              order: index + 1,
              marks: questionDef.marks ? Number(questionDef.marks) : 1,
              isMandatory: true,
            });
          });
        }
      };

      // An assignment is attached to exactly one level, the rule
      // assignment.service.createAssignment enforces.
      const addAssignments = (assignments, parent) => {
        for (const assignmentDef of assignments || []) {
          assignmentRows.push({
            title: assignmentDef.title,
            description: assignmentDef.description,
            dueDate: new Date(assignmentDef.dueDate),
            marks: assignmentDef.marks,
            assessmentType: assignmentDef.assessmentType,
            estimatedTime: assignmentDef.estimatedTime ?? 0,
            totalQuestions: assignmentDef.totalQuestions ?? 0,
            isPublished: true,
            status: "ACTIVE",
            courseId: parent.courseId ?? null,
            moduleId: parent.moduleId ?? null,
            lessonId: parent.lessonId ?? null,
            topicId: parent.topicId ?? null,
          });
        }
      };

      const addContents = (contents, parent) => {
        for (const contentDef of contents || []) {
          const isMedia = contentDef.kind === "media";
          const isVideo = contentDef.type === "VIDEO";
          contentRows.push({
            type: contentDef.type,
            title: contentDef.title,
            order: contentDef.order,
            duration: Number.isFinite(contentDef.duration) ? contentDef.duration : null,
            htmlContent: isMedia ? null : contentDef.html,
            videoUrl: isMedia && isVideo ? contentDef.assetUrl : null,
            fileUrl: isMedia && !isVideo ? contentDef.assetUrl : null,
            externalUrl: null,
            courseId: parent.courseId ?? null,
            moduleId: parent.moduleId ?? null,
            lessonId: parent.lessonId ?? null,
            topicId: parent.topicId ?? null,
          });
        }
      };

      const courseParent = { courseId: courseRecord.id };
      addQuizzes(course.quizzes, {});
      addAssignments(course.assignments, courseParent);
      addContents(course.contents, courseParent);

      for (const moduleDef of course.modules || []) {
        const moduleId = crypto.randomUUID();
        moduleRows.push({
          id: moduleId,
          title: moduleDef.title,
          description: null,
          order: moduleDef.order,
          isPublished: true,
          courseId: courseRecord.id,
        });

        addQuizzes(moduleDef.quizzes, { moduleId });
        addAssignments(moduleDef.assignments, { moduleId });
        addContents(moduleDef.contents, { moduleId });

        for (const lessonDef of moduleDef.lessons || []) {
          const lessonId = crypto.randomUUID();
          lessonRows.push({
            id: lessonId,
            title: lessonDef.title,
            description: null,
            order: lessonDef.order,
            isPublished: true,
            moduleId,
          });

          addQuizzes(lessonDef.quizzes, { moduleId, lessonId });
          addAssignments(lessonDef.assignments, { lessonId });
          addContents(lessonDef.contents, { lessonId });

          for (const topicDef of lessonDef.topics || []) {
            const topicId = crypto.randomUUID();
            topicRows.push({
              id: topicId,
              title: topicDef.title,
              description: null,
              order: topicDef.order,
              isPublished: true,
              lessonId,
            });

            addQuizzes(topicDef.quizzes, { moduleId, lessonId, topicId });
            addAssignments(topicDef.assignments, { topicId });
            addContents(topicDef.contents, { topicId });
          }
        }
      }

      if (moduleRows.length) await tx.module.createMany({ data: moduleRows });
      if (lessonRows.length) await tx.lesson.createMany({ data: lessonRows });
      if (topicRows.length) await tx.topic.createMany({ data: topicRows });
      if (contentRows.length) await tx.content.createMany({ data: contentRows });
      if (assignmentRows.length) await tx.assignment.createMany({ data: assignmentRows });
      if (quizRows.length) await tx.quiz.createMany({ data: quizRows });
      if (questionRows.length) await tx.question.createMany({ data: questionRows });
      if (quizQuestionRows.length) await tx.quizQuestion.createMany({ data: quizQuestionRows });

      return courseRecord;
    },
    { maxWait: 20000, timeout: 60000 }
  );
};

/** Runs the import for a job row and moves it to COMPLETED or FAILED. */
const importPhysicalJob = async (job, instructorId) => {
  try {
    const createdCourse = await importPhysicalPackage(job.canonicalJson, instructorId);

    if (job.id && !job.id.startsWith("draft-")) {
      await prisma.courseImportJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", courseId: createdCourse.id },
      });
    }

    return createdCourse;
  } catch (error) {
    if (job.id && !job.id.startsWith("draft-")) {
      await prisma.courseImportJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: error.message, courseId: null },
      });
    }
    throw error;
  }
};

module.exports = {
  DIR,
  detectPhysicalPackage,
  parseFrontmatter,
  parsePhysicalPackage,
  processPhysicalPackage,
  importPhysicalPackage,
  importPhysicalJob,
};
