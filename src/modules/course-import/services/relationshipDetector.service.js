/**
 * Phase 11 — Step 3: Deterministic Relationship Detection Layer
 * Pure utility/service with zero database dependencies.
 */

const { extractSignals } = require("./signalExtractor.service");

/**
 * Normalizes a token object or string into a stable relationship key.
 * Examples:
 *   { type: "day", number: 1 } -> "day:1"
 *   "Day 1" -> "day:1"
 *   "Module 1" -> "module:1"
 *   "Unit 2" -> "unit:2"
 * @param {Object|string} token
 * @returns {string|null}
 */
function normalizeToken(token) {
  if (!token) return null;

  if (typeof token === "object" && token.type && token.number !== undefined) {
    const type = String(token.type).toLowerCase().trim();
    const num = parseInt(token.number, 10);
    if (isNaN(num)) return null;
    return `${type}:${num}`;
  }

  if (typeof token === "string") {
    const match = token.match(/\b(day|module|unit|week|session)s?\s*[-_]?\s*(\d+)\b/i);
    if (match) {
      const type = match[1].toLowerCase();
      const num = parseInt(match[2], 10);
      return `${type}:${num}`;
    }
  }

  return null;
}

/**
 * Splits extracted document blocks into section-level members based on heading signals.
 * @param {Object} fileSignals - Extracted signal output for a file from signalExtractor.js
 * @returns {Array<Object>} Section members found
 */
function buildSectionMembers(fileSignals) {
  const headings = fileSignals.headings || [];
  if (!headings.length) return [];

  const sourceFile = fileSignals.file.fileName;
  const relativePath = fileSignals.file.relativePath;

  // Filter headings containing single Day/Unit/Module tokens
  const tokenHeadings = headings.filter((h) => h.tokens && h.tokens.length === 1);
  if (!tokenHeadings.length) return [];

  // Determine highest structural level among token headings (h1 > h2 > h3)
  const hasH1Token = tokenHeadings.some((h) => h.level === "h1");
  const hasH2Token = tokenHeadings.some((h) => h.level === "h2");
  const primaryLevel = hasH1Token ? "h1" : (hasH2Token ? "h2" : "h3");

  const primaryHeadings = tokenHeadings.filter((h) => h.level === primaryLevel);
  if (!primaryHeadings.length) return [];

  const sectionMembers = [];

  primaryHeadings.forEach((heading, idx) => {
    const startBlockOrder = heading.blockOrder;
    const nextHeading = primaryHeadings[idx + 1];
    const endBlockOrder = nextHeading ? nextHeading.blockOrder - 1 : null;

    heading.tokens.forEach((token) => {
      const relKey = normalizeToken(token);
      if (!relKey) return;

      const evidenceList = [
        {
          source: "heading",
          headingLevel: heading.level,
          matchedText: heading.text,
          sourceFile
        }
      ];

      const fnTokens = (fileSignals.tokens || []).filter(
        (t) => t.source === "filename" && normalizeToken(t) === relKey
      );
      fnTokens.forEach((ft) => {
        evidenceList.push({
          source: "filename",
          matchedText: ft.matchedText,
          sourceFile
        });
      });

      sectionMembers.push({
        memberType: "section",
        sourceFile,
        relativePath,
        startBlockOrder,
        endBlockOrder,
        matchedHeading: heading.text,
        headingLevel: heading.level,
        token: {
          type: token.type,
          number: token.number
        },
        relationshipKey: relKey,
        confidence: heading.level === "h1" ? "high" : "medium",
        evidence: evidenceList
      });
    });
  });

  return sectionMembers;
}

/**
 * Builds file-level members based on extracted tokens in filename or overall signals.
 * @param {Object} fileSignals
 * @returns {Array<Object>} File members
 */
