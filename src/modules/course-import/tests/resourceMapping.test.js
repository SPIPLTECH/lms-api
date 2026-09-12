const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyResourceRole, mapResources } = require("../services/resourceMapping.service");

test("1. Day-specific PPTX maps to correct Lesson", () => {
  const mockLessonGrouping = {
    lessons: [
      {
        key: "day:1",
        title: "Day 1 — Intro",
        moduleKey: "module:1",
        members: [
          { memberType: "file", sourceFile: "Slides_Day1_Computer_Evolution.pptx", role: "primary" }
        ]
      }
    ],
    moduleResources: [],
    unassignedFiles: []
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });
  assert.equal(result.lessonResources.length, 1);
  const day1Res = result.lessonResources[0].resources[0];

  assert.equal(day1Res.sourceFile, "Slides_Day1_Computer_Evolution.pptx");
  assert.equal(day1Res.scope, "lesson");
  assert.equal(day1Res.lessonKey, "day:1");
  assert.equal(day1Res.role, "primary_supporting");
});

test("2. Day-specific filename relationship preserves confidence and reason", () => {
  const role = classifyResourceRole("Slides_Day1_Intro.pptx", "primary");
  assert.equal(role.role, "primary_supporting");
  assert.equal(role.confidence, "high");
  assert.equal(role.reason.type, "primary_supporting_slides");
});

test("3. Multi-day DOCX section splitting preserves block ranges", () => {
  const mockLessonGrouping = {
    lessons: [
      {
        key: "day:1",
        title: "Day 1",
        members: [
          { memberType: "section", sourceFile: "MainDoc.docx", startBlockOrder: 4, endBlockOrder: 138, matchedHeading: "DAY 1: Intro" }
        ]
      },
      {
        key: "day:2",
        title: "Day 2",
        members: [
          { memberType: "section", sourceFile: "MainDoc.docx", startBlockOrder: 139, endBlockOrder: 237, matchedHeading: "DAY 2: Boolean" }
        ]
      }
    ]
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });
  assert.equal(result.lessonResources.length, 2);

  const day1Section = result.lessonResources[0].resources[0];
  assert.equal(day1Section.startBlockOrder, 4);
  assert.equal(day1Section.endBlockOrder, 138);

  const day2Section = result.lessonResources[1].resources[0];
  assert.equal(day2Section.startBlockOrder, 139);
  assert.equal(day2Section.endBlockOrder, 237);
});

test("4. Video Links Day 1/2/3 section mapping", () => {
  const mockLessonGrouping = {
    lessons: [
      {
        key: "day:1",
        members: [{ memberType: "section", sourceFile: "Module1_Video_Links.docx", startBlockOrder: 0, endBlockOrder: 1 }]
      },
      {
        key: "day:2",
        members: [{ memberType: "section", sourceFile: "Module1_Video_Links.docx", startBlockOrder: 2, endBlockOrder: 3 }]
      }
    ]
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });
  const vlDay1 = result.lessonResources[0].resources[0];
  const vlDay2 = result.lessonResources[1].resources[0];

  assert.equal(vlDay1.role, "student_resource");
  assert.equal(vlDay1.scope, "lesson");
  assert.equal(vlDay1.lessonKey, "day:1");

  assert.equal(vlDay2.role, "student_resource");
  assert.equal(vlDay2.scope, "lesson");
  assert.equal(vlDay2.lessonKey, "day:2");
});

test("5. Module-only resource classification (scope: module)", () => {
  const mockLessonGrouping = {
    lessons: [],
    moduleResources: [
      { sourceFile: "Module1_Infographics.pptx", moduleKey: "module:1", role: "resource" }
    ]
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });
  assert.equal(result.moduleResources.length, 1);

  const infoRes = result.moduleResources[0];
  assert.equal(infoRes.sourceFile, "Module1_Infographics.pptx");
  assert.equal(infoRes.scope, "module");
  assert.equal(infoRes.moduleKey, "module:1");
});

test("6. Instructor resource classification (role: instructor_resource)", () => {
  const roleInfo = classifyResourceRole("Module1_Teaching_Plan_Video_Production.docx");
  assert.equal(roleInfo.role, "instructor_resource");
  assert.equal(roleInfo.confidence, "high");
  assert.ok(["plan", "teaching_plan", "teaching plan", "production"].includes(roleInfo.reason.keyword));
});

test("7. Asset resource classification (role: asset_resource)", () => {
  const roleInfo = classifyResourceRole("Module1_Image_Checklist.docx");
  assert.equal(roleInfo.role, "asset_resource");
  assert.equal(roleInfo.confidence, "high");
  assert.equal(roleInfo.reason.keyword, "checklist");
});

test("8. Topic assignment only when explicit evidence exists", () => {
  const mockLessonGrouping = {
    lessons: [
      {
        key: "day:1",
        members: [
          { memberType: "section", sourceFile: "Docx.docx", matchedHeading: "1.1 Generations of Computers" }
        ]
      }
    ]
  };

  const mockTopicDetection = {
    lessons: [
      {
        key: "day:1",
        topics: [
          { key: "topic:Docx.docx:6", matchedHeading: "1.1 Generations of Computers" }
        ]
      }
    ]
  };

  const result = mapResources({
    lessonGroupingResult: mockLessonGrouping,
    topicDetectionResult: mockTopicDetection
  });

  const sectionRes = result.lessonResources[0].resources[0];
  assert.equal(sectionRes.scope, "topic");
  assert.equal(sectionRes.topicKey, "topic:Docx.docx:6");
});

