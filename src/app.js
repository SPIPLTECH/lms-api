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
const moduleRoutes = require("./modules/modules/module.routes");
const lessonRoutes = require("./modules/lessons/lesson.routes");
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

const notificationRoutes = require("./modules/notifications/notification.routes");
const conversationRoutes = require("./modules/conversations/conversation.routes");
const messageRoutes = require("./modules/messages/message.routes");
const app = express();

app.use(cors());
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(morgan("dev"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

app.use("/teachers", teacherRoutes);
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/students", studentRoutes);
app.use("/courses", courseRoutes);
app.use("/modules", moduleRoutes);
app.use("/lessons", lessonRoutes);
app.use("/contents", contentRoutes);
app.use("/enrollments", enrollmentRoutes);
app.use("/progress", progressRoutes);
app.use("/quizzes", quizRoutes);
app.use("/questions", questionRoutes);
app.use("/dashboard", dashboardRoutes);
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
app.use("/calendar", calendarRoutes);
app.use("/upcoming-tasks", upcomingTasksRoutes);
app.use(errorHandler);

module.exports = app;
