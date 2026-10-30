const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const bktService = require("./bkt.service");
const misconceptionService = require("./misconception.service");

/**
 * Resolves a StudentProfile from either a userId (from auth token) or a targetStudentId.
 */
const resolveStudentProfile = async ({ callingUser, targetStudentId }) => {
  if (callingUser.role === "STUDENT") {
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: callingUser.id },
    });
    if (!profile) {
      throw new ApiError(404, "Student profile not found");
    }
    // Enforce student isolation: student can only access their own profile
    if (targetStudentId && targetStudentId !== profile.id) {
      throw new ApiError(403, "Access denied: cannot access another student's learner state");
    }
    return profile;
  }

  // INSTRUCTOR or ADMIN calling
  if (targetStudentId) {
    const profile = await prisma.studentProfile.findUnique({
      where: { id: targetStudentId },
    });
    if (!profile) {
      throw new ApiError(404, "Target student profile not found");
    }
    return profile;
  }

  // If instructor/admin didn't provide targetStudentId, check if calling user has a student profile
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: callingUser.id },
  });
  if (!profile) {
    throw new ApiError(400, "targetStudentId is required for instructors/admins");
  }
  return profile;
};

/**
 * Records evidence for a learner (interaction, attempt, response time, hints).
 * Applies Bayesian Knowledge Tracing (BKT) to update mastery probability, confidence, and status.
 * Evaluates evidence using the Misconception Detection Engine.
 */
const recordEvidence = async ({ callingUser, data }) => {
  const studentProfile = await resolveStudentProfile({
    callingUser,
    targetStudentId: data.studentId,
  });
  const studentId = studentProfile.id;

  const scoreVal = typeof data.score === "number" ? data.score : data.isCorrect ? 1.0 : 0.0;
  const isCorrectBool = data.isCorrect ?? (scoreVal >= 0.7);

  // 1. Fetch existing ConceptMastery
  const existingMastery = await prisma.conceptMastery.findUnique({
    where: {
      studentId_concept: {
        studentId,
        concept: data.kc,
      },
    },
  });

  const priorMastery = existingMastery ? existingMastery.masteryScore : null;
  const attemptsCount = (existingMastery ? existingMastery.attemptsCount : 0) + 1;

  // 2. Perform Bayesian Knowledge Tracing (BKT) Update
  const bktResult = bktService.calculateBktUpdate({
    priorMastery,
    isCorrect: isCorrectBool,
    kc: data.kc,
    attemptsCount,
  });

  const recentScoresHistory = Array.isArray(existingMastery?.recentScores)
    ? [...existingMastery.recentScores]
    : [];

  const scoreEntry = {
    timestamp: new Date().toISOString(),
    score: scoreVal,
    isCorrect: isCorrectBool,
    hintsUsed: data.hintsUsed || 0,
    responseTimeMs: data.responseTimeMs || 0,
    previousMastery: priorMastery ?? bktResult.bktParams.pL0,
    newMastery: bktResult.newMastery,
    posteriorGivenObs: bktResult.posteriorGivenObs,
    misconceptionHypothesis: data.misconceptionHypothesis || null,
  };

  recentScoresHistory.push(scoreEntry);

  // 3. Upsert ConceptMastery record storing updated BKT mastery, confidence, and status
  const updatedMastery = await prisma.conceptMastery.upsert({
    where: {
      studentId_concept: {
        studentId,
        concept: data.kc,
      },
    },
    update: {
      masteryScore: bktResult.newMastery,
      confidenceLevel: bktResult.confidence,
      status: bktResult.status,
      attemptsCount: { increment: 1 },
      recentScores: recentScoresHistory,
      lastAssessedAt: new Date(),
      ...(data.courseId ? { lastCourseId: data.courseId } : {}),
    },
    create: {
      studentId,
      concept: data.kc,
      masteryScore: bktResult.newMastery,
      confidenceLevel: bktResult.confidence,
      status: bktResult.status,
      attemptsCount: 1,
      recentScores: [scoreEntry],
      lastCourseId: data.courseId || null,
      lastAssessedAt: new Date(),
    },
  });

  // 4. Log raw interaction event telemetry into LearningEvent
  const learningEvent = await prisma.learningEvent.create({
    data: {
      studentId,
      courseId: data.courseId || null,
      moduleId: data.moduleId || null,
      lessonId: data.lessonId || null,
      quizId: data.quizId || null,
      sessionId: `SESSION-${Date.now()}`,
      eventType: "QUIZ_SUBMITTED",
      eventCategory: "QUIZ",
      payload: {
        kc: data.kc,
        score: scoreVal,
        isCorrect: isCorrectBool,
        hintsUsed: data.hintsUsed || 0,
        responseTimeMs: data.responseTimeMs || 0,
        previousMastery: priorMastery ?? bktResult.bktParams.pL0,
        newMastery: bktResult.newMastery,
        misconceptionHypothesis: data.misconceptionHypothesis || null,
      },
      metadata: data.metadata || {},
    },
  });

  // 5. Evaluate & Record Misconception State using Misconception Detection Engine
  let misconception = null;
  try {
    misconception = await misconceptionService.evaluateAndDetectMisconception({
      studentId,
      kc: data.kc,
      isCorrect: isCorrectBool,
      score: scoreVal,
      hintsUsed: data.hintsUsed || 0,
      hypothesis: data.misconceptionHypothesis || null,
      recentScores: recentScoresHistory,
    });
  } catch (err) {
    console.error("Misconception detection evaluation warning:", err);
    // Non-blocking fallback
  }

  return {
    studentId,
    recordedEvidence: {
      kc: data.kc,
      score: scoreVal,
      isCorrect: isCorrectBool,
      hintsUsed: data.hintsUsed || 0,
      responseTimeMs: data.responseTimeMs || 0,
      eventId: learningEvent.id,
      timestamp: learningEvent.createdAt,
    },
    bktUpdate: {
      priorMastery: priorMastery ?? bktResult.bktParams.pL0,
      posteriorGivenObs: bktResult.posteriorGivenObs,
      newMastery: bktResult.newMastery,
      status: bktResult.status,
      confidence: bktResult.confidence,
    },
    updatedKCState: {
      kc: updatedMastery.concept,
      masteryProbability: updatedMastery.masteryScore,
      confidence: updatedMastery.confidenceLevel,
      status: updatedMastery.status,
      attemptsCount: updatedMastery.attemptsCount,
      lastAssessedAt: updatedMastery.lastAssessedAt,
    },
    recordedMisconception: misconception,
  };
};

module.exports = {
  // Exported so the recommendation controller authorizes through the SAME
  // check as every other learner-model route, rather than growing a second
  // one that could drift from it.
  resolveStudentProfile,
  recordEvidence,
};

