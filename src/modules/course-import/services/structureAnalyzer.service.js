const structureMapper = require("./llm/structureMapper");

const ASSET_DIR_NAMES = new Set(["images", "image", "img", "assets", "videos", "video", "audio", "media", "css", "js", "fonts", "styles"]);
const ORDER_PREFIX = /^(\d+)[\s._-]*/;
const LOW_CONFIDENCE_THRESHOLD = 0.5;

const stripOrderPrefix = (name) => {
  const match = name.match(ORDER_PREFIX);
  const stripped = match ? name.slice(match[0].length).trim() : name;
  return stripped || name;
};

const titleFromFileName = (fileName) => {
  const base = fileName.replace(/\.[^.]+$/, "");
  return stripOrderPrefix(base.replace(/[_-]+/g, " ")).trim() || base;
};

const titleFromDirName = (dirName) => stripOrderPrefix(dirName.replace(/[_-]+/g, " ")).trim() || dirName;

const isAssetSegment = (segment) => ASSET_DIR_NAMES.has(segment.toLowerCase());

const estimateConfidence = (modules, files) => {
  if (!files.length) return 1;
  const structuredCount = modules.filter((m) => m.title !== "General").length;
  if (structuredCount === 0) return 0.3;
  return Math.min(1, 0.5 + (structuredCount / Math.max(modules.length, 1)) * 0.5);
};

/**
 * Folder/file naming heuristics -> proposed Module/Lesson hierarchy:
 * depth-1 folder = Module, a file directly in it = its own Lesson, a
 * subfolder inside it (including ones named "videos"/"images"/"assets" —
 * a very common real-world export shape, e.g. `Module-01/videos/*.mp4`
 * with no HTML wrapper) groups all its files into one properly-named
 * Lesson, exactly like any other subfolder. These files are real lesson
 * content, not a side channel — jsonTransformer's dedupe pass still drops
 * a file here if it turns out to ALSO be referenced inline elsewhere in
 * the same module, so nothing doubles up unnecessarily.
 */
const analyzeStructureRuleBased = (files) => {
  const moduleMap = new Map();
  const rootFiles = [];

  for (const file of files) {
    const segments = file.relativePath.split("/");
    segments.pop();

    if (segments.length === 0 || isAssetSegment(segments[0])) {
      rootFiles.push(file);
      continue;
    }

    const moduleName = segments[0];
    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, { title: titleFromDirName(moduleName), lessons: new Map(), order: moduleMap.size + 1 });
    }
    const moduleEntry = moduleMap.get(moduleName);
    const remaining = segments.slice(1);

    const lessonKey = remaining.length === 0 ? file.fileName : remaining[0];
    if (!moduleEntry.lessons.has(lessonKey)) {
      moduleEntry.lessons.set(lessonKey, {
        title: remaining.length === 0 ? titleFromFileName(file.fileName) : titleFromDirName(remaining[0]),
        files: [],
        order: moduleEntry.lessons.size + 1,
      });
    }
    moduleEntry.lessons.get(lessonKey).files.push(file);
  }

  if (rootFiles.length) {
    if (!moduleMap.has("__root__")) {
      moduleMap.set("__root__", { title: "General", lessons: new Map(), order: 0 });
    }
    const rootModule = moduleMap.get("__root__");
    for (const file of rootFiles) {
      if (!rootModule.lessons.has(file.fileName)) {
        rootModule.lessons.set(file.fileName, { title: titleFromFileName(file.fileName), files: [], order: rootModule.lessons.size + 1 });
      }
      rootModule.lessons.get(file.fileName).files.push(file);
    }
  }

  const modules = [...moduleMap.values()]
    .sort((a, b) => a.order - b.order)
    .map((m, mi) => ({
      title: m.title,
      order: mi + 1,
      lessons: [...m.lessons.values()].map((l, li) => ({ title: l.title, order: li + 1, files: l.files })),
    }));

  return { modules, confidence: estimateConfidence(modules, files) };
};

/** Rule-based grouping first; falls back to AI reorganization of the same file set only when confidence is low. */
const analyzeStructure = async (files) => {
  const ruleBased = analyzeStructureRuleBased(files);
  if (ruleBased.confidence >= LOW_CONFIDENCE_THRESHOLD) {
    return { ...ruleBased, structureSource: "rule-based" };
  }

  const filePaths = files.map((f) => f.relativePath);
  const aiModules = await structureMapper.proposeStructure(filePaths);
  if (!aiModules) {
    return { ...ruleBased, structureSource: "rule-based" };
  }

  const fileByPath = new Map(files.map((f) => [f.relativePath, f]));
  const modules = aiModules.map((m, mi) => ({
    title: m.title,
    order: mi + 1,
    lessons: m.lessons.map((l, li) => ({ title: l.title, order: li + 1, files: l.filePaths.map((p) => fileByPath.get(p)).filter(Boolean) })),
  }));

  return { modules, confidence: 0.7, structureSource: "ai" };
};

module.exports = { analyzeStructure, analyzeStructureRuleBased, titleFromFileName, titleFromDirName };
