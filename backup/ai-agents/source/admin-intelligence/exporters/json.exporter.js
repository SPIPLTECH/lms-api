/** Passthrough — the report is already a plain, DTO-shaped object by the time it reaches here. */
const exportJson = (report) => JSON.stringify(report, null, 2);

module.exports = { exportJson };
