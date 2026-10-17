const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const path = require("path");

const errorHandler = require("./middleware/error.middleware");
const { corsOriginDelegate } = require("./config/allowedOrigins");

const teacherRoutes = require("./modules/teacher/teacher.route");
const authRoutes = require("./modules/auth/auth.routes");
const userRoutes = require("./modules/users/user.routes");
const studentRoutes = require("./modules/students/student.route");
const courseRoutes = require("./modules/courses/course.routes");
const moduleRoutes = require("./modules/modules/module.routes");
const lessonRoutes = require("./modules/lessons/lesson.routes");
const topicRoutes = require("./modules/topics/topic.routes");
const subTopicRoutes = require("./modules/subTopic/subTopic.routes");
const conceptRoutes = require("./modules/concept/concept.routes");
const contentRoutes = require("./modules/contents/content.routes");
const enrollmentRoutes = require("./modules/enrollments/enrollment.routes");
const quizRoutes = require("./modules/quizzes/quiz.routes");
const questionRoutes = require("./modules/questions/question.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const reviewRoutes = require("./modules/reviews/review.routes");
const certificateRoutes = require("./modules/certificates/certificate.routes");
const adminRoutes = require("./modules/admin/admin.route");
const stickyNoteRoutes = require("./modules/sticky-note/sticky-note.routes");
const noteRoutes = require("./modules/notes/note.routes");
const bookmarkRoutes = require("./modules/bookmarks/bookmark.routes");
const achievementRoutes = require("./modules/achievements/achievement.routes");
const assignmentRoutes = require("./modules/assignments/assignment.routes");
const resultsRoutes = require("./modules/results/results.routes");
const lessonQueryRoutes = require("./modules/lesson-queries/lessonQuery.routes");
const discussionRoutes = require("./modules/discussions/discussion.routes");
const examRoutes = require("./modules/exams/exam.routes");
const lessonNoteRoutes = require("./modules/lesson-notes/lessonNote.routes");

const notificationRoutes = require("./modules/notifications/notification.routes");
const fileRoutes = require("./modules/files/file.routes");
const courseImportRoutes = require("./modules/course-import/routes");
const aiAssistantRoutes = require("./modules/ai-assistant/aiAssistant.routes");
const progressRoutes = require("./modules/progress/progress.routes");
const app = express();
app.disable('etag');

// Every API call from the frontend is cross-origin with an Authorization
// header, so the browser preflights it. Without Access-Control-Max-Age that
// preflight result is only cached for ~5s, adding an extra OPTIONS round trip
// ahead of most requests. 7200s is the longest Chromium honours.
// CORS_ALLOWED_ORIGINS, when set, is a comma-separated allowlist. Left unset
// the behaviour is exactly what it was — every origin accepted — because
// tightening this blindly would break whatever is already deployed against it.
//
// Reflecting every origin is survivable here specifically because this API
// authenticates from an Authorization header and never from a cookie, so a
// third-party page gets no ambient credentials to ride on. It is still worth
// closing in production, which is what the variable is for.
//
// When it IS set, the decision is delegated to src/config/allowedOrigins.js so
// that this layer and the Socket.io layer agree — including about LAN origins,
// whose IP changes with the network and so cannot be listed up front. The gate
// stays on CORS_ALLOWED_ORIGINS alone (not FRONTEND_URL, which the shared
// module also reads) so that merely having FRONTEND_URL set cannot silently
// turn this layer restrictive.
const corsAllowlistConfigured =
  (process.env.CORS_ALLOWED_ORIGINS || "").trim().length > 0;

app.use(
  cors({
    maxAge: 7200,
    ...(corsAllowlistConfigured ? { origin: corsOriginDelegate } : {})
  })
);
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
app.use("/teachers", teacherRoutes);
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/students", studentRoutes);
app.use("/courses", courseRoutes);
app.use("/modules", moduleRoutes);
app.use("/lessons", lessonRoutes);
app.use("/topics", topicRoutes);
app.use("/subtopics", subTopicRoutes);
app.use("/concepts", conceptRoutes);
app.use("/contents", contentRoutes);
app.use("/enrollments", enrollmentRoutes);
app.use("/quizzes", quizRoutes);
app.use("/questions", questionRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/reviews", reviewRoutes);
app.use("/certificates", certificateRoutes);
app.use("/admin", adminRoutes);
app.use("/sticky-notes", stickyNoteRoutes);
app.use("/notifications", notificationRoutes);
app.use("/files", fileRoutes);
app.use("/notes", noteRoutes);
app.use("/bookmarks", bookmarkRoutes);
app.use("/achievements", achievementRoutes);
app.use("/assignments", assignmentRoutes);
app.use("/results", resultsRoutes);
app.use("/lesson-queries", lessonQueryRoutes);
app.use("/discussions", discussionRoutes);
app.use("/exams", examRoutes);
app.use("/lesson-notes", lessonNoteRoutes);
// The 12 AI agent modules (observation, student-state, assessment,
// recommendation, motivation, teacher-insights, analytics, career,
// learning-path, placement, admin-intelligence, mentor) were removed from
// here — full backup + restoration package at backup/ai-agents/.
// AI Assistant (Gemini-only). Guest sub-route is public via optionalToken;
// everything else requires a session.
app.use("/ai-assistant", aiAssistantRoutes);
app.use("/course-import", courseImportRoutes);
app.use("/api/ai", courseImportRoutes);
app.use("/progress", progressRoutes);
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
