-- Backfill: place every existing quiz after its scope's current highest
-- Content order, in createdAt order, so pre-existing quizzes land at the
-- end of the merged sequence (a safe default — quiz position was never
-- meaningful before this feature, since quizzes always rendered in their
-- own separate block regardless of any order value).
WITH scope_key AS (
  SELECT id, COALESCE("topicId", "lessonId", "moduleId", "courseId") AS key
  FROM "Quiz"
),
content_max AS (
  SELECT COALESCE("topicId", "lessonId", "moduleId", "courseId") AS key,
         MAX("order") AS max_order
  FROM "Content"
  GROUP BY key
),
quiz_ranked AS (
  SELECT q.id, sk.key,
         ROW_NUMBER() OVER (PARTITION BY sk.key ORDER BY q."createdAt" ASC) AS rn
  FROM "Quiz" q JOIN scope_key sk ON sk.id = q.id
)
UPDATE "Quiz" q
SET "order" = COALESCE(cm.max_order, 0) + qr.rn
FROM quiz_ranked qr
LEFT JOIN content_max cm ON cm.key = qr.key
WHERE q.id = qr.id;

-- Partial unique indexes: Quiz.courseId is always set (unlike Content's
-- four mutually-exclusive columns), so a plain unique(courseId, order)
-- would false-collide between unrelated module/lesson-level quizzes that
-- happen to share a course and an order number. These four scope by the
-- most-specific parent only, using the topic > lesson > module > course
-- precedence this codebase already uses elsewhere (see quiz.service.js's
-- validateQuizScope and the frontend's isTopicQuiz/isLessonQuiz checks).
CREATE UNIQUE INDEX quiz_topic_order_key
  ON "Quiz" ("topicId", "order") WHERE "topicId" IS NOT NULL;

CREATE UNIQUE INDEX quiz_lesson_order_key
  ON "Quiz" ("lessonId", "order")
  WHERE "lessonId" IS NOT NULL AND "topicId" IS NULL;

CREATE UNIQUE INDEX quiz_module_order_key
  ON "Quiz" ("moduleId", "order")
  WHERE "moduleId" IS NOT NULL AND "lessonId" IS NULL AND "topicId" IS NULL;

CREATE UNIQUE INDEX quiz_course_order_key
  ON "Quiz" ("courseId", "order")
  WHERE "moduleId" IS NULL AND "lessonId" IS NULL AND "topicId" IS NULL;
