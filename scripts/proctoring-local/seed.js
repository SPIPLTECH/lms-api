/**
 * Fake users and one course with proctored quizzes, in the disposable local database only, for
 * trying the feature by hand and for the browser run. Prints the ids and sign-ins as JSON.
 *
 *   node scripts/proctoring-local/seed.js [--students=N]
 *
 * Everything is named so it could not be mistaken for a real person. The password is only for
 * this throwaway database.
 */
const crypto = require("crypto");
const { applyLocalEnv } = require("./env");

applyLocalEnv({ testRun: false });

const bcrypt = require("bcrypt");
const prisma = require("../../src/config/database");

const PASSWORD = "Local!Proctor-2026";
const SCENARIOS = ["clean", "phone", "flagged", "kill"];
const stamp = crypto.randomBytes(3).toString("hex");

async function makeUser(role, name, hash) {
  const email = `${name}-${stamp}@proctoring-local.example.com`;
  const user = await prisma.user.create({
    data: {
      name: `${name} (fake ${stamp})`,
      email,
      password: hash,
      role,
      isVerified: true,
      status: "ACTIVE",
      ...(role === "STUDENT" ? { studentProfile: { create: {} } } : {}),
    },
    include: { studentProfile: true },
  });
  return { id: user.id, email, password: PASSWORD, studentId: user.studentProfile?.id ?? null };
}

async function makeQuiz(course, instructor, title, order, overrides = {}) {
  const quiz = await prisma.quiz.create({
    data: { title, quizTag: "FINAL", passingScore: 50, timeLimit: 20, attempts: 1, courseId: course.id, proctoringEnabled: true, proctoringSetById: instructor.id, proctoringSetAt: new Date(), ...overrides },
  });
  await prisma.content.create({ data: { type: "QUIZ", title, order, quizId: quiz.id, courseId: course.id } });
  for (let i = 1; i <= 3; i += 1) {
    const question = await prisma.question.create({
      data: { courseId: course.id, question: `Sample question ${i}: which option is the right one?`, questionType: "MCQ_SINGLE", options: ["The right one", "A wrong one", "Another wrong one"], correctAnswer: "The right one", marks: 1, createdBy: instructor.id },
    });
    await prisma.quizQuestion.create({ data: { quizId: quiz.id, questionId: question.id, order: i, marks: 1 } });
  }
  return quiz;
}

async function main() {
  const database = process.env.DATABASE_URL;
  if (!/lms_proctoring_/.test(database)) throw new Error("Refusing to seed anything but the disposable local database.");

  const hash = await bcrypt.hash(PASSWORD, 8);
  const instructor = await makeUser("INSTRUCTOR", "instructor", hash);
  const admin = await makeUser("ADMIN", "admin", hash);
  const course = await prisma.course.create({ data: { title: `Proctoring trial course ${stamp}`, status: "PUBLISHED", creatorId: instructor.id, sequentialLearning: false } });

  const count = Number((process.argv.find((arg) => arg.startsWith("--students=")) || "").split("=")[1]) || SCENARIOS.length;
  const students = {};
  for (let i = 0; i < count; i += 1) {
    const name = SCENARIOS[i] ?? `student${i}`;
    const user = await makeUser("STUDENT", `student-${name}`, hash);
    await prisma.enrollment.create({ data: { courseId: course.id, studentId: user.studentId } });
    students[name] = user;
  }

  const quizzes = {};
  for (const [index, name] of SCENARIOS.entries()) {
    quizzes[name] = (await makeQuiz(course, instructor, `Proctored exam: ${name} ${stamp}`, index + 1)).id;
  }

  console.log(JSON.stringify({ stamp, password: PASSWORD, instructor, admin, courseId: course.id, students, quizzes }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
