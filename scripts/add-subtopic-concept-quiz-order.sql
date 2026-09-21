-- Extends the partial unique quiz-order indexes from add-quiz-order.sql to
-- cover the two new hierarchy levels (SubTopic, Concept).
--
-- WHY THIS IS REQUIRED, not cosmetic:
-- Quiz."courseId" is a required column, so a SubTopic-level quiz has
-- moduleId / lessonId / topicId all NULL while courseId IS set. The original
-- quiz_course_order_key predicate is exactly
--     (moduleId IS NULL AND lessonId IS NULL AND topicId IS NULL)
-- so that SubTopic quiz would be swept into the COURSE order scope and
-- false-collide with a genuine course-direct quiz holding the same order.
-- The same reasoning applies to the module- and lesson-scoped indexes.
--
-- Each rewritten predicate is strictly MORE restrictive than the one it
-- replaces (it only adds `AND ... IS NULL` terms). Every pre-existing row has
-- subTopicId and conceptId NULL, so the rebuilt indexes cover exactly the same
-- existing rows as before -- no current row can violate them, and existing
-- quiz ordering behaviour is unchanged.

BEGIN;

DROP INDEX IF EXISTS quiz_topic_order_key;
DROP INDEX IF EXISTS quiz_lesson_order_key;
DROP INDEX IF EXISTS quiz_module_order_key;
DROP INDEX IF EXISTS quiz_course_order_key;

-- Deepest scope first. Precedence: concept > subtopic > topic > lesson >
-- module > course, matching resolveQuizParentField in quiz.service.js.
CREATE UNIQUE INDEX quiz_concept_order_key
  ON "Quiz" ("conceptId", "order")
  WHERE "conceptId" IS NOT NULL;

CREATE UNIQUE INDEX quiz_subtopic_order_key
  ON "Quiz" ("subTopicId", "order")
  WHERE "subTopicId" IS NOT NULL AND "conceptId" IS NULL;

CREATE UNIQUE INDEX quiz_topic_order_key
  ON "Quiz" ("topicId", "order")
  WHERE "topicId" IS NOT NULL AND "subTopicId" IS NULL AND "conceptId" IS NULL;

CREATE UNIQUE INDEX quiz_lesson_order_key
  ON "Quiz" ("lessonId", "order")
  WHERE "lessonId" IS NOT NULL AND "topicId" IS NULL
    AND "subTopicId" IS NULL AND "conceptId" IS NULL;

CREATE UNIQUE INDEX quiz_module_order_key
  ON "Quiz" ("moduleId", "order")
  WHERE "moduleId" IS NOT NULL AND "lessonId" IS NULL AND "topicId" IS NULL
    AND "subTopicId" IS NULL AND "conceptId" IS NULL;

CREATE UNIQUE INDEX quiz_course_order_key
  ON "Quiz" ("courseId", "order")
  WHERE "moduleId" IS NULL AND "lessonId" IS NULL AND "topicId" IS NULL
    AND "subTopicId" IS NULL AND "conceptId" IS NULL;

COMMIT;
