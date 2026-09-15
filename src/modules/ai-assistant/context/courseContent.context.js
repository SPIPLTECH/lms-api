const prisma = require("../../../config/database");
const { SOURCE_TYPE, PRIORITY, LIMITS } = require("../constants/aiAssistant.constants");
const { stripHtml, clamp } = require("./courseOverview.context");

// Content types whose body is meaningful as text to an LLM. A VIDEO row's
// URL teaches the model nothing, so only its title is used as a signpost.
const TEXTUAL_TYPES = new Set(["HTML", "TEXT", "DOCUMENT", "MARKDOWN", "CODE"]);

/**
 * Renders one Content row as grounding text.
 *
 * Note what is NOT selected anywhere in this file: Question, QuizQuestion,
 * correctAnswer, explanation, or any Assignment body. Assessment material
 * never enters AI context — that is a retrieval-layer guarantee, so no prompt
 * wording or model behaviour can undo it.
 */
const renderContent = (content) => {
  const label = content.title || `${content.type} item`;

  if (TEXTUAL_TYPES.has(content.type) && content.htmlContent) {
    const body = stripHtml(content.htmlContent);
    if (body) return `${label}:\n${clamp(body, LIMITS.MAX_CHUNK_CHARS)}`;
  }

  if (content.type === "VIDEO") {
    return `${label}: a video lesson${content.duration ? ` (~${Math.round(content.duration / 60)} min)` : ""}.`;
  }

  return `${label}: ${String(content.type).toLowerCase()} learning material.`;
};

const contentSelect = {
  id: true,
  title: true,
  type: true,
  htmlContent: true,
  duration: true,
  order: true,
};

/**
 * Deep learning content for an ENROLLED student, assembled nearest-first
 * around where they actually are.
 *
 * Callers MUST have passed resolveScope -> ENROLLED and validateLearningPosition
 * before calling this. It performs no access checks of its own by design: it
 * is a retriever, and mixing authorization into retrieval is precisely how the
 * old Mentor ended up enforcing access in prompt text.
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
        text: renderContent(c),
        priority: PRIORITY.ACTIVE_CONTENT,
      });
    }
  }

  // 2. ACTIVE TOPIC — its description plus any content under it the client
  //    did not already name.
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
      const parts = [`Topic: ${topic.title}`];
      if (topic.description) parts.push(stripHtml(topic.description));
      for (const c of topic.contents) {
        if (contentIds.includes(c.id)) continue;
        parts.push(renderContent(c));
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

  // 3. ACTIVE LESSON — description, lesson-direct content, and the titles of
  //    sibling topics so the model can place the current topic in sequence.
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
      const parts = [`Lesson: ${lesson.title}`];
      if (lesson.description) parts.push(stripHtml(lesson.description));
      for (const c of lesson.contents) {
        if (contentIds.includes(c.id)) continue;
        parts.push(renderContent(c));
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

  // 4. ACTIVE MODULE — titles only. Enough to answer "where does this sit?"
  //    without pulling a second lesson's body into the budget.
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

module.exports = { buildCourseContentContext, renderContent, TEXTUAL_TYPES };
