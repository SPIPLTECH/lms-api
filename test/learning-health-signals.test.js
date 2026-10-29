const test = require("node:test");
const assert = require("node:assert");

const { assembleSignals, windowStart } = require("../src/modules/learning-health/learningHealth.signals");

// assembleSignals turns the batched rows of one course into per-learner
// signals. Pure — the DB reads around it are in fetchCourseSignals.

const NOW = new Date("2026-03-01T12:00:00.000Z");
const DAY = 86_400_000;
const daysBefore = (n) => new Date(NOW.getTime() - n * DAY);
const daysAfter = (n) => new Date(NOW.getTime() + n * DAY);

const enrollment = (studentId, overrides = {}) => ({
  studentId,
  enrolledAt: daysBefore(60),
  lastAccessedAt: null,
  progressPercent: 30,
  completed: false,
  student: { userId: `user-${studentId}` },
  ...overrides,
});

const raw = (overrides = {}) => ({
  now: NOW,
  since: windowStart(NOW),
  enrollments: [enrollment("s1")],
  contents: [{ id: "c1", type: "TEXT" }],
  assignments: [],
  lessonRows: [],
  contentRows: [],
  leases: [],
  attempts: [],
  submissions: [],
  masteries: [],
  previous: [],
  ...overrides,
});

const only = (rows) => {
  assert.strictEqual(rows.length, 1);
  return rows[0];
};

test("active dates are distinct UTC days inside the window, from every activity source", () => {
  const { signals } = only(
    assembleSignals(
      raw({
        enrollments: [enrollment("s1", { lastAccessedAt: daysBefore(3) })],
        lessonRows: [
          { studentId: "s1", visitedAt: daysBefore(1), completedAt: daysBefore(1) },
          { studentId: "s1", visitedAt: daysBefore(30), completedAt: null }, // outside window
        ],
        contentRows: [{ studentId: "s1", visitedAt: daysBefore(2), completedAt: null }],
        attempts: [{ studentId: "s1", percentage: 70, passed: true, correctCount: 7, incorrectCount: 3, submittedAt: daysBefore(1) }],
      })
    )
  );
  assert.strictEqual(signals.activeDates.size, 3); // days 1, 2, 3
  assert.ok(signals.hasAnyActivity);
  assert.strictEqual(signals.lastActivityAt.getTime(), daysBefore(1).getTime());
});

test("a learner with no activity anywhere has no last activity", () => {
  const { signals } = only(assembleSignals(raw()));
  assert.strictEqual(signals.lastActivityAt, null);
  assert.strictEqual(signals.hasAnyActivity, false);
  assert.strictEqual(signals.activeDates.size, 0);
});

test("video minutes come from playback leases, mapped by userId, capped per lease", () => {
  const start = daysBefore(1);
  const { signals } = only(
    assembleSignals(
      raw({
        contents: [{ id: "v1", type: "VIDEO" }],
        leases: [
          { userId: "user-s1", startedAt: start, stoppedAt: new Date(start.getTime() + 30 * 60_000), lastHeartbeat: start },
          { userId: "user-s1", startedAt: start, stoppedAt: null, lastHeartbeat: new Date(start.getTime() + 10 * 60_000) },
          { userId: "user-s1", startedAt: start, stoppedAt: new Date(start.getTime() + 10 * 3600_000), lastHeartbeat: start },
          { userId: "user-other", startedAt: start, stoppedAt: new Date(start.getTime() + 60 * 60_000), lastHeartbeat: start },
        ],
      })
    )
  );
  assert.strictEqual(signals.courseHasVideo, true);
  assert.strictEqual(signals.videoMinutes, 30 + 10 + 240);
});

test("deadlines: unsubmitted overdue and due-soon assignments count, submitted ones do not", () => {
  const { signals } = only(
    assembleSignals(
      raw({
        assignments: [
          { id: "a-overdue", dueDate: daysBefore(2), status: "ACTIVE" },
          { id: "a-soon", dueDate: daysAfter(1), status: "ACTIVE" },
          { id: "a-later", dueDate: daysAfter(10), status: "ACTIVE" },
          { id: "a-submitted", dueDate: daysBefore(1), status: "ACTIVE" },
          { id: "a-inactive", dueDate: daysBefore(1), status: "INACTIVE" },
          { id: "a-undated", dueDate: null, status: "ACTIVE" },
        ],
        submissions: [{ studentId: "s1", assignmentId: "a-submitted", submittedAt: daysBefore(3), evaluations: [] }],
      })
    )
  );
  assert.deepStrictEqual(signals.deadlines, { hasDeadlines: true, overdue: 1, dueSoonDaysLeft: [1] });
});

test("assignment scores come from the current published evaluation only", () => {
  const { signals } = only(
    assembleSignals(
      raw({
        assignments: [{ id: "a1", dueDate: null, status: "ACTIVE" }, { id: "a2", dueDate: null, status: "ACTIVE" }],
        submissions: [
          { studentId: "s1", assignmentId: "a1", submittedAt: daysBefore(1), evaluations: [{ marksAwarded: 7, maxMarks: 10 }] },
          { studentId: "s1", assignmentId: "a2", submittedAt: daysBefore(1), evaluations: [] },
        ],
      })
    )
  );
  assert.deepStrictEqual(signals.assignmentScores, [70]);
  assert.strictEqual(signals.deadlines.hasDeadlines, false);
});

test("each learner gets only their own rows, plus their previous risk level", () => {
  const rows = assembleSignals(
    raw({
      enrollments: [enrollment("s1"), enrollment("s2")],
      masteries: [{ studentId: "s1", masteryScore: 0.9 }, { studentId: "s2", masteryScore: 0.2 }],
      attempts: [{ studentId: "s2", percentage: 40, passed: false, correctCount: 4, incorrectCount: 6, submittedAt: daysBefore(1) }],
      previous: [{ studentId: "s2", riskLevel: "HIGH" }],
    })
  );
  const byId = Object.fromEntries(rows.map((r) => [r.studentId, r]));
  assert.deepStrictEqual(byId.s1.signals.masteryScores, [0.9]);
  assert.strictEqual(byId.s1.signals.quizAttempts.length, 0);
  assert.strictEqual(byId.s1.previousRiskLevel, null);
  assert.strictEqual(byId.s2.signals.quizAttempts.length, 1);
  assert.strictEqual(byId.s2.previousRiskLevel, "HIGH");
});
