const toActionEntry = (action) => ({
  id: action.id,
  type: action.type,
  priority: action.priority,
  status: action.status,
  confidenceScore: action.confidenceScore,
  triggerReason: action.triggerReason,
  recommendedAt: action.recommendedAt,
  expiresAt: action.expiresAt,
  courseId: action.courseId,
  moduleId: action.moduleId,
  lessonId: action.lessonId,
  metadata: action.metadata,
  version: action.version,
  generatedAt: action.generatedAt,
});

/** GET /motivation/actions */
const toActionListResponse = (studentId, actions) => ({
  studentId,
  count: actions.length,
  actions: actions.map(toActionEntry),
});

/** GET /motivation/reminders */
const toReminderListResponse = (studentId, reminders) => ({
  studentId,
  reminders: reminders.map((r) => ({
    id: r.id,
    reminderType: r.reminderType,
    cadence: r.cadence,
    preferredHour: r.preferredHour,
    nextRunAt: r.nextRunAt,
    lastRunAt: r.lastRunAt,
    isActive: r.isActive,
  })),
});

/** GET /motivation/streak */
const toStreakResponse = (studentId, streak) => ({
  studentId,
  currentStreakDays: streak?.currentStreakDays || 0,
  longestStreakDays: streak?.longestStreakDays || 0,
  streakStatus: streak?.streakStatus || "BROKEN",
  lastActiveDate: streak?.lastActiveDate || null,
  lastBrokenAt: streak?.lastBrokenAt || null,
});

/** GET /motivation/:studentId — everything, for other agents/system integrations. */
const toFullStateResponse = (studentId, { actions, streak }) => ({
  studentId,
  actions: actions.map(toActionEntry),
  streak: toStreakResponse(studentId, streak),
});

/** POST /motivation/recalculate */
const toRecalculateResponse = (result) => ({
  studentId: result.studentId,
  generated: result.generated,
  retired: result.retired,
});

/** POST /motivation/acknowledge */
const toAcknowledgeResponse = (action) => toActionEntry(action);

/** GET /motivation/history */
const toHistoryResponse = (studentId, history, pagination) => ({
  studentId,
  history: history.map((h) => ({
    id: h.id,
    motivationActionId: h.motivationActionId,
    type: h.type,
    priority: h.priority,
    status: h.status,
    confidenceScore: h.confidenceScore,
    triggerReason: h.triggerReason,
    version: h.version,
    retiredReason: h.retiredReason,
    generatedAt: h.generatedAt,
    retiredAt: h.retiredAt,
  })),
  pagination,
});

module.exports = {
  toActionEntry,
  toActionListResponse,
  toReminderListResponse,
  toStreakResponse,
  toFullStateResponse,
  toRecalculateResponse,
  toAcknowledgeResponse,
  toHistoryResponse,
};
