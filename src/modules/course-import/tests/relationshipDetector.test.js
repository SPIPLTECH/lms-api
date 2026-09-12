const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeToken,
  buildSectionMembers,
  buildFileMembers,
  detectRelationships
} = require("../services/relationshipDetector.service");

test("1. Token Normalization - Day 1, DAY 1, Day1, Days 1 normalize to day:1", () => {
  assert.equal(normalizeToken({ type: "day", number: 1 }), "day:1");
  assert.equal(normalizeToken("Day 1"), "day:1");
  assert.equal(normalizeToken("DAY 1"), "day:1");
  assert.equal(normalizeToken("Day1"), "day:1");
  assert.equal(normalizeToken("Days 1"), "day:1");
  assert.equal(normalizeToken("day_1"), "day:1");
  assert.equal(normalizeToken({ type: "module", number: 1 }), "module:1");
  assert.equal(normalizeToken({ type: "unit", number: 2 }), "unit:2");
});

test("2. Day1 vs Day2 filename relationships", () => {
  const result = detectRelationships([
    { fileName: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", relativePath: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", blocks: [] },
    { fileName: "Slides_Day2_Boolean_Logic_Gates_Storage.pptx", relativePath: "Slides_Day2_Boolean_Logic_Gates_Storage.pptx", blocks: [] }
  ]);

  const day1Rel = result.relationships.find((r) => r.key === "day:1");
  const day2Rel = result.relationships.find((r) => r.key === "day:2");

  assert.ok(day1Rel);
  assert.ok(day2Rel);

  assert.equal(day1Rel.members.length, 1);
  assert.equal(day1Rel.members[0].sourceFile, "Slides_Day1_Computer_Evolution_Number_Systems.pptx");

  assert.equal(day2Rel.members.length, 1);
  assert.equal(day2Rel.members[0].sourceFile, "Slides_Day2_Boolean_Logic_Gates_Storage.pptx");
});

test("3. Exact Day matching - Day 1 must NOT match Day 10", () => {
  assert.notEqual(normalizeToken("Day 1"), normalizeToken("Day 10"));
  assert.equal(normalizeToken("Day 10"), "day:10");

  const result = detectRelationships([
    { fileName: "Slides_Day1_Overview.pptx", relativePath: "Slides_Day1_Overview.pptx", blocks: [] },
    { fileName: "Slides_Day10_Advanced.pptx", relativePath: "Slides_Day10_Advanced.pptx", blocks: [] }
  ]);

  const day1Rel = result.relationships.find((r) => r.key === "day:1");
  const day10Rel = result.relationships.find((r) => r.key === "day:10");

  assert.ok(day1Rel);
  assert.ok(day10Rel);
  assert.equal(day1Rel.members[0].sourceFile, "Slides_Day1_Overview.pptx");
  assert.equal(day10Rel.members[0].sourceFile, "Slides_Day10_Advanced.pptx");
});

test("4. Module relationships", () => {
  const result = detectRelationships([
    { fileName: "Module1_Computer_Fundamentals_Days1-3.docx", relativePath: "Module1_Computer_Fundamentals_Days1-3.docx", blocks: [] },
    { fileName: "Module1_Image_Checklist.docx", relativePath: "Module1_Image_Checklist.docx", blocks: [] }
  ]);

  const mod1Rel = result.relationships.find((r) => r.key === "module:1");
  assert.ok(mod1Rel);
  assert.equal(mod1Rel.members.length, 2);
});

test("5. Multi-day document sections", () => {
  const docxFile = {
    fileName: "Module1_Computer_Fundamentals_Days1-3.docx",
    relativePath: "Module1_Computer_Fundamentals_Days1-3.docx",
    blocks: [
      { kind: "text", markdown: "# DAY 1: Computer Evolution, Architecture & Number Systems", attributes: { sourceElement: "h1" } },
      { kind: "text", markdown: "Content for Day 1..." },
      { kind: "text", markdown: "# DAY 2: Boolean Logic, Gates & Storage", attributes: { sourceElement: "h1" } },
      { kind: "text", markdown: "Content for Day 2..." },
      { kind: "text", markdown: "# DAY 3: Software, OS & Programming Languages", attributes: { sourceElement: "h1" } },
      { kind: "text", markdown: "Content for Day 3..." }
    ]
  };

  const result = detectRelationships([docxFile]);

  const day1Rel = result.relationships.find((r) => r.key === "day:1");
  const day2Rel = result.relationships.find((r) => r.key === "day:2");
  const day3Rel = result.relationships.find((r) => r.key === "day:3");

  assert.ok(day1Rel);
  assert.ok(day2Rel);
  assert.ok(day3Rel);

  const sec1 = day1Rel.members.find((m) => m.memberType === "section");
  const sec2 = day2Rel.members.find((m) => m.memberType === "section");
  const sec3 = day3Rel.members.find((m) => m.memberType === "section");

  assert.equal(sec1.startBlockOrder, 0);
  assert.equal(sec1.endBlockOrder, 1);
  assert.equal(sec1.matchedHeading, "DAY 1: Computer Evolution, Architecture & Number Systems");

  assert.equal(sec2.startBlockOrder, 2);
  assert.equal(sec2.endBlockOrder, 3);

  assert.equal(sec3.startBlockOrder, 4);
  assert.equal(sec3.endBlockOrder, null);
});

