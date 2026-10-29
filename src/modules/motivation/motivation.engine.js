const config = require("./motivation.config");

/**
 * Motivation engine — pure. Streak evaluation, nudge detectors and the nudge
 * lifecycle (what to create, refresh or retire). No database, no clock.
 *
 * Wording is the student's: encouraging and specific, never a risk label.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);
const shiftDays = (key, days) => dateKey(new Date(Date.parse(`${key}T00:00:00.000Z`) + days * DAY_MS));

/** ISO-ish week key (UTC Monday) — "remind at most once a week". */
const weekKey = (now) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  return dateKey(new Date(d.getTime() - mondayOffset * DAY_MS));
};

/** Consecutive days ending at `endKey` that are all in `days`. */
const runEndingAt = (days, endKey) => {
  let count = 0;
  let key = endKey;
  while (days.has(key)) {
    count += 1;
    key = shiftDays(key, -1);
  }
  return count;
};

const longestRun = (days) => {
  let longest = 0;
  for (const key of days) {
    if (days.has(shiftDays(key, -1))) continue; // not the start of a run
    let length = 0;
    let cursor = key;
    while (days.has(cursor)) {
      length += 1;
      cursor = shiftDays(cursor, 1);
    }
    longest = Math.max(longest, length);
  }
  return longest;
};

/**
 * The learner's streak across all courses (original streakEvaluator, read
 * from activity dates instead of an event stream).
 *
 * ACTIVE: active today. AT_RISK: active yesterday, not yet today — the
 * streak still counts. BROKEN: neither.
 *
 * Milestones reset with the streak, so a rebuilt streak is celebrated again;
 * the milestone nudge's key carries the streak's start date for that reason.
 *
 * @param {{activeDays: Set<string>, now: Date, existing?: {longestDays?: number, celebratedMilestones?: number[], currentDays?: number}|null}} input
 */
