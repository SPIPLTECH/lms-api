-- Extends the exactly-one-parent CHECK from add-content-parents.sql to cover
-- the two new hierarchy levels (SubTopic, Concept).
--
-- WHY THIS IS REQUIRED, not cosmetic:
-- The original constraint sums only the FOUR original parent columns and
-- requires the total to be exactly 1. A SubTopic- or Concept-attached Content
-- row leaves all four of those NULL, so the sum is 0 and every such INSERT is
-- rejected outright. Without this change SubTopic/Concept content cannot be
-- created at all -- the feature is dead at the database level.
--
-- Note this CHECK is not represented in schema.prisma (Prisma does not model
-- CHECK constraints), which is why it is maintained here by hand, exactly as
-- add-content-parents.sql established.
--
-- SAFETY: every pre-existing row has exactly one of the four original columns
-- set and NULL in both new columns, so its sum stays 1 and it satisfies the
-- rebuilt constraint unchanged. The rebuild therefore cannot reject existing
-- data. It only ADMITS two new shapes that were previously impossible.

BEGIN;

ALTER TABLE "Content" DROP CONSTRAINT IF EXISTS "content_exactly_one_parent";

ALTER TABLE "Content" ADD CONSTRAINT "content_exactly_one_parent" CHECK (
  (CASE WHEN "courseId"   IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "moduleId"   IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "lessonId"   IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "topicId"    IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "subTopicId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "conceptId"  IS NOT NULL THEN 1 ELSE 0 END) = 1
);

COMMIT;
