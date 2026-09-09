const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

module.exports = { round2 };
