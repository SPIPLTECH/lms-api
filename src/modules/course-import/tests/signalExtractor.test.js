const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractTokens,
  extractNumberedSection,
  extractHeadingSignals,
  classifyFileRole,
  calculateConfidence,
  extractSignals
} = require("../services/signalExtractor.service");

test("Signal Extractor - Day1 / Day2 / Day3 filename token extraction", () => {
  const file1Tokens = extractTokens("Slides_Day1_Computer_Evolution_Number_Systems.pptx", "filename");
  assert.equal(file1Tokens.length, 1);
  assert.deepEqual(file1Tokens[0], {
    type: "day",
    number: 1,
    source: "filename",
    matchedText: "Day1"
  });

  const file2Tokens = extractTokens("Slides_Day2_Boolean_Logic_Gates_Storage.pptx", "filename");
  assert.equal(file2Tokens.length, 1);
  assert.equal(file2Tokens[0].number, 2);

  const file3Tokens = extractTokens("Slides_Day3_Software_OS_Programming.pptx", "filename");
  assert.equal(file3Tokens.length, 1);
  assert.equal(file3Tokens[0].number, 3);
});

test("Signal Extractor - Module and Days range token extraction", () => {
  const tokens = extractTokens("Module1_Computer_Fundamentals_Days1-3.docx", "filename");
  assert.equal(tokens.length, 4);

  const moduleToken = tokens.find((t) => t.type === "module");
  assert.ok(moduleToken);
  assert.equal(moduleToken.number, 1);
  assert.equal(moduleToken.matchedText, "Module1");

  const dayTokens = tokens.filter((t) => t.type === "day");
  assert.equal(dayTokens.length, 3);
  assert.deepEqual(dayTokens.map((t) => t.number), [1, 2, 3]);
});

test("Signal Extractor - Day detection from heading text", () => {
  const blocks = [
    { kind: "text", markdown: "# Day 1: Introduction to Computer Systems", attributes: { sourceElement: "h1" } },
    { kind: "text", markdown: "## Day 2 Session: Logic Gates", attributes: { sourceElement: "h2" } }
  ];

  const headings = extractHeadingSignals(blocks, "sample.docx");
  assert.equal(headings.length, 2);

  assert.equal(headings[0].level, "h1");
  assert.equal(headings[0].tokens.length, 1);
  assert.deepEqual(headings[0].tokens[0], {
    type: "day",
    number: 1,
    source: "heading",
    matchedText: "Day 1",
    headingLevel: "h1",
    blockOrder: 0,
    sourceFile: "sample.docx"
  });

  assert.equal(headings[1].level, "h2");
  assert.equal(headings[1].tokens.length, 1);
  assert.equal(headings[1].tokens[0].number, 2);
});

test("Signal Extractor - Numbered heading section detection", () => {
  const sec1 = extractNumberedSection("1.1 Generations of Computers");
  assert.deepEqual(sec1, { sectionPath: [1, 1], matchedText: "1.1" });

  const sec2 = extractNumberedSection("1.6 Number Systems");
  assert.deepEqual(sec2, { sectionPath: [1, 6], matchedText: "1.6" });

  const sec3 = extractNumberedSection("1.6.1 Binary");
  assert.deepEqual(sec3, { sectionPath: [1, 6, 1], matchedText: "1.6.1" });

  const secNone = extractNumberedSection("Generations of Computers");
  assert.equal(secNone, null);
});

test("Signal Extractor - Resource file role classification", () => {
  const checkListRole = classifyFileRole("Module1_Image_Checklist.docx");
  assert.equal(checkListRole.role, "resource");
  assert.equal(checkListRole.confidence, "high");

  const linksRole = classifyFileRole("Module1_Video_Links.docx");
  assert.equal(linksRole.role, "resource");
  assert.equal(linksRole.confidence, "high");

  const planRole = classifyFileRole("Module1_Teaching_Plan_Video_Production.docx");
  assert.equal(planRole.role, "resource");
  assert.equal(planRole.confidence, "high");
});

test("Signal Extractor - Primary content file role classification", () => {
  const slidesRole = classifyFileRole("Slides_Day1_Computer_Evolution_Number_Systems.pptx");
  assert.equal(slidesRole.role, "primary");
  assert.equal(slidesRole.confidence, "high");

  const fundRole = classifyFileRole("Module1_Computer_Fundamentals_Days1-3.docx");
  assert.equal(fundRole.role, "primary");
  assert.equal(fundRole.confidence, "high");
});

test("Signal Extractor - Unknown/low confidence file classification", () => {
  const unknownRole = classifyFileRole("random_document_12345.pdf");
  assert.equal(unknownRole.role, "unknown");
  assert.equal(unknownRole.confidence, "low");
  assert.equal(unknownRole.signals.length, 0);

  const confidence = calculateConfidence({
    tokens: [],
    headings: [],
    roleClassification: unknownRole
  });
  assert.equal(confidence, "low");
});

test("Signal Extractor - High vs Medium vs Low confidence rules", () => {
  // HIGH: Explicit Day/Unit token found in an H1 heading
  const highSignals = extractSignals({
    fileName: "random.docx",
    blocks: [
      { kind: "text", markdown: "# Unit 1 Overview", attributes: { sourceElement: "h1" } }
    ]
  });
  assert.equal(highSignals.overallConfidence, "high");

  // MEDIUM: Token found only in filename or H2/H3
  const medSignals = extractSignals({
    fileName: "Slides_Day1_Computer_Evolution_Number_Systems.pptx",
    blocks: []
  });
  assert.equal(medSignals.overallConfidence, "medium");

  // LOW: No meaningful signal
  const lowSignals = extractSignals({
    fileName: "Untitled.docx",
    blocks: [{ kind: "text", markdown: "Plain text paragraph with no headings", attributes: { sourceElement: "p" } }]
  });
  assert.equal(lowSignals.overallConfidence, "low");
});

test("Signal Extractor - Full explainable output structure for real package files", () => {
  const result = extractSignals({
    fileName: "Slides_Day1_Computer_Evolution_Number_Systems.pptx",
    blocks: [
      { kind: "text", markdown: "# 1.1 Generations of Computers", attributes: { sourceElement: "h1" } },
      { kind: "text", markdown: "## 1.6 Number Systems", attributes: { sourceElement: "h2" } },
      { kind: "text", markdown: "### 1.6.1 Binary", attributes: { sourceElement: "h3" } }
    ]
  });

  assert.equal(result.file.fileName, "Slides_Day1_Computer_Evolution_Number_Systems.pptx");
  assert.equal(result.roleClassification.role, "primary");
  assert.ok(result.tokens.some((t) => t.type === "day" && t.number === 1 && t.matchedText === "Day1"));

  assert.equal(result.headings.length, 3);
  assert.deepEqual(result.headings[0].numberedSection, [1, 1]);
  assert.deepEqual(result.headings[1].numberedSection, [1, 6]);
  assert.deepEqual(result.headings[2].numberedSection, [1, 6, 1]);

  assert.ok(result.roleClassification.signals.every((s) => s.matchedText && s.location));
  assert.ok(result.tokens.every((t) => t.matchedText && t.source));
});
