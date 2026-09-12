const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCanonicalCourse, deriveCourseMetadata, mapCanonicalContents } = require("../services/canonicalCourseMapper.service");

test("1. Course construction with metadata and modules", () => {
  const meta = { title: "C-CAT Prep", code: "CCAT-01" };
  const course = buildCanonicalCourse({ courseMetadata: meta, lessonGroupingResult: { lessons: [] } });

  assert.equal(course.title, "C-CAT Prep");
  assert.equal(course.code, "CCAT-01");
  assert.ok(Array.isArray(course.modules));
});

test("2. Module construction with key, title, order, lessons", () => {
  const mockGrouping = {
    lessons: [
      { key: "day:1", moduleKey: "module:1", title: "Day 1 — Computer Fundamentals" }
    ]
  };

  const course = buildCanonicalCourse({ lessonGroupingResult: mockGrouping });
  assert.equal(course.modules.length, 1);

  const mod = course.modules[0];
  assert.equal(mod.key, "module:1");
  assert.equal(mod.order, 1);
  assert.equal(mod.lessons.length, 1);
});

test("3. Day -> Lesson mapping (Day 1, Day 2, Day 3)", () => {
  const mockGrouping = {
    lessons: [
      { key: "day:1", title: "Day 1 — Fundamentals" },
      { key: "day:2", title: "Day 2 — Boolean Logic" },
      { key: "day:3", title: "Day 3 — Operating Systems" }
    ]
  };

  const course = buildCanonicalCourse({ lessonGroupingResult: mockGrouping });
  const lessons = course.modules[0].lessons;

  assert.equal(lessons.length, 3);
  assert.equal(lessons[0].key, "day:1");
  assert.equal(lessons[1].key, "day:2");
  assert.equal(lessons[2].key, "day:3");
});

test("4. Topic attachment to Lesson", () => {
  const mockTopicResult = {
    lessons: [
      {
        key: "day:1",
        title: "Day 1",
        topics: [
          { key: "topic:1.1", title: "1.1 Generations of Computers", order: 1, blocks: [] }
        ]
      }
    ]
  };

  const course = buildCanonicalCourse({ topicDetectionResult: mockTopicResult });
  const topics = course.modules[0].lessons[0].topics;

  assert.equal(topics.length, 1);
  assert.equal(topics[0].title, "1.1 Generations of Computers");
});

test("5. Content attachment to Topic", () => {
  const blocks = [
    { kind: "text", markdown: "### 1.1 Generations", blockOrder: 6, attributes: { sourceElement: "h3" } },
    { kind: "text", markdown: "First generation content", blockOrder: 7 }
  ];

  const contents = mapCanonicalContents(blocks, "Doc.docx");
  assert.equal(contents.length, 2);

  assert.equal(contents[0].blockType, "text");
  assert.equal(contents[0].sourceFile, "Doc.docx");
  assert.equal(contents[0].blockIndex, 6);

  assert.equal(contents[1].markdown, "First generation content");
  assert.equal(contents[1].blockIndex, 7);
});

test("6. Multi-day document section mapping preserves block ranges", () => {
  const mockResourceResult = {
    lessonResources: [
      {
        lessonKey: "day:1",
        resources: [
          { sourceFile: "MainDoc.docx", memberType: "section", scope: "lesson", role: "primary", startBlockOrder: 4, endBlockOrder: 138 }
        ]
      }
    ]
  };

  const mockGrouping = { lessons: [{ key: "day:1", title: "Day 1" }] };
  const course = buildCanonicalCourse({ lessonGroupingResult: mockGrouping, resourceMappingResult: mockResourceResult });

  const res = course.modules[0].lessons[0].resources[0];
  assert.equal(res.sourceFile, "MainDoc.docx");
  assert.equal(res.startBlockOrder, 4);
  assert.equal(res.endBlockOrder, 138);
});

