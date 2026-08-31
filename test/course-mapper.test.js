const test = require("node:test");
const assert = require("node:assert");
const {
  mapCourseToPackageData,
  mapAssetReference,
  mapContentToPackageData
} = require("../src/modules/import/mappers/courseMapper");

test("Canonical Course JSON v2 Mapper Tests", async (t) => {

  await t.test("1. Basic course mapping produces canonical root structure without pricing", () => {
    const inputCourse = {
      id: "course_cuid_123",
      title: "Introduction to JavaScript",
      description: "Basic JS fundamentals",
      category: "Programming",
      level: "BEGINNER",
      thumbnailUrl: "/uploads/thumbnails/1723900000_thumb.png",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      language: "English",
      tags: ["JavaScript", "Web"],
      estimatedLearningHours: 12.5,
      certificatesEnabled: true,
      discussionEnabled: true,
      dripContentEnabled: false,
      publishedAt: new Date(),
      creatorId: "user_instructor_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      store: {
        id: "store_123",
        price: 1999,
        discountPrice: 1499,
        currency: "INR",
        isFree: false,
        courseId: "course_cuid_123"
      },
      modules: []
    };

    const mapped = mapCourseToPackageData(inputCourse);

    assert.strictEqual(mapped.$schema, "https://orangetree.lms/schemas/course-v2.json");
    assert.strictEqual(mapped.version, "2.0");
    assert.strictEqual(mapped.metadata.title, "Introduction to JavaScript");
    assert.strictEqual(mapped.metadata.description, "Basic JS fundamentals");
    assert.strictEqual(mapped.metadata.category, "Programming");
    assert.strictEqual(mapped.metadata.level, "BEGINNER");
    assert.strictEqual(mapped.metadata.thumbnail, "1723900000_thumb.png");
    assert.strictEqual(mapped.metadata.language, "English");
    assert.deepStrictEqual(mapped.metadata.tags, ["JavaScript", "Web"]);
    assert.strictEqual(mapped.metadata.estimatedLearningHours, 12.5);

    // Verify pricing and store are completely excluded from package scope
    assert.strictEqual(mapped.pricing, undefined);
    assert.strictEqual(mapped.store, undefined);

    assert.strictEqual(mapped.settings.visibility, "PUBLIC");
    assert.strictEqual(mapped.settings.certificatesEnabled, true);
    assert.strictEqual(mapped.settings.discussionEnabled, true);
    assert.strictEqual(mapped.settings.dripContentEnabled, false);
    assert.deepStrictEqual(mapped.modules, []);
  });

  await t.test("2. Course with multiple modules maps in correct hierarchy", () => {
    const inputCourse = {
      title: "Multi-Module Course",
      modules: [
        { id: "mod_1", title: "Module 1", order: 1, isPublished: true, lessons: [] },
        { id: "mod_2", title: "Module 2", order: 2, isPublished: false, lessons: [] }
      ]
    };

    const mapped = mapCourseToPackageData(inputCourse);
    assert.strictEqual(mapped.modules.length, 2);
    assert.strictEqual(mapped.modules[0].title, "Module 1");
    assert.strictEqual(mapped.modules[0].order, 1);
    assert.strictEqual(mapped.modules[0].isPublished, true);
    assert.strictEqual(mapped.modules[1].title, "Module 2");
    assert.strictEqual(mapped.modules[1].order, 2);
    assert.strictEqual(mapped.modules[1].isPublished, false);
  });

  await t.test("3. Module with multiple lessons maps correctly", () => {
    const inputCourse = {
      title: "Course with Lessons",
      modules: [
        {
          title: "Module 1",
          order: 1,
          isPublished: true,
          lessons: [
            { id: "les_1", title: "Lesson 1A", order: 1, isPublished: true, topics: [] },
            { id: "les_2", title: "Lesson 1B", order: 2, isPublished: true, topics: [] }
          ]
        }
      ]
    };

    const mapped = mapCourseToPackageData(inputCourse);
    const lessons = mapped.modules[0].lessons;
    assert.strictEqual(lessons.length, 2);
    assert.strictEqual(lessons[0].title, "Lesson 1A");
    assert.strictEqual(lessons[1].title, "Lesson 1B");
  });

  await t.test("4. Lesson with multiple topics maps correctly", () => {
    const inputCourse = {
      title: "Course with Topics",
      modules: [
        {
          title: "Module 1",
          order: 1,
          isPublished: true,
          lessons: [
            {
              title: "Lesson 1",
              order: 1,
              isPublished: true,
              topics: [
                { id: "top_1", title: "Topic Alpha", description: "First topic", order: 1, isPublished: true, contents: [] },
                { id: "top_2", title: "Topic Beta", description: "Second topic", order: 2, isPublished: true, contents: [] }
              ]
            }
          ]
        }
      ]
    };

    const mapped = mapCourseToPackageData(inputCourse);
    const topics = mapped.modules[0].lessons[0].topics;
    assert.strictEqual(topics.length, 2);
    assert.strictEqual(topics[0].title, "Topic Alpha");
    assert.strictEqual(topics[0].description, "First topic");
    assert.strictEqual(topics[1].title, "Topic Beta");
    assert.strictEqual(topics[1].description, "Second topic");
  });

  await t.test("5. Topic with multiple contents maps correctly", () => {
    const inputCourse = {
      title: "Course with Content Items",
      modules: [
        {
          title: "Module 1",
          order: 1,
          isPublished: true,
          lessons: [
            {
              title: "Lesson 1",
              order: 1,
              isPublished: true,
              topics: [
                {
                  title: "Topic 1",
                  order: 1,
                  isPublished: true,
                  contents: [
                    { id: "cnt_1", type: "TEXT", title: "Overview", order: 1, htmlContent: "<p>Text</p>" },
                    { id: "cnt_2", type: "VIDEO", title: "Video", order: 2, duration: 120, videoUrl: "/uploads/contents/video.mp4" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const mapped = mapCourseToPackageData(inputCourse);
    const contents = mapped.modules[0].lessons[0].topics[0].contents;
    assert.strictEqual(contents.length, 2);
    assert.strictEqual(contents[0].type, "TEXT");
    assert.strictEqual(contents[0].htmlContent, "<p>Text</p>");
    assert.strictEqual(contents[1].type, "VIDEO");
    assert.strictEqual(contents[1].mediaFile, "contents/video.mp4");
  });

  await t.test("6. Multiple ContentTypes preserve exact enum values", () => {
    const types = [
      "VIDEO", "DOCUMENT", "TEXT", "LINK", "PRESENTATION", "IMAGE",
      "PDF", "FILE", "EXTERNAL_LINK", "HTML", "CODE", "ASSIGNMENT",
      "CODING_EXERCISE", "SCORM", "INTERACTIVE_LAB", "AUDIO", "EMBED", "SLIDE"
    ];

    types.forEach((typeStr) => {
      const mapped = mapContentToPackageData({
        type: typeStr,
        title: `Test ${typeStr}`,
        order: 1
      });
      assert.strictEqual(mapped.type, typeStr, `ContentType ${typeStr} must be preserved verbatim`);
    });
  });

  await t.test("7. Nullable fields preserve null without manufacturing defaults", () => {
    const inputCourse = {
      title: "Minimal Course",
      description: null,
      category: null,
      level: null,
      thumbnailUrl: null,
      language: null,
      tags: [],
      estimatedLearningHours: null,
      modules: [
        {
          title: "Mod 1",
          description: null,
          order: 1,
          isPublished: true,
          lessons: [
            {
              title: "Les 1",
              description: null,
              order: 1,
              isPublished: true,
              topics: [
                {
                  title: "Top 1",
                  description: null,
                  order: 1,
                  isPublished: true,
                  contents: [
                    {
                      type: "TEXT",
                      title: null,
                      order: 1,
                      duration: null,
                      htmlContent: null,
                      externalUrl: null,
                      data: null
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const mapped = mapCourseToPackageData(inputCourse);
    assert.strictEqual(mapped.metadata.description, null);
    assert.strictEqual(mapped.metadata.category, null);
    assert.strictEqual(mapped.metadata.level, null);
    assert.strictEqual(mapped.metadata.thumbnail, null);
    assert.strictEqual(mapped.metadata.language, null);
    assert.strictEqual(mapped.metadata.estimatedLearningHours, null);
    assert.strictEqual(mapped.pricing, undefined);

    const mappedContent = mapped.modules[0].lessons[0].topics[0].contents[0];
    assert.strictEqual(mappedContent.title, null);
    assert.strictEqual(mappedContent.duration, null);
    assert.strictEqual(mappedContent.htmlContent, null);
    assert.strictEqual(mappedContent.externalUrl, null);
    assert.strictEqual(mappedContent.data, null);
  });

  await t.test("8. Content.data is preserved verbatim as opaque JSON", () => {
    const payload = { testCases: [{ input: "a", expected: "b" }], config: { lang: "python" } };
    const mapped = mapContentToPackageData({
      type: "CODING_EXERCISE",
      title: "Code Task",
      order: 1,
      data: payload
    });

    assert.deepStrictEqual(mapped.data, payload);
  });

  await t.test("9. Database ordering values (e.g. 1, 3, 5) are preserved without re-indexing", () => {
    const inputCourse = {
      title: "Sparse Order Course",
      modules: [
        { title: "Mod A", order: 5, isPublished: true, lessons: [] },
        { title: "Mod B", order: 1, isPublished: true, lessons: [] },
        { title: "Mod C", order: 3, isPublished: true, lessons: [] }
      ]
    };

    const mapped = mapCourseToPackageData(inputCourse);
    assert.strictEqual(mapped.modules[0].title, "Mod B");
    assert.strictEqual(mapped.modules[0].order, 1);

    assert.strictEqual(mapped.modules[1].title, "Mod C");
    assert.strictEqual(mapped.modules[1].order, 3);

    assert.strictEqual(mapped.modules[2].title, "Mod A");
    assert.strictEqual(mapped.modules[2].order, 5);
  });

  await t.test("10. Local asset paths are transformed to package relative paths", () => {
    const thumbRef = mapAssetReference("/uploads/thumbnails/1723900000_cover.png", "thumbnails");
    assert.strictEqual(thumbRef.isExternal, false);
    assert.strictEqual(thumbRef.packagePath, "1723900000_cover.png");

    const contentRef = mapAssetReference("/uploads/contents/1723900000_demo.mp4", "contents");
    assert.strictEqual(contentRef.isExternal, false);
    assert.strictEqual(contentRef.packagePath, "contents/1723900000_demo.mp4");
  });

  await t.test("11. External URLs are preserved in videoUrl or externalUrl", () => {
    const ytContent = mapContentToPackageData({
      type: "VIDEO",
      title: "YouTube Video",
      order: 1,
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
    assert.strictEqual(ytContent.videoUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.strictEqual(ytContent.mediaFile, null);

    const extLink = mapContentToPackageData({
      type: "LINK",
      title: "Documentation",
      order: 2,
      externalUrl: "https://developer.mozilla.org"
    });
    assert.strictEqual(extLink.externalUrl, "https://developer.mozilla.org");
    assert.strictEqual(extLink.mediaFile, null);
  });

  await t.test("12. Database-only fields are excluded from canonical JSON output", () => {
    const inputCourse = {
      id: "course_123",
      creatorId: "user_456",
      createdAt: new Date(),
      updatedAt: new Date(),
      publishedAt: new Date(),
      title: "Clean Course",
      modules: [
        {
          id: "mod_1",
          courseId: "course_123",
          createdAt: new Date(),
          updatedAt: new Date(),
          title: "Clean Module",
          order: 1,
          lessons: [
            {
              id: "les_1",
              moduleId: "mod_1",
              createdAt: new Date(),
              updatedAt: new Date(),
              title: "Clean Lesson",
              order: 1,
              topics: [
                {
                  id: "top_1",
                  lessonId: "les_1",
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  title: "Clean Topic",
                  order: 1,
                  contents: [
                    {
                      id: "cnt_1",
                      topicId: "top_1",
                      createdAt: new Date(),
                      updatedAt: new Date(),
                      type: "TEXT",
                      order: 1
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const mapped = mapCourseToPackageData(inputCourse);

    // Verify root excludes database-only fields
    assert.strictEqual(mapped.id, undefined);
    assert.strictEqual(mapped.creatorId, undefined);
    assert.strictEqual(mapped.createdAt, undefined);
    assert.strictEqual(mapped.updatedAt, undefined);
    assert.strictEqual(mapped.publishedAt, undefined);

    // Verify Module excludes IDs and timestamps
    const mod = mapped.modules[0];
    assert.strictEqual(mod.id, undefined);
    assert.strictEqual(mod.courseId, undefined);
    assert.strictEqual(mod.createdAt, undefined);

    // Verify Lesson excludes IDs and timestamps
    const les = mod.lessons[0];
    assert.strictEqual(les.id, undefined);
    assert.strictEqual(les.moduleId, undefined);
    assert.strictEqual(les.createdAt, undefined);

    // Verify Topic excludes IDs and timestamps
    const top = les.topics[0];
    assert.strictEqual(top.id, undefined);
    assert.strictEqual(top.lessonId, undefined);
    assert.strictEqual(top.createdAt, undefined);

    // Verify Content excludes IDs and timestamps
    const cnt = top.contents[0];
    assert.strictEqual(cnt.id, undefined);
    assert.strictEqual(cnt.topicId, undefined);
    assert.strictEqual(cnt.createdAt, undefined);
  });

  await t.test("13. Preserves actual Topic titles; does not inject artificial 'General' topic", () => {
    const inputCourse = {
      title: "Real Topic Course",
      modules: [
        {
          title: "Module A",
          order: 1,
          lessons: [
            {
              title: "Lesson A",
              order: 1,
              topics: [
                { title: "Advanced React Patterns", order: 1, contents: [] }
              ]
            }
          ]
        }
      ]
    };

    const mapped = mapCourseToPackageData(inputCourse);
    assert.strictEqual(mapped.modules[0].lessons[0].topics[0].title, "Advanced React Patterns");
    assert.notStrictEqual(mapped.modules[0].lessons[0].topics[0].title, "General");
  });

  await t.test("14. Handles empty modules, lessons, topics, and contents arrays gracefully", () => {
    const inputCourse = {
      title: "Empty Hierarchy Course",
      modules: []
    };

    const mapped = mapCourseToPackageData(inputCourse);
    assert.deepStrictEqual(mapped.modules, []);
  });

});
