const test = require("node:test");
const assert = require("node:assert/strict");
const { detectRelationships } = require("../services/relationshipDetector.service");
const {
  formatLessonTitle,
  deriveLessonTitle,
  groupLessons
} = require("../services/lessonGrouping.service");

test("1. Day 1 becomes one Lesson", () => {
  const rels = detectRelationships([
    { fileName: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", relativePath: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].key, "day:1");
  assert.equal(result.lessons[0].number, 1);
});

test("2. Day 2 becomes one Lesson", () => {
  const rels = detectRelationships([
    { fileName: "Slides_Day2_Boolean_Logic_Gates_Storage.pptx", relativePath: "Slides_Day2_Boolean_Logic_Gates_Storage.pptx", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].key, "day:2");
  assert.equal(result.lessons[0].number, 2);
});

test("3. Day 3 becomes one Lesson", () => {
  const rels = detectRelationships([
    { fileName: "Slides_Day3_Software_OS_Programming.pptx", relativePath: "Slides_Day3_Software_OS_Programming.pptx", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].key, "day:3");
  assert.equal(result.lessons[0].number, 3);
});

test("4. Multiple files with day:1 become ONE Lesson group", () => {
  const rels = detectRelationships([
    { fileName: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", relativePath: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", blocks: [] },
    {
      fileName: "Module1_Video_Links.docx",
      relativePath: "Module1_Video_Links.docx",
      blocks: [{ kind: "text", markdown: "# Day 1 Video Links", attributes: { sourceElement: "h1" } }]
    }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].key, "day:1");
  assert.equal(result.lessons[0].members.length, 2);
});

test("5. Multiple files with day:2 become ONE Lesson group", () => {
  const rels = detectRelationships([
    { fileName: "Slides_Day2_Boolean_Logic_Gates_Storage.pptx", relativePath: "Slides_Day2_Boolean_Logic_Gates_Storage.pptx", blocks: [] },
    {
      fileName: "Module1_Video_Links.docx",
      relativePath: "Module1_Video_Links.docx",
      blocks: [{ kind: "text", markdown: "# Day 2 Video Links", attributes: { sourceElement: "h1" } }]
    }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].key, "day:2");
  assert.equal(result.lessons[0].members.length, 2);
});

test("6. Multiple files with day:3 become ONE Lesson group", () => {
  const rels = detectRelationships([
    { fileName: "Slides_Day3_Software_OS_Programming.pptx", relativePath: "Slides_Day3_Software_OS_Programming.pptx", blocks: [] },
    {
      fileName: "Module1_Video_Links.docx",
      relativePath: "Module1_Video_Links.docx",
      blocks: [{ kind: "text", markdown: "# Day 3 Video Links", attributes: { sourceElement: "h1" } }]
    }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].key, "day:3");
  assert.equal(result.lessons[0].members.length, 2);
});

test("7. Day order is strictly numeric", () => {
  const rels = detectRelationships([
    { fileName: "Slides_Day3.pptx", relativePath: "Slides_Day3.pptx", blocks: [] },
    { fileName: "Slides_Day1.pptx", relativePath: "Slides_Day1.pptx", blocks: [] },
    { fileName: "Slides_Day2.pptx", relativePath: "Slides_Day2.pptx", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.deepEqual(result.lessons.map((l) => l.order), [1, 2, 3]);
  assert.deepEqual(result.lessons.map((l) => l.key), ["day:1", "day:2", "day:3"]);
});

test("8. Module relationship is preserved on Lesson groups", () => {
  const rels = detectRelationships([
    { fileName: "Module1_Computer_Fundamentals_Days1-3.docx", relativePath: "Module1_Computer_Fundamentals_Days1-3.docx", blocks: [
      { kind: "text", markdown: "# DAY 1: Introduction", attributes: { sourceElement: "h1" } }
    ] }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons[0].moduleKey, "module:1");
});

test("9. Lesson title comes from strongest H1 heading", () => {
  const rels = detectRelationships([
    {
      fileName: "Module1_Computer_Fundamentals_Days1-3.docx",
      relativePath: "Module1_Computer_Fundamentals_Days1-3.docx",
      blocks: [
        { kind: "text", markdown: "# DAY 1: Computer Evolution, Architecture & Number Systems", attributes: { sourceElement: "h1" } }
      ]
    },
    { fileName: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", relativePath: "Slides_Day1_Computer_Evolution_Number_Systems.pptx", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons[0].title, "Day 1 — Computer Evolution, Architecture & Number Systems");
});

test("10. Filename fallback title works when no heading exists", () => {
  const title = deriveLessonTitle("day", 1, [
    { memberType: "file", sourceFile: "Slides_Day1_Computer_Evolution_Number_Systems.pptx" }
  ]);
  assert.equal(title, "Day 1 — Computer Evolution Number Systems");
});

test("11. Video Links sections attach to correct Lessons", () => {
  const rels = detectRelationships([
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

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 3);
  assert.equal(result.lessons[0].members[0].sourceFile, "Module1_Video_Links.docx");
  assert.equal(result.lessons[1].members[0].sourceFile, "Module1_Video_Links.docx");
  assert.equal(result.lessons[2].members[0].sourceFile, "Module1_Video_Links.docx");
});

test("12. Module-only resource does NOT become a Lesson", () => {
  const rels = detectRelationships([
    { fileName: "Module1_Image_Checklist.docx", relativePath: "Module1_Image_Checklist.docx", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 0);
  assert.equal(result.moduleResources.length, 1);
  assert.equal(result.moduleResources[0].sourceFile, "Module1_Image_Checklist.docx");
});

test("13. Teaching Plan without Day relationship remains a resource candidate", () => {
  const rels = detectRelationships([
    { fileName: "Module1_Teaching_Plan_Video_Production.docx", relativePath: "Module1_Teaching_Plan_Video_Production.docx", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 0);
  assert.equal(result.moduleResources.length, 1);
  assert.equal(result.moduleResources[0].sourceFile, "Module1_Teaching_Plan_Video_Production.docx");
});

test("14. Section boundaries are preserved", () => {
  const rels = detectRelationships([
    {
      fileName: "Module1_Computer_Fundamentals_Days1-3.docx",
      relativePath: "Module1_Computer_Fundamentals_Days1-3.docx",
      blocks: [
        { kind: "text", markdown: "# DAY 1: Computer Evolution", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "Para 1" },
        { kind: "text", markdown: "# DAY 2: Boolean Logic", attributes: { sourceElement: "h1" } }
      ]
    }
  ]);

  const result = groupLessons(rels);
  const day1Section = result.lessons[0].members.find((m) => m.memberType === "section");
  assert.equal(day1Section.startBlockOrder, 0);
  assert.equal(day1Section.endBlockOrder, 1);
});

test("15. Confidence is preserved on Lesson groups", () => {
  const rels = detectRelationships([
    {
      fileName: "Doc.docx",
      relativePath: "Doc.docx",
      blocks: [{ kind: "text", markdown: "# Day 1 Overview", attributes: { sourceElement: "h1" } }]
    }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons[0].confidence, "high");
});

test("16. Explainability metadata is preserved", () => {
  const rels = detectRelationships([
    { fileName: "Slides_Day1_Evolution.pptx", relativePath: "Slides_Day1_Evolution.pptx", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.deepEqual(result.lessons[0].groupingReason, {
    type: "shared_day_relationship",
    token: "day:1",
    confidence: "high"
  });
});

test("17. No Topic objects are generated", () => {
  const rels = detectRelationships([
    { fileName: "Slides_Day1_Evolution.pptx", relativePath: "Slides_Day1_Evolution.pptx", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons[0].topics, undefined);
});

test("18. No content transformation occurs", () => {
  const rawBlocks = [{ kind: "text", markdown: "# Day 1 Heading", attributes: { sourceElement: "h1" } }];
  const rels = detectRelationships([
    { fileName: "Doc_Day1.docx", relativePath: "Doc_Day1.docx", blocks: rawBlocks }
  ]);

  groupLessons(rels);
  assert.equal(rawBlocks[0].markdown, "# Day 1 Heading");
});

test("19. Empty input handling", () => {
  const result = groupLessons({ relationships: [], unassignedFiles: [] });
  assert.deepEqual(result, { lessons: [], moduleResources: [], unassignedFiles: [] });
});

test("20. Unknown / no-day relationship handling", () => {
  const rels = detectRelationships([
    { fileName: "unrelated_guide_12345.pdf", relativePath: "unrelated_guide_12345.pdf", blocks: [] }
  ]);

  const result = groupLessons(rels);
  assert.equal(result.lessons.length, 0);
  assert.equal(result.unassignedFiles.length, 1);
  assert.equal(result.unassignedFiles[0].sourceFile, "unrelated_guide_12345.pdf");
});

test("21. Real package deterministic lesson grouping test", () => {
  const realPackageFiles = [
    {
      fileName: "Module1_Computer_Fundamentals_Days1-3.docx",
      relativePath: "Module1_Computer_Fundamentals_Days1-3.docx",
      blocks: [
        { kind: "text", markdown: "# DAY 1: Computer Evolution, Architecture & Number Systems", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# DAY 2: Boolean Algebra, Logic Gates & Storage Systems", attributes: { sourceElement: "h1" } },
        { kind: "text", markdown: "# DAY 3: Software, Operating Systems & Programming Concepts", attributes: { sourceElement: "h1" } }
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

  const rels = detectRelationships(realPackageFiles);
  const result = groupLessons(rels);

  assert.equal(result.lessons.length, 3);
  assert.equal(result.lessons[0].title, "Day 1 — Computer Evolution, Architecture & Number Systems");
  assert.equal(result.lessons[1].title, "Day 2 — Boolean Algebra, Logic Gates & Storage Systems");
  assert.equal(result.lessons[2].title, "Day 3 — Software, Operating Systems & Programming Concepts");

  assert.equal(result.moduleResources.length, 3);
  const resourceFiles = result.moduleResources.map((r) => r.sourceFile);
  assert.ok(resourceFiles.includes("Module1_Image_Checklist.docx"));
  assert.ok(resourceFiles.includes("Module1_Infographics.pptx"));
  assert.ok(resourceFiles.includes("Module1_Teaching_Plan_Video_Production.docx"));
});