test("7. Day-specific slide mapping (Slides_Day1 -> Day 1)", () => {
  const mockResourceResult = {
    lessonResources: [
      {
        lessonKey: "day:1",
        resources: [
          { sourceFile: "Slides_Day1.pptx", scope: "lesson", role: "primary_supporting" }
        ]
      }
    ]
  };

  const mockGrouping = { lessons: [{ key: "day:1", title: "Day 1" }] };
  const course = buildCanonicalCourse({ lessonGroupingResult: mockGrouping, resourceMappingResult: mockResourceResult });

  const res = course.modules[0].lessons[0].resources[0];
  assert.equal(res.sourceFile, "Slides_Day1.pptx");
  assert.equal(res.role, "primary_supporting");
});

test("8. Day-specific video-link mapping (Video Links section -> Day 1)", () => {
  const mockResourceResult = {
    lessonResources: [
      {
        lessonKey: "day:1",
        resources: [
          { sourceFile: "Video_Links.docx", scope: "lesson", role: "student_resource", startBlockOrder: 2, endBlockOrder: 3 }
        ]
      }
    ]
  };

  const mockGrouping = { lessons: [{ key: "day:1", title: "Day 1" }] };
  const course = buildCanonicalCourse({ lessonGroupingResult: mockGrouping, resourceMappingResult: mockResourceResult });

  const res = course.modules[0].lessons[0].resources[0];
  assert.equal(res.sourceFile, "Video_Links.docx");
  assert.equal(res.role, "student_resource");
});

test("9. Module resource mapping (Checklist, Infographics -> Module Resources)", () => {
  const mockResourceResult = {
    moduleResources: [
      { sourceFile: "Image_Checklist.docx", scope: "module", role: "asset_resource" },
      { sourceFile: "Infographics.pptx", scope: "module", role: "student_resource" }
    ]
  };

  const course = buildCanonicalCourse({ resourceMappingResult: mockResourceResult });
  const modRes = course.modules[0].moduleResources;

  assert.equal(modRes.length, 2);
  assert.equal(modRes[0].sourceFile, "Image_Checklist.docx");
  assert.equal(modRes[0].role, "asset_resource");
  assert.equal(modRes[1].sourceFile, "Infographics.pptx");
});

test("10. Instructor resource separation (Teaching Plan role = instructor_resource)", () => {
  const mockResourceResult = {
    lessonResources: [
      {
        lessonKey: "day:1",
        resources: [
          { sourceFile: "Teaching_Plan.docx", scope: "lesson", role: "instructor_resource" }
        ]
      }
    ]
  };

  const mockGrouping = { lessons: [{ key: "day:1", title: "Day 1" }] };
  const course = buildCanonicalCourse({ lessonGroupingResult: mockGrouping, resourceMappingResult: mockResourceResult });

  const res = course.modules[0].lessons[0].resources[0];
  assert.equal(res.role, "instructor_resource");
});

test("11. Asset resource separation (Image Checklist role = asset_resource)", () => {
  const mockResourceResult = {
    moduleResources: [
      { sourceFile: "Image_Checklist.docx", scope: "module", role: "asset_resource" }
    ]
  };

  const course = buildCanonicalCourse({ resourceMappingResult: mockResourceResult });
  const res = course.modules[0].moduleResources[0];
  assert.equal(res.role, "asset_resource");
});

test("12. Deterministic ordering of lessons, topics, contents, resources", () => {
  const mockTopicResult = {
    lessons: [
      {
        key: "day:1",
        title: "Day 1",
        topics: [
          { key: "topic:1", title: "Topic 1", order: 1, blocks: [{ blockOrder: 1 }, { blockOrder: 2 }] },
          { key: "topic:2", title: "Topic 2", order: 2, blocks: [{ blockOrder: 3 }] }
        ]
      }
    ]
  };

  const course = buildCanonicalCourse({ topicDetectionResult: mockTopicResult });
  const lesson = course.modules[0].lessons[0];

  assert.equal(lesson.order, 1);
  assert.equal(lesson.topics[0].order, 1);
  assert.equal(lesson.topics[1].order, 2);
  assert.equal(lesson.topics[0].contents[0].order, 1);
  assert.equal(lesson.topics[0].contents[1].order, 2);
});

