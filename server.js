require("dotenv").config();

const http = require("http");

const app = require("./src/app");
const {
    initializeSocket,
} = require("./src/socket");


const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.io
initializeSocket(server);

// Initialize Message Cleanup Cron Job
const { initMessageCleanupCron } = require("./src/modules/messages/messageCleanup.service");
initMessageCleanupCron();

// Start the Student State Agent: subscribes to observed events and
// schedules its inactivity-risk reconciliation job.
const studentState = require("./src/modules/student-state");
studentState.bootstrap();

// Start the Assessment Agent: subscribes to evaluative events and Student
// State updates, and schedules its reassessment-due sweep.
const assessment = require("./src/modules/assessment");
assessment.bootstrap();

// Start the Recommendation Agent: subscribes to Observation/Student State/
// Assessment update signals, and schedules its deadline-scan and daily
// digest/expiry-sweep jobs.
const recommendation = require("./src/modules/recommendation");
recommendation.bootstrap();

// Start the Motivation Agent: subscribes to Student State/Recommendation
// update signals, and schedules its reminder-dispatch, deadline-scan, and
// daily engagement-sweep jobs.
const motivation = require("./src/modules/motivation");
motivation.bootstrap();

// Start the Teacher Insight Agent: subscribes to Student State/Assessment/
// Recommendation/Motivation update signals plus quiz/assignment
// completions, and schedules its daily class sweep, weekly summary, and
// monthly report jobs.
const teacherInsights = require("./src/modules/teacher-insights");
teacherInsights.bootstrap();

// Start the Analytics Agent: subscribes to Student State/Assessment/
// Recommendation/Motivation update signals for near-real-time STUDENT-scope
// recompute, Teacher Insight updates for debounced COURSE/INSTRUCTOR-scope
// recompute, and schedules its hourly course/instructor sweep, daily
// platform sweep + snapshot, and weekly/monthly/quarterly/annual report
// jobs.
const analytics = require("./src/modules/analytics");
analytics.bootstrap();

// Start the Career Guidance Agent: seeds the IndustryRole skill taxonomy,
// subscribes to Student State/Assessment update signals for debounced
// per-student recompute, and schedules its daily safety-net sweep and
// monthly industry-taxonomy refresh.
const career = require("./src/modules/career");
career.bootstrap();

// Start the Learning Path Agent: subscribes to Student State's update
// signal for debounced per-student recompute, and schedules its daily
// safety-net sweep. Six agents built earlier in this series already wired
// a defensive require against this module — none of them need changes now
// that it exists.
const learningPath = require("./src/modules/learning-path");
learningPath.bootstrap();

// Start the Placement Agent: seeds the starter Company/JobOpportunity/
// InternshipOpportunity/PlacementDrive catalog, subscribes to Career
// Guidance/Assessment/Student State update signals for debounced
// per-student recompute, and schedules its daily safety-net sweep and
// catalog refresh.
const placement = require("./src/modules/placement");
placement.bootstrap();

// Admin Intelligence Agent — institution-wide, one layer above Analytics.
// Bootstrapped last since it subscribes to Analytics'/Teacher Insight's/
// Student State's own update events.
const adminIntelligence = require("./src/modules/admin-intelligence");
adminIntelligence.bootstrap();

// AI Mentor Agent — the final agent, purely a consumer of the other 11's
// public surfaces. No subscriptions/schedulers of its own (every turn is
// triggered directly by an incoming chat request), just seeds its own
// role-specific PromptTemplate rows.
const mentor = require("./src/modules/mentor");
mentor.bootstrap();

server.listen(PORT, () => {
    console.log(
        `🚀 Server running on port ${PORT}`
    );
});