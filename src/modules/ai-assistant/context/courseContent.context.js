const prisma = require("../../../config/database");
const { SOURCE_TYPE, PRIORITY, LIMITS } = require("../constants/aiAssistant.constants");
const { stripHtml, clamp } = require("./courseOverview.context");

// Content types whose body is meaningful as text to an LLM.
const TEXTUAL_TYPES = new Set(["HTML", "TEXT", "DOCUMENT", "MARKDOWN", "CODE"]);

/**
 * Extracts a readable filename from a storage or public URL.
 */
const fileNameFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  try {
    const cleanUrl = url.split("?")[0];
    const raw = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);
    const decoded = decodeURIComponent(raw);
    return decoded.replace(/^\d+[-_]/, "").replace(/[-_][A-Za-z0-9]{20,}\.pdf$/i, ".pdf");
  } catch {
    return null;
  }
};

/**
 * Renders one Content row as grounding text.
 *
 * Clearly tags the item with its active window type, title, location breadcrumb,
 * and pedagogical context so the assistant immediately knows what the student
 * is viewing and can provide summaries of videos, documents, or readings.
 *
 * Assessment material (quizzes, answer keys, assignments) is never selected.
 */
const renderContent = (content, { isActiveWindow = false } = {}) => {
  const label = content.title || `${content.type} item`;
  const typeStr = String(content.type || "").toUpperCase();

  const breadcrumb = [
    content.module?.title ? `Module: ${content.module.title}` : null,
    content.lesson?.title ? `Lesson: ${content.lesson.title}` : null,
    content.topic?.title ? `Topic: ${content.topic.title}` : null,
  ]
    .filter(Boolean)
    .join(" > ");

  const windowHeader = isActiveWindow
    ? `[CURRENTLY OPEN WINDOW / ACTIVE SCREEN: ${
        typeStr === "VIDEO"
          ? "VIDEO LESSON PLAYER"
          : typeStr === "DOCUMENT" || typeStr === "PDF"
          ? "PDF / DOCUMENT VIEWER"
          : `${typeStr} READING`
      }]\nActive Item Title: "${label}"\n${breadcrumb ? `Syllabus Location: ${breadcrumb}\n` : ""}`
    : `[Content Item] "${label}" (${typeStr}):\n`;

  if (TEXTUAL_TYPES.has(content.type) && content.htmlContent) {
    const body = stripHtml(content.htmlContent);
    if (body) {
      return `${windowHeader}Lesson Reading Content:\n${clamp(body, LIMITS.MAX_CHUNK_CHARS)}`;
    }
  }

  if (content.type === "VIDEO") {
    const durStr = content.duration ? ` (~${Math.round(content.duration / 60)} min)` : "";
    const topicDesc = content.topic?.description ? stripHtml(content.topic.description) : "";
    const descPart = topicDesc ? `\nTopic Context & Subject Description: ${topicDesc}` : "";
    return `${windowHeader}Type: Video lesson${durStr}.${descPart}\n(Pedagogical note for Assistant: The student has this video open on their screen. When asked for an overview or summary of this video, explain what it covers and summarize its core concepts using the title, topic description, and syllabus context.)`;
  }

  if (content.type === "DOCUMENT" || content.type === "PDF") {
    const fname = fileNameFromUrl(content.fileUrl);
    const filePart = fname ? `\nDocument File: ${fname}` : "";
    const topicDesc = content.topic?.description ? stripHtml(content.topic.description) : "";
    const descPart = topicDesc ? `\nTopic Context & Subject Description: ${topicDesc}` : "";
    return `${windowHeader}Type: PDF / Document study material.${filePart}${descPart}\n(Pedagogical note for Assistant: The student has this PDF/document open on their screen. When asked for an overview or summary of this document, explain what it covers and summarize the concepts using the document title, topic description, and syllabus context.)`;
  }

  return `${windowHeader}Type: ${String(content.type).toLowerCase()} learning material.`;
};

const contentSelect = {
  id: true,
  title: true,
  type: true,
  htmlContent: true,
  duration: true,
  fileUrl: true,
  order: true,
  topic: { select: { id: true, title: true, description: true } },
  lesson: { select: { id: true, title: true, description: true } },
  module: { select: { id: true, title: true, description: true } },
};

/**
 * Deep learning content for an ENROLLED student, assembled nearest-first
 * around where they actually are.
 *
 * @param {string} courseId
 * @param {{moduleId, lessonId, topicId, contentIds}} position already validated
 */
