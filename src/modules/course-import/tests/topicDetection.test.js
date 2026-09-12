const test = require("node:test");
const assert = require("node:assert/strict");
const { detectRelationships } = require("../services/relationshipDetector.service");
const { groupLessons } = require("../services/lessonGrouping.service");
const {
  isDayLessonHeading,
  isDocumentTitleHeading,
  inspectTopicHeading,
  detectTopicsForSection,
  detectTopicsForCourse
} = require("../services/topicDetection.service");

test("1. Numbered topic detection (1.1, 1.2, 1.6)", () => {
  const block = { kind: "text", markdown: "### 1.1 Generations of Computers", attributes: { sourceElement: "h3" } };
  const res = inspectTopicHeading(block, 6);

  assert.ok(res.isCandidate);
  assert.equal(res.type, "numbered_heading");
  assert.deepEqual(res.numberedSection, [1, 1]);
  assert.equal(res.title, "1.1 Generations of Computers");
});

test("2. H1 Lesson boundary exclusion (# DAY 1... is NOT a Topic)", () => {
  const block = { kind: "text", markdown: "# DAY 1: Computer Evolution, Architecture & Number Systems", attributes: { sourceElement: "h1" } };
  const res = inspectTopicHeading(block, 4);

  assert.equal(res.isCandidate, false);
  assert.equal(res.reason, "day_lesson_boundary_h1");
});

test("3. Document title exclusion (# MODULE 1... is NOT a Topic)", () => {
  const block = { kind: "text", markdown: "# MODULE 1: COMPUTER FUNDAMENTALS & PROGRAMMING CONCEPTS", attributes: { sourceElement: "h1" } };
  const res = inspectTopicHeading(block, 0);

  assert.equal(res.isCandidate, false);
  assert.equal(res.reason, "document_title_h1");
});

test("4. H2/H3 handling", () => {
  const block = { kind: "text", markdown: "## General Overview Section", attributes: { sourceElement: "h2" } };
  const res = inspectTopicHeading(block, 10);

  assert.ok(res.isCandidate);
  assert.equal(res.confidence, "medium");
});

test("5. Nested numbered sections such as 1.6.1 stay inside Topic 1.6", () => {
  const block16 = { kind: "text", markdown: "### 1.6 Number Systems", attributes: { sourceElement: "h3" } };
  const block161 = { kind: "text", markdown: "### 1.6.1 Decimal to Binary Conversion", attributes: { sourceElement: "h3" } };

  const res16 = inspectTopicHeading(block16, 34);
  const res161 = inspectTopicHeading(block161, 38);

  assert.ok(res16.isCandidate);
  assert.equal(res16.type, "numbered_heading");

  assert.equal(res161.isCandidate, false);
  assert.equal(res161.reason, "nested_subsection_depth_3");
});

test("6. MCQ / Assignment / Home Task detection", () => {
  const mcqBlock = { kind: "text", markdown: "## MCQs — DAY 1 (20 Questions)", attributes: { sourceElement: "h2" } };
  const assignBlock = { kind: "text", markdown: "## ASSIGNMENT — DAY 1", attributes: { sourceElement: "h2" } };

  const mcqRes = inspectTopicHeading(mcqBlock, 91);
  const assignRes = inspectTopicHeading(assignBlock, 132);

  assert.ok(mcqRes.isCandidate);
  assert.equal(mcqRes.type, "mcqs_heading");
  assert.equal(mcqRes.practiceKeyword, "mcqs");

  assert.ok(assignRes.isCandidate);
  assert.equal(assignRes.type, "assignment_heading");
  assert.equal(assignRes.practiceKeyword, "assignment");
});

