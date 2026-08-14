const anthropicProvider = require("./anthropicProvider");

/**
 * Only ever reorganizes the SAME set of file paths the rule-based analyzer
 * already found — never invents, renames, drops, or duplicates a path.
 * Used only when the rule-based structureAnalyzer's confidence is low
 * (e.g. a flat package with no folder structure to key off).
 */
const SYSTEM_PROMPT = [
  "You reorganize a flat list of course file paths into a Module -> Lesson hierarchy for an LMS import.",
  "You must not invent, rename, drop, or duplicate any file path — every path in your output must be copied",
  "exactly from the input list, and every input path must appear exactly once in your output.",
  'Respond with strict JSON only, no prose: {"modules":[{"title":"...","lessons":[{"title":"...","filePaths":["..."]}]}]}',
].join(" ");

const buildUserPrompt = (filePaths) => `File paths:\n${filePaths.join("\n")}`;

const parseAndValidate = (text, filePaths) => {
  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch (error) {
    return null;
  }

  if (!parsed || !Array.isArray(parsed.modules)) return null;

  const validPaths = new Set(filePaths);
  const outputPaths = new Set();

  for (const moduleEntry of parsed.modules) {
    if (!moduleEntry?.title || !Array.isArray(moduleEntry.lessons)) return null;
    for (const lesson of moduleEntry.lessons) {
      if (!lesson?.title || !Array.isArray(lesson.filePaths)) return null;
      for (const p of lesson.filePaths) {
        if (!validPaths.has(p) || outputPaths.has(p)) return null;
        outputPaths.add(p);
      }
    }
  }

  if (outputPaths.size !== filePaths.length) return null;

  return parsed.modules;
};

/** Returns AI-proposed {title, lessons:[{title, filePaths}]}[] or null (caller falls back to rule-based grouping). */
const proposeStructure = async (filePaths) => {
  if (!anthropicProvider.isConfigured() || !filePaths.length) return null;

  try {
    const { text } = await anthropicProvider.generate({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(filePaths) }],
    });
    return parseAndValidate(text, filePaths);
  } catch (error) {
    return null;
  }
};

module.exports = { proposeStructure };
