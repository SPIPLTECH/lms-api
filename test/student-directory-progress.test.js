const test = require("node:test");
const assert = require("node:assert");

const studentService = require("../src/modules/students/student.service");
const prisma = require("../src/config/database");

// The Student Directory used to show a recomputed item-count percentage
// (treeStats) instead of the same Enrollment.progressPercent the student's
// own My Courses card reads, so the two views could disagree for the same
// student/course. getStudents must report the stored value per course.

test("getStudents — per-course progress matches stored Enrollment.progressPercent", async (t) => {
  const originals = {
    studentProfileFindMany: prisma.studentProfile.findMany,
    courseFindUnique: prisma.course.findUnique,
    quizSubmissionFindMany: prisma.quizSubmission.findMany,
  };
  t.after(() => {
    prisma.studentProfile.findMany = originals.studentProfileFindMany;
    prisma.course.findUnique = originals.courseFindUnique;
    prisma.quizSubmission.findMany = originals.quizSubmissionFindMany;
  });

  const enrollment = (courseId, progressPercent) => ({
    courseId,
    progressPercent,
    course: { id: courseId, title: `Course ${courseId}` },
  });

  prisma.studentProfile.findMany = async () => [
    {
      id: "s1",
      user: {
        id: "u1",
        name: "Student One",
        email: "s1@example.com",
        role: "STUDENT",
        status: "ACTIVE",
        createdAt: new Date(),
      },
      enrollments: [enrollment("c1", 0), enrollment("c2", 100), enrollment("c3", 0)],
      assignmentSubmissions: [],
      contentSubmissions: [],
      certificates: [],
    },
  ];
  // The live tree recompute fails for every course here (no course.findUnique
  // fixture) — getStudents must still fall back to the stored per-enrollment
  // progressPercent, exactly as it does for a course removed mid-request.
  prisma.course.findUnique = async () => null;
  prisma.quizSubmission.findMany = async () => [];

  const [student] = await studentService.getStudents(null);

  assert.strictEqual(student.courseProgress.c1.progress, 0);
  assert.strictEqual(student.courseProgress.c2.progress, 100);
  assert.strictEqual(student.courseProgress.c3.progress, 0);
  // Average of the stored per-course percentages (0, 100, 0) — not a
  // recomputed item-count ratio that can disagree with them.
  assert.strictEqual(student.progress, 33);
});