test("7. Topic block boundaries (startBlockOrder, endBlockOrder, blockCount)", () => {
  const blocks = [
    { kind: "text", markdown: "# DAY 1: Intro", attributes: { sourceElement: "h1" } }, // 0
    { kind: "text", markdown: "Preamble para" }, // 1
    { kind: "text", markdown: "### 1.1 Topic One", attributes: { sourceElement: "h3" } }, // 2
    { kind: "text", markdown: "Content 1" }, // 3
    { kind: "text", markdown: "Content 2" }, // 4
    { kind: "text", markdown: "### 1.2 Topic Two", attributes: { sourceElement: "h3" } }, // 5
    { kind: "text", markdown: "Content 3" } // 6
  ];

  const res = detectTopicsForSection({ sourceFile: "test.docx", blocks, startBlockOrder: 0, endBlockOrder: 6 });

  assert.equal(res.topics.length, 2);

  assert.equal(res.topics[0].title, "1.1 Topic One");
  assert.equal(res.topics[0].startBlockOrder, 2);
  assert.equal(res.topics[0].endBlockOrder, 4);
  assert.equal(res.topics[0].blockCount, 3);

  assert.equal(res.topics[1].title, "1.2 Topic Two");
  assert.equal(res.topics[1].startBlockOrder, 5);
  assert.equal(res.topics[1].endBlockOrder, 6);
  assert.equal(res.topics[1].blockCount, 2);
});

test("8. Empty topic handling", () => {
  const res = detectTopicsForSection({ sourceFile: "test.docx", blocks: [], startBlockOrder: 0, endBlockOrder: null });
  assert.equal(res.topics.length, 0);
  assert.equal(res.blockStats.total, 0);
});

test("9. Topic ordering is deterministic (1, 2, 3...)", () => {
  const blocks = [
    { kind: "text", markdown: "### 1.1 Topic One", attributes: { sourceElement: "h3" } },
    { kind: "text", markdown: "### 1.2 Topic Two", attributes: { sourceElement: "h3" } }
  ];

  const res = detectTopicsForSection({ sourceFile: "test.docx", blocks, startBlockOrder: 0, endBlockOrder: 1 });
  assert.deepEqual(res.topics.map((t) => t.order), [1, 2]);
});

test("10. Duplicate prevention (0 duplicated blocks)", () => {
  const blocks = [
    { kind: "text", markdown: "### 1.1 Topic One", attributes: { sourceElement: "h3" } },
    { kind: "text", markdown: "Content" }
  ];

  const res = detectTopicsForSection({ sourceFile: "test.docx", blocks, startBlockOrder: 0, endBlockOrder: 1 });
  assert.equal(res.blockStats.duplicated, 0);
});

test("11. Block conservation invariant (total = assigned + preamble, 0 lost)", () => {
  const blocks = [
    { kind: "text", markdown: "Preamble paragraph" },
    { kind: "text", markdown: "### 1.1 Topic One", attributes: { sourceElement: "h3" } },
    { kind: "text", markdown: "Topic body" }
  ];

  const res = detectTopicsForSection({ sourceFile: "test.docx", blocks, startBlockOrder: 0, endBlockOrder: 2 });
  assert.equal(res.blockStats.total, 3);
  assert.equal(res.blockStats.assigned, 2);
  assert.equal(res.blockStats.preamble, 1);
  assert.equal(res.blockStats.lost, 0);
});

