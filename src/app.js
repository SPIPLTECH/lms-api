const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const path = require("path");

const errorHandler = require("./middleware/error.middleware");

const teacherRoutes = require("./modules/teacher/teacher.route");
const authRoutes = require("./modules/auth/auth.routes");
const userRoutes = require("./modules/users/user.routes");
const studentRoutes = require("./modules/students/student.route");
const courseRoutes = require("./modules/courses/course.routes");
const batchRoutes = require("./modules/batches/batch.routes");
const importRoutes = require("./modules/import/routes/import.routes");
const moduleRoutes = require("./modules/modules/module.routes");
const lessonRoutes = require("./modules/lessons/lesson.routes");
const topicRoutes = require("./modules/topics/topic.routes");
const contentRoutes = require("./modules/contents/content.routes");
const enrollmentRoutes = require("./modules/enrollments/enrollment.routes");
const progressRoutes = require("./modules/progress/progress.routes");
const quizRoutes = require("./modules/quizzes/quiz.routes");
const questionRoutes = require("./modules/questions/question.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const reviewRoutes = require("./modules/reviews/review.routes");
const certificateRoutes = require("./modules/certificates/certificate.routes");
const adminRoutes = require("./modules/admin/admin.route");
const stickyNoteRoutes = require("./modules/sticky-note/sticky-note.routes");
const noteRoutes = require("./modules/notes/note.routes");
const bookmarkRoutes = require("./modules/bookmarks/bookmark.routes");
const liveClassRoutes = require("./modules/live-classes/live-class.routes");
const achievementRoutes = require("./modules/achievements/achievement.routes");
const assignmentRoutes = require("./modules/assignments/assignment.routes");
const calendarRoutes = require("./modules/calendar/calendar.routes");
const upcomingTasksRoutes = require("./modules/upcoming-tasks/upcoming-tasks.routes");
const storeRoutes = require("./modules/store/store.routes");
const paymentRoutes = require("./modules/payments/payment.routes");
const announcementRoutes = require("./modules/announcements/announcement.routes");
const resultsRoutes = require("./modules/results/results.routes");
const lessonQueryRoutes = require("./modules/lesson-queries/lessonQuery.routes");

const notificationRoutes = require("./modules/notifications/notification.routes");
const conversationRoutes = require("./modules/conversations/conversation.routes");
const messageRoutes = require("./modules/messages/message.routes");
const landingRoutes = require("./modules/landing/landing.routes");
const observation = require("./modules/observation");
const studentState = require("./modules/student-state");
const assessment = require("./modules/assessment");
const recommendation = require("./modules/recommendation");
const motivation = require("./modules/motivation");
const teacherInsights = require("./modules/teacher-insights");
const analytics = require("./modules/analytics");
const career = require("./modules/career");
const learningPath = require("./modules/learning-path");
const placement = require("./modules/placement");
const adminIntelligence = require("./modules/admin-intelligence");
const mentor = require("./modules/mentor");
const courseImportRoutes = require("./modules/course-import/routes");
const app = express();
app.disable('etag');

app.use(cors());
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(morgan("dev"));

app.use(express.json({
  limit: "100mb",
  // Webhook signature verification (Razorpay) needs the exact raw bytes the
  // sender signed — re-serializing req.body with JSON.stringify can produce
  // a byte-for-byte different string and break HMAC verification.
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Orange LMS API Running",
  });
});

/*
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
*/
app.use("/payments", paymentRoutes);
app.use("/store", storeRoutes);
app.use("/teachers", teacherRoutes);
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/students", studentRoutes);
app.use("/courses/import", importRoutes);
app.use("/courses", courseRoutes);
app.use("/batches", batchRoutes);
app.use("/modules", moduleRoutes);
app.use("/lessons", lessonRoutes);
app.use("/topics", topicRoutes);
app.use("/contents", contentRoutes);
app.use("/enrollments", enrollmentRoutes);
app.use("/progress", progressRoutes);
app.use("/quizzes", quizRoutes);
app.use("/questions", questionRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/public", landingRoutes);

// Fallback direct endpoint for student dashboard upcoming-tasks
app.get(
  "/student/dashboard/upcoming-tasks",
  require("./middleware/auth.middleware"),
  require("./middleware/role.middleware")(["STUDENT"]),
  require("./modules/dashboard/dashboard.controller").getUpcomingTasks
);
app.use("/reviews", reviewRoutes);
app.use("/certificates", certificateRoutes);
app.use("/admin", adminRoutes);
app.use("/sticky-notes", stickyNoteRoutes);
app.use("/notifications", notificationRoutes);
app.use("/conversations", conversationRoutes);
app.use("/messages", messageRoutes);
app.use("/notes", noteRoutes);
app.use("/bookmarks", bookmarkRoutes);
app.use("/live-classes", liveClassRoutes);
app.use("/achievements", achievementRoutes);
app.use("/assignments", assignmentRoutes);
app.use("/announcements", announcementRoutes);
app.use("/results", resultsRoutes);
app.use("/lesson-queries", lessonQueryRoutes);
app.use("/calendar", calendarRoutes);
app.use("/upcoming-tasks", upcomingTasksRoutes);
app.use("/events", observation.router);
app.use("/student-state", studentState.router);
app.use("/assessment", assessment.router);
app.use("/recommendations", recommendation.router);
app.use("/motivation", motivation.router);
app.use("/teacher-insights", teacherInsights.router);
app.use("/analytics", analytics.router);
app.use("/career", career.router);
app.use("/learning-path", learningPath.router);
app.use("/placement", placement.router);
app.use("/admin-intelligence", adminIntelligence.router);
app.use("/mentor", mentor.router);
app.use("/course-import", courseImportRoutes);
app.use(
  "/learner-model",
  require("./modules/learner-model/learnerModel.routes")
);
app.use(
  "/adaptive-learning",
  require("./modules/adaptive-learning/adaptiveLearning.routes")
);
app.use(errorHandler);

module.exports = app;