function computeStreak({ activeDays, now, existing = null }) {
  const today = dateKey(now);
  const yesterday = shiftDays(today, -1);

  let currentDays = 0;
  let status = "BROKEN";
  let lastActiveDate = null;

  if (activeDays.has(today)) {
    currentDays = runEndingAt(activeDays, today);
    status = "ACTIVE";
    lastActiveDate = today;
  } else if (activeDays.has(yesterday)) {
    currentDays = runEndingAt(activeDays, yesterday);
    status = "AT_RISK";
    lastActiveDate = yesterday;
  } else {
    const latest = [...activeDays].sort().pop();
    lastActiveDate = latest ?? null;
  }

  const startedOn = currentDays > 0 ? shiftDays(lastActiveDate, -(currentDays - 1)) : null;
  const previouslyCelebrated = status === "BROKEN" ? [] : existing?.celebratedMilestones ?? [];
  const newlyCrossed = config.STREAK_MILESTONES.filter((m) => currentDays >= m && !previouslyCelebrated.includes(m));

  return {
    currentDays,
    longestDays: Math.max(existing?.longestDays ?? 0, longestRun(activeDays), currentDays),
    status,
    lastActiveDate,
    startedOn,
    celebratedMilestones: [...previouslyCelebrated, ...newlyCrossed],
    newlyCrossed,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const dueLabel = (dueDate, now) => {
  const hours = (new Date(dueDate).getTime() - now.getTime()) / HOUR_MS;
  if (hours < 1) return "due within the hour";
  if (hours < 24) return `due in ${Math.round(hours)}h`;
  return "due tomorrow";
};

const candidate = (type, dedupeKey, priority, fields) => ({
  type,
  dedupeKey,
  priority,
  sticky: config.STICKY_TYPES.includes(type),
  expiresInHours: config.EXPIRY_HOURS[type],
  courseId: null,
  ctaHref: null,
  ...fields,
});

/**
 * Every nudge the current situation calls for. Each detector is one block;
 * `dedupeKey` decides when the "same" nudge may be shown again (per day, per
 * week, per inactivity episode, or never for one-off milestones).
 *
 * @param {{
 *   now: Date,
 *   streak: ReturnType<typeof computeStreak>,
 *   courses: {courseId: string, title: string, progressPercent: number, completed: boolean,
 *             health: {inactivityDays: number, improvementTrend: string} | null}[],
 *   deadlines: {id: string, title: string, dueDate: Date}[],
 *   decayedConcepts: string[],
 * }} context
 */
function detectNudges({ now, streak, courses, deadlines, decayedConcepts }) {
  const nudges = [];
  const today = dateKey(now);
  const week = weekKey(now);

  // Streak at risk — learned yesterday, not yet today.
  if (streak.status === "AT_RISK" && streak.currentDays >= config.STREAK_AT_RISK_MIN_DAYS) {
    nudges.push(
      candidate("STREAK_AT_RISK", today, "MEDIUM", {
        title: `Keep your ${streak.currentDays}-day streak going`,
        message: "You learned yesterday — a few minutes today keeps your streak alive.",
        ctaHref: "/student/my-courses",
      })
    );
  }

  // Streak milestones.
  for (const milestone of streak.newlyCrossed) {
    nudges.push(
      candidate("STREAK_MILESTONE", `${milestone}:${streak.startedOn}`, "LOW", {
        title: `${milestone}-day learning streak!`,
        message: `You've learned ${milestone} days in a row. That consistency is what makes it stick.`,
      })
    );
  }

  for (const course of courses) {
    if (course.completed) {
      // Completion is celebrated once, below; nothing else to nudge about.
    } else if (course.health && course.health.inactivityDays >= config.COMEBACK_MEDIUM_DAYS) {
      const days = course.health.inactivityDays;
      const lastActive = shiftDays(today, -days);
      nudges.push(
        candidate("COMEBACK", `${course.courseId}:${lastActive}`, days >= config.COMEBACK_HIGH_DAYS ? "HIGH" : "MEDIUM", {
          courseId: course.courseId,
          title: `Pick up ${course.title} where you left off`,
          message: `It's been ${plural(days, "day")} — one short lesson is enough to get back into it.`,
          ctaHref: `/student/learn/${course.courseId}`,
        })
      );
    }

    // Progress milestones — once each, ever.
    const reached = config.PROGRESS_MILESTONES.filter((m) => course.progressPercent >= m).pop();
    if (reached) {
      nudges.push(
        candidate("PROGRESS_MILESTONE", `${course.courseId}:${reached}`, "LOW", {
          courseId: course.courseId,
          title: reached === 100 ? `You finished ${course.title}!` : `${reached}% of ${course.title} done`,
          message:
            reached === 100
              ? "Every lesson complete — well done."
              : "Nice progress. Keep the momentum going with the next lesson.",
          ctaHref: reached === 100 ? null : `/student/learn/${course.courseId}`,
        })
      );
    }

    if (!course.completed && course.health?.improvementTrend === "IMPROVING") {
      nudges.push(
        candidate("ENCOURAGEMENT", `${course.courseId}:${week}`, "LOW", {
          courseId: course.courseId,
          title: `Your quiz scores are climbing in ${course.title}`,
          message: "Keep going — your recent results show real progress.",
        })
      );
    }
  }

  // Deadlines: due soon, or overdue and still worth submitting.
  for (const assignment of deadlines) {
    const hoursLeft = (new Date(assignment.dueDate).getTime() - now.getTime()) / HOUR_MS;
    if (hoursLeft < 0) {
      nudges.push(
        candidate("DEADLINE", `${assignment.id}:overdue`, "HIGH", {
          title: `${assignment.title} is past its due date`,
          message: "It's still worth submitting — open the assignment for details.",
          ctaHref: "/student/assignments",
        })
      );
    } else if (hoursLeft <= config.DEADLINE_LOOKAHEAD_HOURS) {
      nudges.push(
        candidate("DEADLINE", `${assignment.id}:soon`, hoursLeft <= config.DEADLINE_URGENT_HOURS ? "HIGH" : "MEDIUM", {
          title: `${assignment.title} is ${dueLabel(assignment.dueDate, now)}`,
          message: "Submit it in time to stay on track.",
          ctaHref: "/student/assignments",
        })
      );
    }
  }

  // Revision — concepts learner-model reports as fading.
  for (const concept of decayedConcepts.slice(0, config.MAX_REVISION_NUDGES)) {
    nudges.push(
      candidate("REVISION", `${concept.toLowerCase()}:${week}`, "MEDIUM", {
        title: `Time to revisit ${concept}`,
        message: "It's been a while since you practised this — a quick review will help it stick.",
      })
    );
  }

  return nudges;
}

const keyOf = (row) => `${row.type}|${row.dedupeKey}`;

/**
 * The nudge lifecycle. Given every stored row for the learner and the fresh
 * candidates, decide what to write:
 *
 *  - new candidate -> create (ACTIVE, expiresAt = now + its expiry)
 *  - candidate already ACTIVE -> refresh wording/priority (expiry unchanged)
 *  - candidate already DISMISSED or EXPIRED -> leave it: never shown twice
 *  - ACTIVE row past its expiry, or (non-sticky) no longer produced -> EXPIRED
 *
 * @returns {{creates: object[], updates: {id: string, data: object}[], expireIds: string[]}}
 */
function reconcileNudges({ existing, candidates, now }) {
  const byKey = new Map(existing.map((row) => [keyOf(row), row]));
  const produced = new Set();
  const creates = [];
  const updates = [];

  for (const c of candidates) {
    const key = keyOf(c);
    if (produced.has(key)) continue;
    produced.add(key);

    const row = byKey.get(key);
    const fields = { title: c.title, message: c.message, priority: c.priority, ctaHref: c.ctaHref, courseId: c.courseId };
    if (!row) {
      creates.push({
        type: c.type,
        dedupeKey: c.dedupeKey,
        ...fields,
        status: "ACTIVE",
        expiresAt: new Date(now.getTime() + c.expiresInHours * HOUR_MS),
      });
    } else if (row.status === "ACTIVE" && !(row.expiresAt && new Date(row.expiresAt) <= now)) {
      const changed = Object.entries(fields).some(([k, v]) => (row[k] ?? null) !== (v ?? null));
      if (changed) updates.push({ id: row.id, data: fields });
    }
  }

  const expireIds = existing
    .filter((row) => row.status === "ACTIVE")
    .filter(
      (row) =>
        (row.expiresAt && new Date(row.expiresAt) <= now) ||
        (!config.STICKY_TYPES.includes(row.type) && !produced.has(keyOf(row)))
    )
    .map((row) => row.id);

  return { creates, updates, expireIds };
}

/** What the student sees: active, unexpired, highest priority first, capped. */
function visibleNudges(rows, now) {
  return rows
    .filter((row) => row.status === "ACTIVE" && !(row.expiresAt && new Date(row.expiresAt) <= now))
    .sort(
      (a, b) =>
        config.PRIORITY_ORDER[a.priority] - config.PRIORITY_ORDER[b.priority] ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, config.MAX_ACTIVE_SHOWN);
}

module.exports = { computeStreak, detectNudges, reconcileNudges, visibleNudges, dateKey, weekKey };