test("12. Real package Day 1 structure validation (1.1 - 1.9 + MCQs + Assignment + Home Task)", () => {
  const mockDay1Blocks = [
    { kind: "text", markdown: "# DAY 1: Computer Evolution, Architecture & Number Systems", attributes: { sourceElement: "h1" } }, // 0
    { kind: "text", markdown: "## THEORY (2 Hours)", attributes: { sourceElement: "h2" } }, // 1
    { kind: "text", markdown: "### 1.1 Generations of Computers", attributes: { sourceElement: "h3" } }, // 2
    { kind: "text", markdown: "Generations content" }, // 3
    { kind: "text", markdown: "### 1.2 Classification of Computers", attributes: { sourceElement: "h3" } }, // 4
    { kind: "text", markdown: "### 1.3 Basic Computer Organization", attributes: { sourceElement: "h3" } }, // 5
    { kind: "text", markdown: "### 1.4 CPU Architecture", attributes: { sourceElement: "h3" } }, // 6
    { kind: "text", markdown: "### 1.5 Memory Hierarchy", attributes: { sourceElement: "h3" } }, // 7
    { kind: "text", markdown: "### 1.6 Number Systems", attributes: { sourceElement: "h3" } }, // 8
    { kind: "text", markdown: "### 1.6.1 Binary", attributes: { sourceElement: "h3" } }, // 9 (nested -> stays in 1.6)
    { kind: "text", markdown: "### 1.7 Binary Arithmetic", attributes: { sourceElement: "h3" } }, // 10
    { kind: "text", markdown: "### 1.8 Complements", attributes: { sourceElement: "h3" } }, // 11
    { kind: "text", markdown: "### 1.9 BCD", attributes: { sourceElement: "h3" } }, // 12
    { kind: "text", markdown: "## MCQs — DAY 1 (20 Questions)", attributes: { sourceElement: "h2" } }, // 13
    { kind: "text", markdown: "## ASSIGNMENT — DAY 1", attributes: { sourceElement: "h2" } }, // 14
    { kind: "text", markdown: "## HOME TASK — DAY 1", attributes: { sourceElement: "h2" } } // 15
  ];

  const res = detectTopicsForSection({ sourceFile: "Module1.docx", blocks: mockDay1Blocks, startBlockOrder: 0, endBlockOrder: 15 });

  assert.equal(res.topics.length, 12);
  const titles = res.topics.map((t) => t.title);

  assert.ok(titles.includes("1.1 Generations of Computers"));
  assert.ok(titles.includes("1.2 Classification of Computers"));
  assert.ok(titles.includes("1.3 Basic Computer Organization"));
  assert.ok(titles.includes("1.4 CPU Architecture"));
  assert.ok(titles.includes("1.5 Memory Hierarchy"));
  assert.ok(titles.includes("1.6 Number Systems"));
  assert.ok(titles.includes("1.7 Binary Arithmetic"));
  assert.ok(titles.includes("1.8 Complements"));
  assert.ok(titles.includes("1.9 BCD"));
  assert.ok(titles.some((t) => t.includes("MCQs")));
  assert.ok(titles.some((t) => t.includes("ASSIGNMENT")));
  assert.ok(titles.some((t) => t.includes("HOME TASK")));

  assert.equal(res.blockStats.lost, 0);
  assert.equal(res.blockStats.total, 16);
});

test("13. Real package Day 2 structure validation", () => {
  const mockDay2Blocks = [
    { kind: "text", markdown: "# DAY 2: Boolean Algebra", attributes: { sourceElement: "h1" } },
    { kind: "text", markdown: "### 2.1 Boolean Algebra", attributes: { sourceElement: "h3" } },
    { kind: "text", markdown: "### 2.2 Logic Gates", attributes: { sourceElement: "h3" } },
    { kind: "text", markdown: "### 2.3 Adders", attributes: { sourceElement: "h3" } },
    { kind: "text", markdown: "### 2.4 Storage Systems", attributes: { sourceElement: "h3" } }
  ];

  const res = detectTopicsForSection({ sourceFile: "Module1.docx", blocks: mockDay2Blocks, startBlockOrder: 0, endBlockOrder: 4 });

  assert.equal(res.topics.length, 4);
  assert.equal(res.blockStats.lost, 0);
});

test("14. Real package Day 3 structure validation", () => {
  const mockDay3Blocks = [
    { kind: "text", markdown: "# DAY 3: Software", attributes: { sourceElement: "h1" } },
    { kind: "text", markdown: "### 3.1 Software Classification", attributes: { sourceElement: "h3" } },
    { kind: "text", markdown: "### 3.2 Programming Languages", attributes: { sourceElement: "h3" } },
    { kind: "text", markdown: "### 3.3 Language Translators", attributes: { sourceElement: "h3" } }
  ];

  const res = detectTopicsForSection({ sourceFile: "Module1.docx", blocks: mockDay3Blocks, startBlockOrder: 0, endBlockOrder: 3 });

  assert.equal(res.topics.length, 3);
  assert.equal(res.blockStats.lost, 0);
});
