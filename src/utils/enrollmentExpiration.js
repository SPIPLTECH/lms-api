/**
 * Enrollment expiration logic and calendar-month arithmetic.
 *
 * Expiration rule:
 *   expiresAt = enrolledAt + accessDurationDays + 1 calendar month
 *
 * Calendar-month addition preserves the day of the month when possible,
 * and clamps to the last day of the target month when the day does not exist
 * (e.g. Jan 31 + 1 month -> Feb 28 in non-leap years, Feb 29 in leap years;
 *       March 31 + 1 month -> April 30; Aug 31 + 1 month -> Sep 30).
 *
 * Timestamps are stored and compared consistently in UTC.
 */

/**
 * Adds `months` calendar months to a UTC Date object, correctly handling
 * month-end clamping and leap years.
 *
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function addCalendarMonths(date, months = 1) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new TypeError("Invalid date provided to addCalendarMonths");
  }

  const d = new Date(date.getTime());
  const originalYear = d.getUTCFullYear();
  const originalMonth = d.getUTCMonth();
  const originalDay = d.getUTCDate();

  const totalMonths = originalYear * 12 + originalMonth + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  // Day 0 of (targetMonth + 1) in targetYear gives the last calendar day of targetMonth
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(originalDay, daysInTargetMonth);

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds()
  ));
}

/**
 * Calculates the exact UTC expiration timestamp for an enrollment.
 *
 * expiresAt = enrolledAt + accessDurationDays (in days) + 1 calendar month
 *
 * If accessDurationDays is not set, 0, or negative, the course is unlimited/self-paced
 * and returns null (never expires).
 *
 * @param {Date|string|number} enrolledAt
 * @param {number|null|undefined} accessDurationDays
 * @returns {Date|null}
 */
function calculateEnrollmentExpiration(enrolledAt, accessDurationDays) {
  if (!accessDurationDays || typeof accessDurationDays !== "number" || accessDurationDays <= 0) {
    return null;
  }

  const startDate = enrolledAt instanceof Date ? new Date(enrolledAt.getTime()) : new Date(enrolledAt);
  if (isNaN(startDate.getTime())) {
    throw new TypeError("Invalid enrolledAt date provided to calculateEnrollmentExpiration");
  }

  // 1. Add access duration in days (24 hours per day in UTC milliseconds)
  const durationMs = Math.round(accessDurationDays) * 24 * 60 * 60 * 1000;
  const dateAfterDuration = new Date(startDate.getTime() + durationMs);

  // 2. Add 1 additional calendar month
  return addCalendarMonths(dateAfterDuration, 1);
}

/**
 * Checks whether an enrollment is currently expired.
 *
 * @param {{ expiresAt?: Date|string|null }} enrollment
 * @param {Date} [now=new Date()]
 * @returns {boolean}
 */
function isEnrollmentExpired(enrollment, now = new Date()) {
  if (!enrollment || !enrollment.expiresAt) return false;
  const expiry = new Date(enrollment.expiresAt);
  if (isNaN(expiry.getTime())) return false;
  return now.getTime() >= expiry.getTime();
}

/**
 * Calculates the remaining access days before expiration.
 * Returns null if enrollment has no expiration date (unlimited).
 * Returns 0 if already expired.
 *
 * @param {Date|string|null} expiresAt
 * @param {Date} [now=new Date()]
 * @returns {number|null}
 */
function getRemainingAccessDays(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime())) return null;
  const diffMs = expiry.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

module.exports = {
  addCalendarMonths,
  calculateEnrollmentExpiration,
  isEnrollmentExpired,
  getRemainingAccessDays,
};