function buildFileMembers(fileSignals) {
  const sourceFile = fileSignals.file.fileName;
  const relativePath = fileSignals.file.relativePath;
  const tokens = fileSignals.tokens || [];
  const role = fileSignals.roleClassification?.role || "unknown";

  const filenameTokens = tokens.filter((t) => t.source === "filename");
  const fileMembers = [];
  const processedKeys = new Set();

  filenameTokens.forEach((token) => {
    const relKey = normalizeToken(token);
    if (!relKey || processedKeys.has(relKey)) return;
    processedKeys.add(relKey);

    fileMembers.push({
      memberType: "file",
      sourceFile,
      relativePath,
      token: {
        type: token.type,
        number: token.number
      },
      relationshipKey: relKey,
      role,
      confidence: fileSignals.roleClassification?.confidence === "high" ? "high" : "medium",
      evidence: [
        {
          source: "filename",
          matchedText: token.matchedText,
          sourceFile
        }
      ]
    });
  });

  return fileMembers;
}

/**
 * Aggregates and detects deterministic relationships across multiple files.
 * @param {Array<Object>} fileInputs - Array of raw file objects { fileName, relativePath, blocks } or signal objects
 * @returns {Object} { relationships: Array<Object>, unassignedFiles: Array<Object> }
 */
function detectRelationships(fileInputs = []) {
  if (!Array.isArray(fileInputs) || fileInputs.length === 0) {
    return { relationships: [], unassignedFiles: [] };
  }

  const signalList = fileInputs.map((input) => {
    if (input.tokens && input.roleClassification && input.file) {
      return input;
    }
    return extractSignals(input);
  });

  const relationshipMap = new Map();
  const assignedFileNames = new Set();

  signalList.forEach((fileSignals) => {
    const fileName = fileSignals.file.fileName;
    const sectionMembers = buildSectionMembers(fileSignals);
    const fileMembers = buildFileMembers(fileSignals);

    // Section-level members supersede file-level members for the same key
    const sectionKeys = new Set(sectionMembers.map((m) => m.relationshipKey));
    const effectiveFileMembers = fileMembers.filter((m) => !sectionKeys.has(m.relationshipKey));

    const allFileMembers = [...effectiveFileMembers, ...sectionMembers];

    if (allFileMembers.length > 0) {
      assignedFileNames.add(fileName);
    }

    allFileMembers.forEach((member) => {
      const key = member.relationshipKey;
      if (!relationshipMap.has(key)) {
        const [typeStr, numStr] = key.split(":");
        relationshipMap.set(key, {
          key,
          type: typeStr,
          number: parseInt(numStr, 10),
          confidence: "medium",
          evidence: [],
          members: []
        });
      }

      const relGroup = relationshipMap.get(key);

      const existingMember = relGroup.members.find(
        (m) =>
          m.sourceFile === member.sourceFile &&
          m.memberType === member.memberType &&
          m.startBlockOrder === member.startBlockOrder
      );

      if (!existingMember) {
        relGroup.members.push(member);
      }

      member.evidence.forEach((ev) => {
        const hasEv = relGroup.evidence.some(
          (e) => e.source === ev.source && e.matchedText === ev.matchedText && e.sourceFile === ev.sourceFile
        );
        if (!hasEv) {
          relGroup.evidence.push(ev);
        }
      });

      if (member.confidence === "high" || relGroup.members.some((m) => m.confidence === "high")) {
        relGroup.confidence = "high";
      }
    });
  });

  const relationships = [...relationshipMap.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.number - b.number;
  });

  const unassignedFiles = signalList
    .filter((s) => !assignedFileNames.has(s.file.fileName))
    .map((s) => ({
      sourceFile: s.file.fileName,
      relativePath: s.file.relativePath,
      role: s.roleClassification?.role || "unknown",
      confidence: s.overallConfidence || "low",
      reason: "No Day/Module/Unit tokens detected"
    }));

  return {
    relationships,
    unassignedFiles
  };
}

module.exports = {
  normalizeToken,
  buildSectionMembers,
  buildFileMembers,
  detectRelationships
};