test("9. No arbitrary Topic assignment (Slides PPTX stays at lesson scope)", () => {
  const mockLessonGrouping = {
    lessons: [
      {
        key: "day:1",
        members: [
          { memberType: "file", sourceFile: "Slides_Day1.pptx" }
        ]
      }
    ]
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });
  const slideRes = result.lessonResources[0].resources[0];

  assert.equal(slideRes.scope, "lesson");
  assert.equal(slideRes.topicKey, undefined);
});

test("10. Resource conservation metrics accounting", () => {
  const mockLessonGrouping = {
    lessons: [
      { key: "day:1", members: [{ memberType: "file", sourceFile: "Day1.pptx" }] }
    ],
    moduleResources: [
      { sourceFile: "Checklist.docx" }
    ],
    unassignedFiles: [
      { sourceFile: "Random.pdf" }
    ]
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });
  assert.equal(result.conservation.totalSourceFiles, 3);
  assert.equal(result.conservation.mappedResources, 1);
  assert.equal(result.conservation.moduleResources, 1);
  assert.equal(result.conservation.unassignedResources, 1);
  assert.equal(result.conservation.duplicatedResources, 0);
  assert.equal(result.conservation.lostResources, 0);
});

test("11. Duplicate prevention (0 duplicated resources)", () => {
  const mockLessonGrouping = {
    lessons: [
      { key: "day:1", members: [{ memberType: "file", sourceFile: "Day1.pptx" }] }
    ]
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });
  assert.equal(result.conservation.duplicatedResources, 0);
});

test("12. Unassigned-resource handling (scope: unassigned)", () => {
  const mockLessonGrouping = {
    lessons: [],
    moduleResources: [],
    unassignedFiles: [
      { sourceFile: "RandomUnrelated.pdf" }
    ]
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });
  assert.equal(result.unassignedResources.length, 1);
  const unres = result.unassignedResources[0];

  assert.equal(unres.scope, "unassigned");
  assert.equal(unres.confidence, "low");
});

test("13. Explainability metadata preservation", () => {
  const mockLessonGrouping = {
    lessons: [
      { key: "day:1", members: [{ memberType: "file", sourceFile: "Slides_Day1.pptx" }] }
    ]
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });
  const res = result.lessonResources[0].resources[0];

  assert.ok(res.reason);
  assert.ok(res.confidence);
  assert.equal(res.sourceFile, "Slides_Day1.pptx");
});

test("14. Real package resource mapping validation", () => {
  const mockLessonGrouping = {
    lessons: [
      {
        key: "day:1",
        moduleKey: "module:1",
        members: [
          { memberType: "section", sourceFile: "Module1_Computer_Fundamentals_Days1-3.docx", startBlockOrder: 4, endBlockOrder: 138 },
          { memberType: "file", sourceFile: "Slides_Day1_Computer_Evolution_Number_Systems.pptx" },
          { memberType: "section", sourceFile: "Module1_Video_Links.docx", startBlockOrder: 0, endBlockOrder: 1 }
        ]
      },
      {
        key: "day:2",
        moduleKey: "module:1",
        members: [
          { memberType: "section", sourceFile: "Module1_Computer_Fundamentals_Days1-3.docx", startBlockOrder: 139, endBlockOrder: 237 },
          { memberType: "file", sourceFile: "Slides_Day2_Boolean_Logic_Gates_Storage.pptx" },
          { memberType: "section", sourceFile: "Module1_Video_Links.docx", startBlockOrder: 2, endBlockOrder: 3 }
        ]
      },
      {
        key: "day:3",
        moduleKey: "module:1",
        members: [
          { memberType: "section", sourceFile: "Module1_Computer_Fundamentals_Days1-3.docx", startBlockOrder: 238, endBlockOrder: 328 },
          { memberType: "file", sourceFile: "Slides_Day3_Software_OS_Programming.pptx" },
          { memberType: "section", sourceFile: "Module1_Video_Links.docx", startBlockOrder: 4, endBlockOrder: 5 }
        ]
      }
    ],
    moduleResources: [
      { sourceFile: "Module1_Image_Checklist.docx", moduleKey: "module:1" },
      { sourceFile: "Module1_Infographics.pptx", moduleKey: "module:1" },
      { sourceFile: "Module1_Teaching_Plan_Video_Production.docx", moduleKey: "module:1" }
    ],
    unassignedFiles: []
  };

  const result = mapResources({ lessonGroupingResult: mockLessonGrouping });

  assert.equal(result.lessonResources.length, 3);
  assert.equal(result.moduleResources.length, 3);
  assert.equal(result.unassignedResources.length, 0);

  const modRoles = result.moduleResources.map((m) => ({ file: m.sourceFile, role: m.role }));
  assert.deepEqual(modRoles, [
    { file: "Module1_Image_Checklist.docx", role: "asset_resource" },
    { file: "Module1_Infographics.pptx", role: "student_resource" },
    { file: "Module1_Teaching_Plan_Video_Production.docx", role: "instructor_resource" }
  ]);
});

test("15. Mixed primary/supporting resources classification", () => {
  const rolePrimary = classifyResourceRole("Module1_Computer_Fundamentals_Days1-3.docx");
  const roleSupporting = classifyResourceRole("Slides_Day1_Intro.pptx");
  const roleResource = classifyResourceRole("Module1_Video_Links.docx");

  assert.equal(rolePrimary.role, "primary");
  assert.equal(roleSupporting.role, "primary_supporting");
  assert.equal(roleResource.role, "student_resource");
});
