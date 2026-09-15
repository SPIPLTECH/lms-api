const prisma = require("../../../config/database");

// Content is polymorphic: a row hangs off exactly one of these four parents
// (enforced by createContentSchema and covered by
// test/content-parent-hierarchy.test.js). Any code that resolves a Content
// back to its course MUST branch over all four — assuming `topicId`, as the
// old Mentor-era schema allowed, silently loses course- and module-direct
// content and would reject legitimate ids.
const PARENT_FIELDS = ["courseId", "moduleId", "lessonId", "topicId"];

/**
 * Validates the learning-position ids a client sent against the one course
 * access has already been granted for.
 *
 * Two distinct failure modes, treated differently on purpose:
 *
 *  - UNRESOLVABLE (row no longer exists): dropped silently. A student who
 *    navigates while a request is in flight, or whose tab is open across a
 *    course edit, sends stale ids constantly. That is not an attack and must
 *    not produce a 403.
 *  - MISMATCHED (row exists but belongs to a different course): dropped AND
 *    reported as a security event. A well-behaved client cannot produce this,
 *    so it means someone is probing for cross-course content.
 *
 * Either way the id is never used. Validation NEVER widens access: it can
 * only narrow what was already authorised for `courseId`.
 *
 * @returns {Promise<{moduleId, lessonId, topicId, contentIds, violations}>}
 */
const validateLearningPosition = async (courseId, raw = {}) => {
  const violations = [];
  const out = { moduleId: null, lessonId: null, topicId: null, contentIds: [] };

  if (!courseId) return { ...out, violations };

  const asId = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

  const rawModuleId = asId(raw.moduleId);
  const rawLessonId = asId(raw.lessonId);
  const rawTopicId = asId(raw.topicId);
  const rawContentIds = Array.isArray(raw.contentIds)
    ? raw.contentIds.map(asId).filter(Boolean).slice(0, 20)
    : [];

  const note = (kind, id, reason) => violations.push({ kind, id, reason });

  // --- module ---------------------------------------------------------
  if (rawModuleId) {
    const mod = await prisma.module.findUnique({
      where: { id: rawModuleId },
      select: { id: true, courseId: true },
    });
    if (!mod) note("module", rawModuleId, "NOT_FOUND");
    else if (mod.courseId !== courseId) note("module", rawModuleId, "FOREIGN_COURSE");
    else out.moduleId = mod.id;
  }

  // --- lesson (walks lesson -> module -> course) -----------------------
  if (rawLessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: rawLessonId },
      select: { id: true, moduleId: true, module: { select: { id: true, courseId: true } } },
    });
    if (!lesson) note("lesson", rawLessonId, "NOT_FOUND");
    else if (lesson.module?.courseId !== courseId) note("lesson", rawLessonId, "FOREIGN_COURSE");
    else {
      out.lessonId = lesson.id;
      // A lesson implies its module. Trust the DB's answer over the
      // client's, so an inconsistent pair resolves to the real parent.
      out.moduleId = lesson.module.id;
    }
  }

  // --- topic (walks topic -> lesson -> module -> course) ---------------
  if (rawTopicId) {
    const topic = await prisma.topic.findUnique({
      where: { id: rawTopicId },
      select: {
        id: true,
        lessonId: true,
        lesson: { select: { id: true, module: { select: { id: true, courseId: true } } } },
      },
    });
    if (!topic) note("topic", rawTopicId, "NOT_FOUND");
    else if (topic.lesson?.module?.courseId !== courseId) note("topic", rawTopicId, "FOREIGN_COURSE");
    else if (out.lessonId && topic.lessonId !== out.lessonId) {
      // Topic is in this course but not under the lesson the client claimed.
      note("topic", rawTopicId, "HIERARCHY_MISMATCH");
    } else {
      out.topicId = topic.id;
      out.lessonId = out.lessonId || topic.lesson.id;
      out.moduleId = out.moduleId || topic.lesson.module.id;
    }
  }

  // --- content (polymorphic: resolve whichever single parent it has) ---
  for (const contentId of rawContentIds) {
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        courseId: true,
        moduleId: true,
        lessonId: true,
        topicId: true,
        module: { select: { courseId: true } },
        lesson: { select: { module: { select: { courseId: true } } } },
        topic: { select: { lesson: { select: { module: { select: { courseId: true } } } } } },
      },
    });

    if (!content) {
      note("content", contentId, "NOT_FOUND");
      continue;
    }

    const parentField = PARENT_FIELDS.find((f) => content[f]);
    let owningCourseId = null;
    if (parentField === "courseId") owningCourseId = content.courseId;
    else if (parentField === "moduleId") owningCourseId = content.module?.courseId || null;
    else if (parentField === "lessonId") owningCourseId = content.lesson?.module?.courseId || null;
    else if (parentField === "topicId") owningCourseId = content.topic?.lesson?.module?.courseId || null;

    if (!owningCourseId) note("content", contentId, "ORPHANED");
    else if (owningCourseId !== courseId) note("content", contentId, "FOREIGN_COURSE");
    else out.contentIds.push(content.id);
  }

  return { ...out, violations };
};

/** Violations worth alerting on — a stale id is noise, a foreign id is not. */
const isSecurityViolation = (v) =>
  v.reason === "FOREIGN_COURSE" || v.reason === "HIERARCHY_MISMATCH";

module.exports = { validateLearningPosition, isSecurityViolation, PARENT_FIELDS };
