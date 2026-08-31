const prisma = require("../../config/database");

/**
 * Get upcoming tasks for a student within [now - 2 days, +14 days] window.
 * Includes: Quizzes, Assignments, Live Classes, Exams, Batches
 */
const getUpcomingTasks = async (userId) => {
  const student = await prisma.studentProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      enrollments: { select: { courseId: true } },
      quizSubmissions: { select: { quizId: true } },
      assignmentSubmissions: { select: { assignmentId: true } },
      batches: { select: { id: true } },
    },
  });

  if (!student) throw new Error("Student not found");

  const studentId = student.id;
  const enrolledCourseIds = student.enrollments.map((e) => e.courseId);
  const submittedQuizIds = student.quizSubmissions.map((s) => s.quizId);
  const submittedAssignmentIds = student.assignmentSubmissions.map((s) => s.assignmentId);
  const joinedBatchIds = student.batches.map((b) => b.id);

  // Window: 2 days ago → 14 days from now
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 2);
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + 14);

  const tasks = [];

  // ── 1. Quizzes (not yet submitted, startDate in window or null) ─────────────────
  const quizzes = await prisma.quiz.findMany({
    where: {
      courseId: { in: enrolledCourseIds },
      id: { notIn: submittedQuizIds },
      OR: [
        { startDate: null },
        { startDate: { gte: windowStart, lte: windowEnd } }
      ]
    },
    include: { course: { select: { title: true } } },
  });

  quizzes.forEach((q) => {
    const startDate = q.startDate ? new Date(q.startDate) : new Date();
    tasks.push({
      id: q.id,
      title: q.title,
      subtitle: q.course?.title || "Quiz",
      type: "quiz",
      startDate: q.startDate || new Date(),
      dueDateLabel: q.startDate ? _formatLabel(startDate) : "Available Now",
    });
  });

  // ── 2. Assignments (not yet submitted, startDate in window or null) ─────────────
  const assignments = await prisma.assignment.findMany({
    where: {
      courseId: { in: enrolledCourseIds },
      id: { notIn: submittedAssignmentIds },
      OR: [
        { startDate: null },
        { startDate: { gte: windowStart, lte: windowEnd } }
      ]
    },
    include: { course: { select: { title: true } } },
  });

  assignments.forEach((a) => {
    const startDate = a.startDate ? new Date(a.startDate) : new Date();
    const dueDate = new Date(a.dueDate);
    const diffDays = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
    tasks.push({
      id: a.id,
      title: a.title,
      subtitle: a.course?.title || "Assignment",
      type: "assignment",
      startDate: a.startDate || new Date(),
      dueDate: a.dueDate,
      dueDateLabel: diffDays <= 0 ? "Due today" : `Due in ${diffDays} day${diffDays !== 1 ? "s" : ""}`,
    });
  });

  // ── 3. Live Classes (scheduledAt in window, enrolled course) ────────────
  const liveClasses = await prisma.liveClass.findMany({
    where: {
      courseId: { in: enrolledCourseIds },
      scheduledAt: { gte: windowStart, lte: windowEnd },
      status: { not: "CANCELLED" },
    },
    include: { course: { select: { title: true } } },
    orderBy: { scheduledAt: "asc" },
  });

  liveClasses.forEach((l) => {
    const scheduledAt = new Date(l.scheduledAt);
    const isLive = l.status === "LIVE";
    tasks.push({
      id: l.id,
      title: l.title,
      subtitle: l.course?.title || "Live Class",
      type: "class",
      startDate: l.scheduledAt,
      dueDateLabel: isLive ? "🔴 Live Now" : _formatDateTime(scheduledAt),
      meetingUrl: l.meetingUrl || null,
    });
  });

  // ── 4. Exams (startDate in window, enrolled course) ──────────────────────
  const exams = await prisma.exam.findMany({
    where: {
      courseId: { in: enrolledCourseIds },
      startDate: { gte: windowStart, lte: windowEnd },
    },
    include: { course: { select: { title: true } } },
    orderBy: { startDate: "asc" },
  });

  exams.forEach((e) => {
    const startDate = new Date(e.startDate);
    tasks.push({
      id: e.id,
      title: e.title,
      subtitle: e.course?.title || "Exam",
      type: "exam",
      startDate: e.startDate,
      dueDateLabel: _formatDateTime(startDate),
    });
  });

  // ── 5. Batches (startDate in window, student enrolled) ───────────────────
  const batches = await prisma.batch.findMany({
    where: {
      courses: { some: { id: { in: enrolledCourseIds } } },
      id: { notIn: joinedBatchIds },
      startDate: { gte: windowStart, lte: windowEnd },
    },
    include: { courses: { select: { title: true } } },
    orderBy: { startDate: "asc" },
  });

  batches.forEach((b) => {
    const startDate = new Date(b.startDate);
    tasks.push({
      id: b.id,
      title: b.name,
      subtitle: b.courses.map((c) => c.title).join(", ") || "Batch",
      type: "batch",
      startDate: b.startDate,
      dueDateLabel: `Starts ${_formatLabel(startDate)}`,
    });
  });

  // ── 6. Calendar Events (from CalendarEvent table) ──────────────────────
  const startStr = windowStart.toISOString().split("T")[0];
  const endStr = windowEnd.toISOString().split("T")[0];
  const calendarEvents = await prisma.calendarEvent.findMany({
    where: {
      date: { gte: startStr, lte: endStr },
      OR: [
        { courseId: null },
        { courseId: "" },
        { courseId: { in: enrolledCourseIds } }
      ]
    },
    orderBy: { date: "asc" },
  });

  calendarEvents.forEach((ce) => {
    const isDuplicate = tasks.some(t => t.id === ce.id || t.title === ce.title);
    if (!isDuplicate) {
      const dateParts = ce.date.split("-");
      const d = new Date(parseInt(dateParts[0], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[2], 10));
      tasks.push({
        id: ce.id,
        title: ce.title,
        subtitle: ce.courseName || ce.description || "Event",
        type: ce.type || "event",
        startDate: ce.date,
        dueDateLabel: ce.startTime ? `${_formatLabel(d)} ${ce.startTime}` : _formatLabel(d),
      });
    }
  });

  // Sort all tasks by startDate ascending (soonest first)
  tasks.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  return tasks;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function _formatLabel(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
  return `In ${diffDays} days`;
}

function _formatDateTime(date) {
  const label = _formatLabel(date);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${label} ${time}`;
}

module.exports = { getUpcomingTasks };
