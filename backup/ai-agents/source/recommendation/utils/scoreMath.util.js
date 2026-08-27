const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Linear urgency ramp: 0 at `farHours` or beyond, 100 at/inside `nearHours`.
 * Used for deadline-proximity and inactivity-style urgency curves.
 *
 * @param {number} hoursRemaining
 * @param {number} nearHours - hoursRemaining at/below this -> urgency 100
 * @param {number} farHours - hoursRemaining at/above this -> urgency 0
 */
const urgencyFromHoursRemaining = (hoursRemaining, nearHours, farHours) => {
  if (hoursRemaining <= nearHours) return 100;
  if (hoursRemaining >= farHours) return 0;
  const span = farHours - nearHours;
  return clamp(round2(100 - ((hoursRemaining - nearHours) / span) * 100));
};

module.exports = { clamp, round2, urgencyFromHoursRemaining };
