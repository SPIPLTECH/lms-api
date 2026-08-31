/**
 * Phase 11 — Step 2: Deterministic Signal Extraction Layer
 * Pure utility/service with zero database dependencies.
 */

// Matching token types: day, module, unit, week, session
const TOKEN_PATTERN = /(?:^|[^a-zA-Z0-9])((day|module|unit|week|session)s?\s*[-_]?\s*(\d+)(?:\s*[-_]\s*(\d+))?)(?=$|[^a-zA-Z0-9])/gi;

// Numbered Subsection Regex
// Examples: "1.1 Generations of Computers", "1.6 Number Systems", "1.6.1 Binary"
const NUMBERED_HEADING_PATTERN = /^(\d+(?:\.\d+)*)[\s.:]/;

// File Role Keywords
const RESOURCE_KEYWORDS = [
  "checklist",
  "links",
  "plan",
  "guide",
  "production",
  "script",
  "instructor",
  "teacher"
];

const PRIMARY_KEYWORDS = [
  "lecture",
  "lesson",
  "notes",
  "slides",
  "fundamentals",
  "tutorial"
];

/**
 * Extracts structured Day/Unit/Module/Week/Session tokens from text.
 * @param {string} text
 * @param {string} source - "filename" | "heading" | "block"
 * @param {Object} [extraContext] - e.g. { headingLevel: "h1", blockOrder: 0 }
 * @returns {Array<Object>} Extracted tokens
 */
function extractTokens(text, source = "unknown", extraContext = {}) {
  if (!text || typeof text !== "string") return [];
  const tokens = [];

  TOKEN_PATTERN.lastIndex = 0;
  let match;

  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    const matchedText = match[1];
    const rawType = match[2].toLowerCase();
    const startNum = parseInt(match[3], 10);
    const endNum = match[4] ? parseInt(match[4], 10) : startNum;

    for (let n = startNum; n <= endNum; n++) {
      tokens.push({
        type: rawType,
        number: n,
        source,
        matchedText,
        ...extraContext
      });
    }
  }

  return tokens;
}

/**
 * Extracts numbered subsection array from heading text.
 * e.g. "1.6.1 Binary" -> [1, 6, 1]
 * @param {string} text
 * @returns {Object|null} { sectionPath: Array<number>, matchedText: string }
 */
function extractNumberedSection(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.trim();
  const match = cleaned.match(NUMBERED_HEADING_PATTERN);
  if (!match) return null;

  const rawMatch = match[1];
  const sectionPath = rawMatch.split(".").map((numStr) => parseInt(numStr, 10));

  return {
    sectionPath,
    matchedText: rawMatch
  };
}

/**
 * Helper to inspect markdown or html sourceElement to determine heading level and clean title text.
 */
