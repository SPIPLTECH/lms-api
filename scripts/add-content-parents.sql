ALTER TABLE "Content" ADD COLUMN "courseId" TEXT;
ALTER TABLE "Content" ADD COLUMN "moduleId" TEXT;
ALTER TABLE "Content" ADD COLUMN "lessonId" TEXT;
ALTER TABLE "Content" ALTER COLUMN "topicId" DROP NOT NULL;

ALTER TABLE "Content" ADD CONSTRAINT "Content_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Content" ADD CONSTRAINT "Content_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Content" ADD CONSTRAINT "Content_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Content_courseId_order_key" ON "Content"("courseId", "order");
CREATE UNIQUE INDEX "Content_moduleId_order_key" ON "Content"("moduleId", "order");
CREATE UNIQUE INDEX "Content_lessonId_order_key" ON "Content"("lessonId", "order");

ALTER TABLE "Content" ADD CONSTRAINT "content_exactly_one_parent" CHECK (
  (CASE WHEN "courseId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "moduleId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "lessonId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "topicId"  IS NOT NULL THEN 1 ELSE 0 END) = 1
);
