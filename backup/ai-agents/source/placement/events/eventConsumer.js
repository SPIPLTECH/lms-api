const career = require("../../career");
const studentState = require("../../student-state");
const assessment = require("../../assessment");

const placementService = require("../services/placement.service");
const { STUDENT_RECOMPUTE_DEBOUNCE_MS } = require("../constants");

/**
 * Per-student debounce — same 5s window as every other student-scoped
 * agent in this series. "Resume Updated"/"Portfolio Updated"/"New Job
 * Posted"/"New Internship Posted"/"Placement Drive Announced"/
 * "Certification Completed" have no real-time hook anywhere in this
 * codebase (nothing publishes those signals today); those are covered by
 * the daily safety-net sweep instead (schedulers/dailySweep.scheduler.js).
 */
const pendingTimers = new Map();

const scheduleRecompute = (studentId, reason) => {
  if (!studentId) return;

  const existing = pendingTimers.get(studentId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(studentId);
    placementService.generateForStudent(studentId, reason).catch((error) => {
      console.error(`[placement] failed to generate for student ${studentId} (trigger: ${reason}):`, error);
    });
  }, STUDENT_RECOMPUTE_DEBOUNCE_MS);

  timer.unref?.();
  pendingTimers.set(studentId, timer);
};

const handleCareerProfileUpdate = (payload) => scheduleRecompute(payload?.studentId, "career:profile-updated");
const handleAssessmentUpdate = (payload) => scheduleRecompute(payload?.studentId, "assessment:updated");
const handleStudentStateUpdate = (payload) => scheduleRecompute(payload?.studentId, "student-state:updated");

const start = () => {
  const unsubscribeCareer = career.subscribe(career.CAREER_EVENT_NAMES.CAREER_PROFILE_UPDATED, handleCareerProfileUpdate);
  console.log("[placement] subscribed to career:profile-updated");

  const unsubscribeAssessment = assessment.subscribe(assessment.ASSESSMENT_EVENT_NAMES.ASSESSMENT_UPDATED, handleAssessmentUpdate);
  console.log("[placement] subscribed to assessment:updated");

  const unsubscribeStudentState = studentState.subscribe(studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, handleStudentStateUpdate);
  console.log("[placement] subscribed to student-state:updated");

  return () => {
    unsubscribeCareer();
    unsubscribeAssessment();
    unsubscribeStudentState();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };
};

module.exports = { start, handleCareerProfileUpdate, handleAssessmentUpdate, handleStudentStateUpdate };
