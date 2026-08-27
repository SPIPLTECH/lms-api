const analytics = require("../../analytics");
const teacherInsights = require("../../teacher-insights");
const studentState = require("../../student-state");

const adminIntelligenceService = require("../services/adminIntelligence.service");
const { RECOMPUTE_DEBOUNCE_MS } = require("../constants");

/**
 * One global debounce, not per-scope — unlike every student/course-scoped
 * agent in this series, generateInsights() always recomputes the whole
 * institution in one pass, so there's exactly one pending timer at a time.
 * 60s (not the 5s student-scope window) — this is heavy institution-wide
 * aggregation, same policy Analytics itself uses for its own PLATFORM scope.
 */
let pendingTimer = null;

const scheduleRecompute = (reason) => {
  if (pendingTimer) clearTimeout(pendingTimer);

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    adminIntelligenceService.generateInsights(reason).catch((error) => {
      console.error(`[admin-intelligence] failed to generate insights (trigger: ${reason}):`, error);
    });
  }, RECOMPUTE_DEBOUNCE_MS);

  pendingTimer.unref?.();
};

const handleAnalyticsUpdate = () => scheduleRecompute("analytics:updated");
const handleTeacherInsightUpdate = () => scheduleRecompute("teacher-insight:updated");
const handleStudentStateUpdate = () => scheduleRecompute("student-state:updated");

/**
 * Real subscriptions to 3 of the spec's named triggers (Analytics Updated,
 * Teacher Insight Updated, Student Risk Changes — the closest honest signal
 * for the latter is student-state:updated, since no risk-specific event
 * exists anywhere in this codebase). The remaining named triggers
 * (Enrollment Changes, Semester Starts/Ends, Revenue Changes, Infrastructure
 * Changes, System Events) have no real event to subscribe to anywhere in
 * this codebase — see schedulers/dailySweep.scheduler.js, their only
 * honest trigger.
 */
const start = () => {
  const unsubscribeAnalytics = analytics.subscribe(analytics.ANALYTICS_EVENT_NAMES.ANALYTICS_UPDATED, handleAnalyticsUpdate);
  console.log("[admin-intelligence] subscribed to analytics:updated");

  const unsubscribeTeacherInsight = teacherInsights.subscribe(
    teacherInsights.TEACHER_INSIGHT_EVENT_NAMES.TEACHER_INSIGHT_UPDATED,
    handleTeacherInsightUpdate
  );
  console.log("[admin-intelligence] subscribed to teacher-insight:updated");

  const unsubscribeStudentState = studentState.subscribe(studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, handleStudentStateUpdate);
  console.log("[admin-intelligence] subscribed to student-state:updated");

  return () => {
    unsubscribeAnalytics();
    unsubscribeTeacherInsight();
    unsubscribeStudentState();
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;
  };
};

module.exports = { start, handleAnalyticsUpdate, handleTeacherInsightUpdate, handleStudentStateUpdate };
