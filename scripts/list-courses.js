const prisma = require("../src/config/database");

/**
 * Read-only inventory of every course in the database.
 *
 * Writes nothing. Run this before delete-ai-courses.js so you can see exactly
 * what is there and how each course got created, rather than deleting against
 * an assumption.
 *
 * ORIGIN is worked out from CourseImportJob, which is the only durable record
 * of how a course was made — Course itself carries no "created by AI" flag:
 *
 *   import/AI  a CourseImportJob points at this course (courseId is stamped
 *              onto the job when the import completes). Both the file-import
 *              and the AI-generation flows run through that same module, so
 *              this is what "AI generated" resolves to in this schema.
 *   seed       its id starts with "seed_" — created by seed-demo-course.js.
 *   manual     neither: built by hand in the Course Composer.
 *
 * Usage:  node scripts/list-courses.js
 */

async function main() {
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      creator: { select: { email: true, name: true } },
      _count: { select: { modules: true, enrollments: true } },
    },
  });

  // One query rather than one per course; the job table is small.
  const jobs = await prisma.courseImportJob.findMany({
    where: { courseId: { not: null } },
    select: { id: true, courseId: true, status: true, sourceFileName: true },
  });
  const jobByCourse = new Map(jobs.map((j) => [j.courseId, j]));

  const lessonCounts = await prisma.lesson.groupBy({
    by: ["moduleId"],
    _count: { _all: true },
  });
  const modules = await prisma.module.findMany({ select: { id: true, courseId: true } });
  const lessonsByCourse = new Map();
  for (const m of modules) {
    const n = lessonCounts.find((l) => l.moduleId === m.id)?._count?._all || 0;
    lessonsByCourse.set(m.courseId, (lessonsByCourse.get(m.courseId) || 0) + n);
  }

  const originOf = (c) => {
    if (jobByCourse.has(c.id)) return "import/AI";
    if (c.id.startsWith("seed_")) return "seed";
    return "manual";
  };

  console.log(`\n${courses.length} course(s) in the database\n`);
  console.log(
    ["ORIGIN".padEnd(10), "STATUS".padEnd(10), "LESSONS".padEnd(8), "ENROLLED".padEnd(9), "ID".padEnd(28), "TITLE"].join(" ")
  );
  console.log("-".repeat(120));

  for (const c of courses) {
    console.log(
      [
        originOf(c).padEnd(10),
        String(c.status).padEnd(10),
        String(lessonsByCourse.get(c.id) || 0).padEnd(8),
        String(c._count.enrollments).padEnd(9),
        c.id.padEnd(28),
        c.title,
      ].join(" ")
    );
    console.log(
      `${" ".repeat(10)} creator: ${c.creator?.email || "?"}   created: ${c.createdAt.toISOString().slice(0, 10)}` +
        (jobByCourse.get(c.id) ? `   from: ${jobByCourse.get(c.id).sourceFileName}` : "")
    );
  }

  const importCount = courses.filter((c) => jobByCourse.has(c.id)).length;
  console.log("-".repeat(120));
  console.log(
    `\n${importCount} course(s) marked import/AI — these are what delete-ai-courses.js targets.\n` +
      `Review the list above, then run:  node scripts/delete-ai-courses.js\n`
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Listing failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
