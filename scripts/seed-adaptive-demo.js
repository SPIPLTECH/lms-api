/**
 * Demo data for the adaptive agents (Learning Health, Motivation, Learning
 * Path, Career, Analytics, Admin Intelligence) — one course, four learners in
 * deliberately different situations, and accounts to look at it with:
 *
 *   student@demo-agents.example.com     (Priya — active, an overdue + a due-soon assignment)
 *   instructor@demo-agents.example.com  (Asha — owns both courses)
 *   admin@demo-agents.example.com
 *   password: DemoAgents#2026
 *
 *   node scripts/seed-adaptive-demo.js           seed (cleans its own rows first)
 *   node scripts/seed-adaptive-demo.js cleanup   remove everything it created
 *
 * Refuses to run unless the database name contains "test", or
 * ALLOW_DEMO_SEED=true is set: it creates users with a known password.
 * Cleanup removes only its own users (which cascades to their courses,
 * enrolments and agent rows) and those courses' analytics snapshots.
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const prisma = require("../src/config/database");

const MARK = "demo-agents";
const PASSWORD = "DemoAgents#2026";
const DAY = 86_400_000;
const now = Date.now();
const ago = (days, hours = 0) => new Date(now - days * DAY - hours * 3_600_000);

async function cleanup() {
  const demoUsers = { OR: [{ email: { endsWith: `@${MARK}.test` } }, { email: { endsWith: `@${MARK}.example.com` } }] };
  const courses = await prisma.course.findMany({ where: { creator: demoUsers }, select: { id: true } });
  const snapshots = courses.length
    ? await prisma.analyticsSnapshot.deleteMany({ where: { scopeType: "COURSE", scopeId: { in: courses.map((c) => c.id) } } })
    : { count: 0 };
  const users = await prisma.user.deleteMany({ where: demoUsers });
  console.log(`cleanup: ${users.count} demo users (cascade: courses, enrolments, agent rows), ${snapshots.count} course snapshots`);
}

function assertSafeDatabase() {
  const dbName = (process.env.DATABASE_URL || "").split("?")[0].split("/").pop() || "";
  if (!/test/i.test(dbName) && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error(`Refusing to seed demo accounts into "${dbName}". Use a test database or set ALLOW_DEMO_SEED=true.`);
  }
}

async function seed() {
  await cleanup();
  const hash = await bcrypt.hash(PASSWORD, 10);
  const mkUser = (role, name, local) =>
    prisma.user.create({ data: { name, email: `${local}@${MARK}.example.com`, password: hash, role, isVerified: true, status: "ACTIVE" } });

  const instructor = await mkUser("INSTRUCTOR", "Asha Rao", "instructor");
  await mkUser("ADMIN", "Admin Demo", "admin");
  const learnerUsers = await Promise.all([
    mkUser("STUDENT", "Priya Sharma", "student"),
    mkUser("STUDENT", "Rahul Verma", "rahul"),
    mkUser("STUDENT", "Meera Iyer", "meera"),
    mkUser("STUDENT", "Karan Mehta", "karan"),
  ]);
  const [priya, rahul, meera, karan] = await Promise.all(
    learnerUsers.map((u, i) =>
      prisma.studentProfile.create({
        data: { userId: u.id, ...(i === 0 ? { weeklyStudyHours: 5, technicalSkills: ["SQL", "Python"], careerGoalText: "Backend Developer" } : {}) },
      })
    )
  );

  const java = await prisma.course.create({
    data: { title: "Java Programming Fundamentals", creatorId: instructor.id, status: "PUBLISHED", category: "Programming", tags: ["Java", "OOP"] },
  });
  await prisma.course.create({
    data: { title: "Building REST APIs with Node.js", creatorId: instructor.id, status: "PUBLISHED", category: "Web Development", tags: ["REST APIs", "Node.js"] },
  });

  const mod = await prisma.module.create({ data: { title: "Getting started", order: 1, courseId: java.id, isPublished: true } });
  const l1 = await prisma.lesson.create({ data: { title: "Classes and Objects", order: 1, moduleId: mod.id, isPublished: true } });
  const l2 = await prisma.lesson.create({ data: { title: "Inheritance", order: 2, moduleId: mod.id, isPublished: true } });
  const contents = [];
  const items = [
    [l1, "What is a class?", "TEXT", null],
    [l1, "Objects in practice", "VIDEO", 720],
    [l1, "Constructors", "TEXT", null],
    [l2, "Extending a class", "VIDEO", 900],
    [l2, "Method overriding", "TEXT", null],
    [l2, "Inheritance pitfalls", "PDF", null],
  ];
  for (const [i, [lesson, title, type, duration]] of items.entries()) {
    contents.push(await prisma.content.create({ data: { title, type, order: i + 1, lessonId: lesson.id, duration, htmlContent: type === "TEXT" ? `<p>${title}</p>` : null } }));
  }
  const quiz = await prisma.quiz.create({ data: { title: "Classes quiz", passingScore: 50, courseId: java.id, lessonId: l1.id } });
  await prisma.assignment.create({ data: { title: "Design a Bank Account class", courseId: java.id, dueDate: new Date(now + 20 * 3_600_000), status: "ACTIVE" } });
  await prisma.assignment.create({ data: { title: "Shapes hierarchy", courseId: java.id, dueDate: ago(2), status: "ACTIVE" } });

  for (const [profile, enrolledDaysAgo, progress] of [[priya, 25, 30], [rahul, 30, 10], [meera, 40, 60], [karan, 1, 0]]) {
    await prisma.enrollment.create({ data: { studentId: profile.id, courseId: java.id, enrolledAt: ago(enrolledDaysAgo), progressPercent: progress } });
  }

  // Priya: active the last 3 days, finished the first item. Rahul: quiet for 12
  // days with a poor quiz. Meera: steady and strong. Karan: just enrolled.
  const visit = (studentId, content, daysAgo, completed) =>
    prisma.contentProgress.create({ data: { studentId, contentId: content.id, visited: true, visitedAt: ago(daysAgo, 1), completed, completedAt: completed ? ago(daysAgo, 1) : null } });
  await visit(priya.id, contents[0], 2, true);
  await visit(priya.id, contents[1], 1, false);
  await visit(priya.id, contents[1], 0, false).catch(() => prisma.contentProgress.update({ where: { studentId_contentId: { studentId: priya.id, contentId: contents[1].id } }, data: { visitedAt: ago(0, 1) } }));
  await visit(rahul.id, contents[0], 12, false);
  for (let d = 0; d < 6; d++) await prisma.lessonProgress.upsert({
    where: { studentId_lessonId: { studentId: meera.id, lessonId: l1.id } },
    create: { studentId: meera.id, lessonId: l1.id, visited: true, visitedAt: ago(d) },
    update: { visitedAt: ago(d) },
  });
  for (const d of [1, 3, 5, 8]) await prisma.contentProgress.upsert({
    where: { studentId_contentId: { studentId: meera.id, contentId: contents[d % 6].id } },
    create: { studentId: meera.id, contentId: contents[d % 6].id, visited: true, visitedAt: ago(d), completed: true, completedAt: ago(d) },
    update: {},
  });

  const attempt = (studentId, n, pct, daysAgo) =>
    prisma.quizAttempt.create({
      data: { quizId: quiz.id, studentId, attemptNumber: n, answers: {}, score: pct / 10, totalMarks: 10, percentage: pct, passed: pct >= 50, correctCount: pct / 10, incorrectCount: 10 - pct / 10, submittedAt: ago(daysAgo) },
    });
  await attempt(priya.id, 1, 60, 2);
  await attempt(rahul.id, 1, 30, 13);
  await attempt(meera.id, 1, 70, 6);
  await attempt(meera.id, 2, 80, 4);
  await attempt(meera.id, 3, 90, 2);
  await attempt(meera.id, 4, 100, 1);

  // Run the agents exactly as the server would.
  const learningHealth = require("../src/modules/learning-health");
  await learningHealth.sweepCourse(java.id);
  const motivationService = require("../src/modules/motivation/motivation.service");
  const studyPlanService = require("../src/modules/study-plan/studyPlan.service");
  for (const p of [priya, rahul, meera, karan]) await motivationService.recomputeStudent(p.id);
  await studyPlanService.recomputePlan(priya.id, java.id);
  await require("../src/modules/analytics").computeSnapshots();

  console.log(`seeded. Log in with any of: student / instructor / admin @${MARK}.example.com — password ${PASSWORD}`);
  console.log(`course ${java.id}`);
}

Promise.resolve()
  .then(assertSafeDatabase)
  .then(() => (process.argv[2] === "cleanup" ? cleanup() : seed()))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