const buildCourseContentContext = async (courseId, position = {}) => {
  const { moduleId, lessonId, topicId, contentIds = [] } = position;
  const chunks = [];

  // 1. ACTIVE CONTENT — what is literally on screen. Highest priority.
  if (contentIds.length) {
    const contents = await prisma.content.findMany({
      where: { id: { in: contentIds } },
      select: contentSelect,
      orderBy: { order: "asc" },
    });
    for (const c of contents) {
      chunks.push({
        sourceType: SOURCE_TYPE.CONTENT,
        sourceId: c.id,
        title: c.title || "Current content",
        text: renderContent(c, { isActiveWindow: true }),
        priority: PRIORITY.ACTIVE_CONTENT,
      });
    }
  }

  // 2. ACTIVE TOPIC — its description plus sibling content under it.
  if (topicId) {
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        title: true,
        description: true,
        contents: { orderBy: { order: "asc" }, select: contentSelect, take: LIMITS.MAX_RELATED_ITEMS },
      },
    });
    if (topic) {
      const isTopicWindow = contentIds.length === 0;
      const parts = [
        isTopicWindow
          ? `[CURRENTLY OPEN WINDOW / ACTIVE SCREEN: TOPIC OVERVIEW]\nTopic: ${topic.title}`
          : `Topic: ${topic.title}`,
      ];
      if (topic.description) parts.push(`Description: ${stripHtml(topic.description)}`);
      for (const c of topic.contents) {
        if (contentIds.includes(c.id)) continue;
        parts.push(renderContent(c, { isActiveWindow: false }));
      }
      chunks.push({
        sourceType: SOURCE_TYPE.TOPIC,
        sourceId: topic.id,
        title: topic.title,
        text: clamp(parts.filter(Boolean).join("\n\n"), LIMITS.MAX_CHUNK_CHARS),
        priority: PRIORITY.ACTIVE_TOPIC,
      });
    }
  }

  // 3. ACTIVE LESSON — description, lesson-direct content, and topic sequence.
  if (lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        title: true,
        description: true,
        contents: { orderBy: { order: "asc" }, select: contentSelect, take: LIMITS.MAX_RELATED_ITEMS },
        topics: {
          where: { isPublished: true },
          orderBy: { order: "asc" },
          select: { id: true, title: true },
          take: LIMITS.MAX_RELATED_ITEMS,
        },
      },
    });
    if (lesson) {
      const isLessonWindow = contentIds.length === 0 && !topicId;
      const parts = [
        isLessonWindow
          ? `[CURRENTLY OPEN WINDOW / ACTIVE SCREEN: LESSON OVERVIEW]\nLesson: ${lesson.title}`
          : `Lesson: ${lesson.title}`,
      ];
      if (lesson.description) parts.push(`Description: ${stripHtml(lesson.description)}`);
      for (const c of lesson.contents) {
        if (contentIds.includes(c.id)) continue;
        parts.push(renderContent(c, { isActiveWindow: false }));
      }
      if (lesson.topics.length) {
        parts.push(`Topics in this lesson, in order: ${lesson.topics.map((t) => t.title).join(" → ")}`);
      }
      chunks.push({
        sourceType: SOURCE_TYPE.LESSON,
        sourceId: lesson.id,
        title: lesson.title,
        text: clamp(parts.filter(Boolean).join("\n\n"), LIMITS.MAX_CHUNK_CHARS),
        priority: PRIORITY.ACTIVE_LESSON,
      });
    }
  }

  // 4. ACTIVE MODULE — titles only.
  if (moduleId) {
    const mod = await prisma.module.findUnique({
      where: { id: moduleId },
      select: {
        id: true,
        title: true,
        description: true,
        lessons: {
          where: { isPublished: true },
          orderBy: { order: "asc" },
          select: { id: true, title: true },
          take: LIMITS.MAX_RELATED_ITEMS,
        },
      },
    });
    if (mod) {
      const parts = [`Module: ${mod.title}`];
      if (mod.description) parts.push(stripHtml(mod.description));
      if (mod.lessons.length) {
        parts.push(`Lessons in this module, in order: ${mod.lessons.map((l) => l.title).join(" → ")}`);
      }
      chunks.push({
        sourceType: SOURCE_TYPE.MODULE,
        sourceId: mod.id,
        title: mod.title,
        text: clamp(parts.filter(Boolean).join("\n\n"), LIMITS.MAX_CHUNK_CHARS),
        priority: PRIORITY.ACTIVE_MODULE,
      });
    }
  }

  // 5. RELATED — when the student has NOT pinned a position (e.g. chatting
  //    from the course page rather than mid-lesson), give a structural map so
  //    the assistant can still be useful. Titles only; still no bodies.
  if (!lessonId && !topicId && !contentIds.length) {
    const modules = await prisma.module.findMany({
      where: { courseId, isPublished: true },
      orderBy: { order: "asc" },
      take: LIMITS.MAX_RELATED_ITEMS,
      select: {
        id: true,
        title: true,
        lessons: {
          where: { isPublished: true },
          orderBy: { order: "asc" },
          select: { title: true },
          take: LIMITS.MAX_RELATED_ITEMS,
        },
      },
    });
    if (modules.length) {
      const map = modules
        .map((m) => `- ${m.title}: ${m.lessons.map((l) => l.title).join(", ") || "(no published lessons)"}`)
        .join("\n");
      chunks.push({
        sourceType: SOURCE_TYPE.COURSE,
        sourceId: `${courseId}:structure`,
        title: "Course structure",
        text: `Full structure of this enrolled course:\n${map}`,
        priority: PRIORITY.RELATED,
      });
    }
  }

  return { chunks };
};

module.exports = { buildCourseContentContext };