function parseHeadingInfo(block) {
  if (!block) return null;

  let level = block.attributes?.sourceElement || block.sourceElement || block.level;
  let rawText = block.markdown || block.text || block.content || "";

  if (typeof level === "string") {
    level = level.toLowerCase();
  }

  if (rawText && typeof rawText === "string") {
    const mdMatch = rawText.match(/^(#{1,6})\s+(.*)$/);
    if (mdMatch) {
      if (!level) {
        level = `h${mdMatch[1].length}`;
      }
      rawText = mdMatch[2].trim();
    }
  }

  if (level && /^h[1-6]$/i.test(level)) {
    return {
      level: level.toLowerCase(),
      text: rawText.trim()
    };
  }

  return null;
}

/**
 * Extracts heading signals from extracted blocks without altering existing blocks.
 * @param {Array<Object>} blocks
 * @param {string} sourceFile
 * @returns {Array<Object>} Heading signals
 */
function extractHeadingSignals(blocks = [], sourceFile = "") {
  const headings = [];

  blocks.forEach((block, index) => {
    const headingInfo = parseHeadingInfo(block);
    if (!headingInfo || !headingInfo.text) return;

    const headingText = headingInfo.text;
    const level = headingInfo.level;

    const tokens = extractTokens(headingText, "heading", {
      headingLevel: level,
      blockOrder: index,
      sourceFile
    });

    const numberedSignal = extractNumberedSection(headingText);

    headings.push({
      level,
      text: headingText,
      blockOrder: index,
      sourceFile,
      tokens,
      numberedSection: numberedSignal ? numberedSignal.sectionPath : null,
      numberedSectionMatch: numberedSignal ? numberedSignal.matchedText : null
    });
  });

  return headings;
}

/**
 * Deterministic file role classifier based on filename and heading signals.
 * @param {string} fileName
 * @param {Array<Object>} [headings=[]]
 * @returns {Object} { role: "primary"|"resource"|"unknown", confidence: "high"|"medium"|"low", signals: Array<Object> }
 */
function classifyFileRole(fileName = "", headings = []) {
  const lowerName = fileName.toLowerCase();
  const matchedSignals = [];

  let resourceScore = 0;
  let primaryScore = 0;

  for (const kw of RESOURCE_KEYWORDS) {
    if (lowerName.includes(kw)) {
      resourceScore += 2;
      matchedSignals.push({
        type: "keyword_match",
        keyword: kw,
        location: "filename",
        matchedText: fileName
      });
    }
  }

  for (const kw of PRIMARY_KEYWORDS) {
    if (lowerName.includes(kw)) {
      primaryScore += 2;
      matchedSignals.push({
        type: "keyword_match",
        keyword: kw,
        location: "filename",
        matchedText: fileName
      });
    }
  }

  headings.forEach((h) => {
    const hText = (h.text || "").toLowerCase();
    for (const kw of RESOURCE_KEYWORDS) {
      if (hText.includes(kw)) {
        resourceScore += 1;
        matchedSignals.push({
          type: "keyword_match",
          keyword: kw,
          location: "heading",
          matchedText: h.text
        });
      }
    }
    for (const kw of PRIMARY_KEYWORDS) {
      if (hText.includes(kw)) {
        primaryScore += 1;
        matchedSignals.push({
          type: "keyword_match",
          keyword: kw,
          location: "heading",
          matchedText: h.text
        });
      }
    }
  });

  let role = "unknown";
  let confidence = "low";

  if (resourceScore > primaryScore) {
    role = "resource";
    confidence = resourceScore >= 2 ? "high" : "medium";
  } else if (primaryScore > resourceScore) {
    role = "primary";
    confidence = primaryScore >= 2 ? "high" : "medium";
  } else if (primaryScore > 0 && resourceScore === primaryScore) {
    role = "primary";
    confidence = "medium";
  }

  return {
    role,
    confidence,
    signals: matchedSignals
  };
}

/**
 * Calculates overall confidence based on extracted signals.
 * Rules:
 * HIGH: explicit Day/Unit token found in an H1 heading
 * MEDIUM: token found only in filename, token found in H2/H3, or role inferred from strong filename keywords
 * LOW: no meaningful semantic signal found
 */
function calculateConfidence({ tokens = [], headings = [], roleClassification = {} }) {
  const hasH1Token = headings.some(
    (h) => h.level === "h1" && h.tokens && h.tokens.some((t) => ["day", "unit", "module"].includes(t.type))
  );
  if (hasH1Token) {
    return "high";
  }

  const hasFilenameToken = tokens.some((t) => t.source === "filename");
  const hasSubheadingToken = headings.some(
    (h) => ["h2", "h3"].includes(h.level) && h.tokens && h.tokens.length > 0
  );
  const hasStrongRoleKeyword = roleClassification.confidence === "high" || roleClassification.confidence === "medium";

  if (hasFilenameToken || hasSubheadingToken || hasStrongRoleKeyword || tokens.length > 0) {
    return "medium";
  }

  return "low";
}

/**
 * Main signal extraction entry point for an extracted file.
 * @param {Object} fileData - { fileName, relativePath, blocks }
 * @returns {Object} Extracted signals
 */
function extractSignals({ fileName = "", relativePath = "", blocks = [] } = {}) {
  const effectivePath = relativePath || fileName;

  const filenameTokens = extractTokens(fileName, "filename");
  const headings = extractHeadingSignals(blocks, effectivePath);

  const blockTokens = [];
  blocks.forEach((block, order) => {
    if (block.kind === "text" && block.markdown) {
      const isHeading = parseHeadingInfo(block) !== null;
      if (!isHeading) {
        const found = extractTokens(block.markdown, "block", { blockOrder: order, sourceFile: effectivePath });
        blockTokens.push(...found);
      }
    }
  });

  const headingTokens = headings.flatMap((h) => h.tokens || []);
  const allTokens = [...filenameTokens, ...headingTokens, ...blockTokens];

  const roleClassification = classifyFileRole(fileName, headings);

  const overallConfidence = calculateConfidence({
    tokens: allTokens,
    headings,
    roleClassification
  });

  return {
    file: {
      fileName,
      relativePath: effectivePath
    },
    roleClassification,
    tokens: allTokens,
    headings,
    overallConfidence
  };
}

module.exports = {
  extractTokens,
  extractNumberedSection,
  extractHeadingSignals,
  classifyFileRole,
  calculateConfidence,
  extractSignals
};
