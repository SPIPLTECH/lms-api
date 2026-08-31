const prisma = require("../../config/database");
const { MISCONCEPTION_CONFIG } = require("./misconception.config");

/**
 * Evaluates evidence and deterministically updates misconception state in KnowledgeGap.
 *
 * @param {Object} params
 * @param {string} params.studentId - Target student ID
 * @param {string} params.kc - Knowledge Component identifier
 * @param {boolean} params.isCorrect - Interaction outcome
 * @param {number} params.score - Raw score [0, 1]
 * @param {number} [params.hintsUsed=0] - Hints used
 * @param {string} [params.hypothesis] - Optional explicit misconception hypothesis string
 * @param {Array} [params.recentScores=[]] - Recent evidence history array for this KC
 * @returns {Promise<Object|null>} Updated KnowledgeGap record or null
 */
const evaluateAndDetectMisconception = async ({
  studentId,
  kc,
  isCorrect,
  score,
  hintsUsed = 0,
  hypothesis,
  recentScores = [],
}) => {
  // 1. Resolve target hypothesis
  let targetHypothesis =
    hypothesis ||
    recentScores.find((s) => s.misconceptionHypothesis)?.misconceptionHypothesis ||
    null;

  let existingGap = null;

  if (targetHypothesis) {
    // 2. Fetch existing KnowledgeGap for this student and target concept
    existingGap = await prisma.knowledgeGap.findFirst({
      where: {
        studentId,
        concept: targetHypothesis,
      },
    });
  } else if (kc) {
    // Fallback: If no explicit hypothesis is supplied (e.g. on a correct remediation answer),
    // check for an active OPEN KnowledgeGap for this student and KC.
    existingGap = await prisma.knowledgeGap.findFirst({
      where: {
        studentId,
        status: "OPEN",
        OR: [
          { concept: kc },
          { kc: kc },
        ],
      },
      orderBy: { severity: "desc" },
    });
    if (existingGap) {
      targetHypothesis = existingGap.concept;
    }
  }

  // If no misconception hypothesis is provided, present in recent context, or active in KnowledgeGap, return null
  if (!targetHypothesis) {
    return null;
  }

  const priorSeverity = existingGap ? existingGap.severity : 0.0;
  const priorStatus = existingGap ? existingGap.status : null;

  let newProbability = priorSeverity;

  // 3. Compute Evidence Weight Adjustment
  if (!isCorrect || score < 0.7) {
    // Incorrect / Struggling Attempt
    let delta = MISCONCEPTION_CONFIG.INITIAL_INCORRECT_WEIGHT;

    // High hint usage penalty (hintsUsed >= 2)
    if (hintsUsed >= 2) {
      delta += MISCONCEPTION_CONFIG.HIGH_HINT_PENALTY;
    }

    // Count consecutive errors prior to current attempt
    let consecutiveErrors = 0;
    for (let i = recentScores.length - 2; i >= 0; i--) {
      if (!recentScores[i].isCorrect) {
        consecutiveErrors++;
      } else {
        break;
      }
    }
    if (consecutiveErrors > 0) {
      delta += consecutiveErrors * MISCONCEPTION_CONFIG.CONSECUTIVE_ERROR_BONUS;
    }

    // Bonus for repeated explicit hypothesis alignment ONLY if gap is currently OPEN
    if (hypothesis && existingGap && priorStatus === "OPEN") {
      delta += MISCONCEPTION_CONFIG.HYPOTHESIS_ALIGNMENT_BONUS;
    }

    newProbability = Math.min(MISCONCEPTION_CONFIG.MAX_PROBABILITY, priorSeverity + delta);
  } else {
    // Correct / Recovery Attempt
    let decay = MISCONCEPTION_CONFIG.RECOVERY_DECAY;

    // Clean success bonus (score >= 0.85 & 0 hints)
    if (score >= 0.85 && hintsUsed === 0) {
      decay += MISCONCEPTION_CONFIG.CLEAN_SUCCESS_BONUS;
    }

    newProbability = Math.max(MISCONCEPTION_CONFIG.MIN_PROBABILITY, priorSeverity - decay);
  }

  newProbability = Number(newProbability.toFixed(4));

  // 4. Status Transition & DB Update Logic
  const newStatus = newProbability >= MISCONCEPTION_CONFIG.OPEN_THRESHOLD ? "OPEN" : "CLOSED";

  if (existingGap) {
    const isTransitionToClosed = priorStatus === "OPEN" && newStatus === "CLOSED";
    const closedAtDate = isTransitionToClosed ? new Date() : (newStatus === "CLOSED" ? existingGap.closedAt : null);

    return prisma.knowledgeGap.update({
      where: { id: existingGap.id },
      data: {
        severity: newProbability,
        status: newStatus,
        closedAt: closedAtDate,
      },
    });
  } else {
    return prisma.knowledgeGap.create({
      data: {
        studentId,
        concept: targetHypothesis,
        severity: newProbability,
        status: newStatus,
        detectedAt: new Date(),
        closedAt: newStatus === "CLOSED" ? new Date() : null,
      },
    });
  }
};

module.exports = {
  evaluateAndDetectMisconception,
};