test("13. Explainability preservation across all layers", () => {
  const mockTopicResult = {
    lessons: [
      {
        key: "day:1",
        title: "Day 1",
        confidence: "high",
        topics: [
          { key: "topic:1", title: "Topic 1", confidence: "high", detectionReason: { type: "numbered_heading" }, blocks: [] }
        ]
      }
    ]
  };

  const course = buildCanonicalCourse({ topicDetectionResult: mockTopicResult });
  const lesson = course.modules[0].lessons[0];
  const topic = lesson.topics[0];

  assert.ok(lesson.explainability);
  assert.ok(topic.explainability);
  assert.equal(topic.explainability.detectionReason.type, "numbered_heading");
});

test("14. Conservation metrics output", () => {
  const mockTopicResult = {
    blockConservation: { totalSourceBlocks: 325, assignedBlocks: 319, preambleBlocks: 6, lostBlocks: 0 }
  };
  const mockResourceResult = {
    conservation: { totalSourceFiles: 8, mappedResources: 12, moduleResources: 2, unassignedResources: 0 }
  };

  const course = buildCanonicalCourse({
    topicDetectionResult: mockTopicResult,
    resourceMappingResult: mockResourceResult
  });

  const c = course.conservation;
  assert.equal(c.totalSourceFiles, 8);
  assert.equal(c.totalSourceBlocks, 325);
  assert.equal(c.mappedSourceBlocks, 319);
  assert.equal(c.preambleBlocks, 6);
  assert.equal(c.unmappedSourceBlocks, 0);
  assert.equal(c.duplicatedBlocks, 0);
});

test("15. Unmapped-content handling in unmappedContent array", () => {
  const mockResourceResult = {
    unassignedResources: [
      { sourceFile: "UnknownFile.xyz", scope: "unassigned", role: "unknown" }
    ]
  };

  const course = buildCanonicalCourse({ resourceMappingResult: mockResourceResult });
  assert.equal(course.unmappedContent.length, 1);
  assert.equal(course.unmappedContent[0].sourceFile, "UnknownFile.xyz");
});

test("16. Duplicate prevention (0 duplicated files, 0 duplicated blocks)", () => {
  const course = buildCanonicalCourse({});
  assert.equal(course.conservation.duplicatedFiles, 0);
  assert.equal(course.conservation.duplicatedBlocks, 0);
});

test("17. No General topic generation", () => {
  const mockTopicResult = {
    lessons: [
      {
        key: "day:1",
        topics: [
          { key: "t1", title: "1.1 Generations", blocks: [] },
          { key: "t2", title: "1.2 Classification", blocks: [] }
        ]
      }
    ]
  };

  const course = buildCanonicalCourse({ topicDetectionResult: mockTopicResult });
  const topicTitles = course.modules[0].lessons[0].topics.map((t) => t.title);

  assert.ok(!topicTitles.includes("General"));
  assert.ok(!topicTitles.includes("General Topic"));
});

test("18. No flattened lesson generation (preserves topic hierarchy)", () => {
  const mockTopicResult = {
    lessons: [
      {
        key: "day:1",
        topics: [
          { key: "t1", title: "Topic 1", blocks: [{ blockOrder: 1 }] },
          { key: "t2", title: "Topic 2", blocks: [{ blockOrder: 2 }] }
        ]
      }
    ]
  };

  const course = buildCanonicalCourse({ topicDetectionResult: mockTopicResult });
  const lesson = course.modules[0].lessons[0];

  assert.ok(Array.isArray(lesson.topics));
  assert.equal(lesson.topics.length, 2);
  assert.equal(lesson.topics[0].contents.length, 1);
});
