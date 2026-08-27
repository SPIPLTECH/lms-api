const REASON_BY_MODE = {
  SMART_REVISION: (concept) =>
    `You demonstrated strong understanding of "${concept}" in your entry assessment, so this lesson has been condensed into a focused revision.`,
  STANDARD_LEARNING: (concept) =>
    `Your entry assessment showed solid, still-developing understanding of "${concept}" — the standard lesson pace applies.`,
  DEEP_LEARNING: (concept) =>
    `Your entry assessment flagged "${concept}" as an area to strengthen, so this lesson has been expanded with extra examples and practice.`,
};

const buildReason = (personalization) => (REASON_BY_MODE[personalization.recommendedMode] || (() => null))(personalization.concept);

/**
 * Applies the AI Student Entry Phase's per-concept (per-module)
 * personalization — computed once in
 * student-state/services/domain/courseStatePersonalizer.js and consumed
 * here as-is — down to each lesson in the sequence. This never re-derives
 * the mode/ratio itself, only redistributes the module-level
 * recommendedMinutes:originalMinutes ratio across that module's lessons, so
 * there is exactly one place in the codebase that decides *what* mode a
 * concept gets. Modules with no entry-assessment data (course has none yet,
 * or this lesson's module wasn't covered) are left completely unchanged —
 * absence of personalization, not a fabricated default.
 *
 * @param {import("../../types/learningPath.types").SequenceItem[]} sequence
 * @param {{conceptMastery: {moduleId: string|null, concept: string, recommendedMode: string, originalMinutes: number, recommendedMinutes: number}[]}|null} courseState
 */
const personalizeSequence = (sequence, courseState) => {
  if (!courseState || !Array.isArray(courseState.conceptMastery) || courseState.conceptMastery.length === 0) {
    return sequence;
  }

  const byModuleId = new Map(courseState.conceptMastery.filter((entry) => entry.moduleId).map((entry) => [entry.moduleId, entry]));

  return sequence.map((item) => {
    const personalization = byModuleId.get(item.moduleId);
    if (!personalization) return item;

    const ratio = personalization.originalMinutes > 0 ? personalization.recommendedMinutes / personalization.originalMinutes : 1;

    return {
      ...item,
      recommendedMode: personalization.recommendedMode,
      recommendedMinutes: Math.max(1, Math.round(item.estimatedMinutes * ratio)),
      aiPersonalizationReason: buildReason(personalization),
    };
  });
};

module.exports = { personalizeSequence };
