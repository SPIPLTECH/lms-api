-- Undoes add-course-test-review.sql. Drops every course's test-review settings.
ALTER TABLE "Course" DROP COLUMN IF EXISTS "testReview";