test("6. Cross-file Day grouping (Day 1 DOCX section + Day 1 PPTX + Day 1 Video Links section)", () => {
  const result = detectRelationships([
    {
      fileName: "Module1_Computer_Fundamentals_Days1-3.docx",
      relativePath: "Module1_Computer_Fundamentals_Days1-3.docx",
      blocks: [
        { kind: "text", markdown: "# DAY 1: Computer Evolution", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# DAY 2: Boolean Logic", attributes: { sourceElement: "h1" } }
      ]
    },
    {
      fileName: "Slides_Day1_Computer_Evolution_Number_Systems.pptx",
      relativePath: "Slides_Day1_Computer_Evolution_Number_Systems.pptx",
      blocks: []
    },
    {
      fileName: "Module1_Video_Links.docx",
      relativePath: "Module1_Video_Links.docx",
      blocks: [
        { kind: "text", markdown: "# Day 1 Video Links", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# Day 2 Video Links", attributes: { sourceElement: "h1" } }
      ]
    }
  ]);

  const day1Rel = result.relationships.find((r) => r.key === "day:1");
  assert.ok(day1Rel);
  assert.equal(day1Rel.members.length, 3);

  const sourceFiles = day1Rel.members.map((m) => m.sourceFile);
  assert.ok(sourceFiles.includes("Module1_Computer_Fundamentals_Days1-3.docx"));
  assert.ok(sourceFiles.includes("Slides_Day1_Computer_Evolution_Number_Systems.pptx"));
  assert.ok(sourceFiles.includes("Module1_Video_Links.docx"));
});

test("7. Resource file without Day token stays in module:1 only", () => {
  const result = detectRelationships([
    { fileName: "Module1_Image_Checklist.docx", relativePath: "Module1_Image_Checklist.docx", blocks: [] }
  ]);

  const mod1Rel = result.relationships.find((r) => r.key === "module:1");
  const dayRel = result.relationships.find((r) => r.type === "day");

  assert.ok(mod1Rel);
  assert.equal(dayRel, undefined);
  assert.equal(mod1Rel.members[0].sourceFile, "Module1_Image_Checklist.docx");
});

test("8. Video Links document participating in Day1 / Day2 / Day3", () => {
  const result = detectRelationships([
    {
      fileName: "Module1_Video_Links.docx",
      relativePath: "Module1_Video_Links.docx",
      blocks: [
        { kind: "text", markdown: "# Day 1 Video Links", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# Day 2 Video Links", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# Day 3 Video Links", attributes: { sourceElement: "h1" } }
      ]
    }
  ]);

  const dayKeys = result.relationships.map((r) => r.key);
  assert.ok(dayKeys.includes("day:1"));
  assert.ok(dayKeys.includes("day:2"));
  assert.ok(dayKeys.includes("day:3"));
});

test("9. Multiple evidence sources preservation", () => {
  const result = detectRelationships([
    {
      fileName: "Slides_Day1_Computer_Evolution_Number_Systems.pptx",
      relativePath: "Slides_Day1_Computer_Evolution_Number_Systems.pptx",
      blocks: [
        { kind: "text", markdown: "# Day 1: Computer Architecture", attributes: { sourceElement: "h1" } }
      ]
    }
  ]);

  const day1Rel = result.relationships.find((r) => r.key === "day:1");
  assert.ok(day1Rel);
  assert.ok(day1Rel.evidence.length >= 2);
  assert.ok(day1Rel.evidence.some((e) => e.source === "filename"));
  assert.ok(day1Rel.evidence.some((e) => e.source === "heading"));
});

test("10. Confidence preservation", () => {
  const result = detectRelationships([
    {
      fileName: "Doc.docx",
      relativePath: "Doc.docx",
      blocks: [{ kind: "text", markdown: "# Day 1 Main Heading", attributes: { sourceElement: "h1" } }]
    }
  ]);

  const day1Rel = result.relationships.find((r) => r.key === "day:1");
  assert.equal(day1Rel.confidence, "high");
});

test("11. No hallucinated relationships", () => {
  const result = detectRelationships([
    { fileName: "Random_Unrelated_File.pdf", relativePath: "Random_Unrelated_File.pdf", blocks: [] }
  ]);

  assert.equal(result.relationships.length, 0);
  assert.equal(result.unassignedFiles.length, 1);
  assert.equal(result.unassignedFiles[0].sourceFile, "Random_Unrelated_File.pdf");
});

test("12. Explainability and source traceability", () => {
  const result = detectRelationships([
    {
      fileName: "Module1_Computer_Fundamentals_Days1-3.docx",
      relativePath: "Module1_Computer_Fundamentals_Days1-3.docx",
      blocks: [{ kind: "text", markdown: "# Day 1 Fundamentals", attributes: { sourceElement: "h1" } }]
    }
  ]);

  const day1Rel = result.relationships.find((r) => r.key === "day:1");
  assert.ok(day1Rel);
  const member = day1Rel.members[0];
  assert.ok(member.sourceFile);
  assert.ok(member.relativePath);
  assert.ok(member.matchedHeading);
  assert.ok(member.evidence);
});

test("13. Empty input handling", () => {
  const result = detectRelationships([]);
  assert.deepEqual(result, { relationships: [], unassignedFiles: [] });
});

test("14. Unknown / no-token files", () => {
  const result = detectRelationships([
    { fileName: "unrelated_document_12345.pdf", relativePath: "unrelated_document_12345.pdf", blocks: [] }
  ]);
  assert.equal(result.unassignedFiles.length, 1);
  assert.equal(result.unassignedFiles[0].confidence, "low");
});

test("15. Real package filenames deterministic relationship test", () => {
  const realPackageFiles = [
    {
      fileName: "Module1_Computer_Fundamentals_Days1-3.docx",
      relativePath: "Module1_Computer_Fundamentals_Days1-3.docx",
      blocks: [
        { kind: "text", markdown: "# DAY 1: Computer Evolution, Architecture & Number Systems", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# DAY 2: Boolean Logic, Gates & Storage", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# DAY 3: Software, OS & Programming Languages", attributes: { sourceElement: "h1" } }
      ]
    },
    { fileName: "Module1_Image_Checklist.docx", relativePath: "Module1_Image_Checklist.docx", blocks: [] },
    { fileName: "Module1_Infographics.pptx", relativePath: "Module1_Infographics.pptx", blocks: [] },
    { fileName: "Module1_Teaching_Plan_Video_Production.docx", relativePath: "Module1_Teaching_Plan_Video_Production.docx", blocks: [] },
    {
      fileName: "Module1_Video_Links.docx",
      relativePath: "Module1_Video_Links.docx",
      blocks: [
        { kind: "text", markdown: "# Day 1 Video Links", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# Day 2 Video Links", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# Day 3 Video Links", attributes: { sourceElement: "h1" } }
      ]
    },
    { fileName: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", relativePath: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", blocks: [] },
    { fileName: "Slides_Day2_Boolean_Logic_Gates_Storage.pptx", relativePath: "Slides_Day2_Boolean_Logic_Gates_Storage.pptx", blocks: [] },
    { fileName: "Slides_Day3_Software_OS_Programming.pptx", relativePath: "Slides_Day3_Software_OS_Programming.pptx", blocks: [] }
  ];

  const result = detectRelationships(realPackageFiles);

  const keys = result.relationships.map((r) => r.key);
  assert.ok(keys.includes("module:1"));
  assert.ok(keys.includes("day:1"));
  assert.ok(keys.includes("day:2"));
  assert.ok(keys.includes("day:3"));

  const day1Group = result.relationships.find((r) => r.key === "day:1");
  const day1Files = day1Group.members.map((m) => m.sourceFile);
  assert.ok(day1Files.includes("Module1_Computer_Fundamentals_Days1-3.docx"));
  assert.ok(day1Files.includes("Slides_Day1_Computer_Evolution_Number_Systems.pptx"));
  assert.ok(day1Files.includes("Module1_Video_Links.docx"));

  const mod1Group = result.relationships.find((r) => r.key === "module:1");
  assert.equal(mod1Group.members.length, 5);
});
