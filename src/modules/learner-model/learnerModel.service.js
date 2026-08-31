const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const bktService = require("./bkt.service");
const { getBktParamsForKc } = require("./bkt.config");
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
 * Retrieves the full evidence-based Learner Model state for a student.
 */
const getLearnerState = async ({ callingUser, targetStudentId }) => {
  const studentProfile = await resolveStudentProfile({ callingUser, targetStudentId });
  const studentId = studentProfile.id;

  // 1. Learning Context
  const currentContext = await prisma.studentState.findFirst({
    where: { studentId },
    orderBy: { updatedAt: "desc" },
  });

  // 2. Knowledge State (Knowledge Components / ConceptMastery)
  const conceptMasteries = await prisma.conceptMastery.findMany({
    where: { studentId },
    orderBy: { updatedAt: "desc" },
  });

  // 3. Misconception State (KnowledgeGap)
  const knowledgeGaps = await prisma.knowledgeGap.findMany({
    where: { studentId },
    orderBy: { detectedAt: "desc" },
  });

  // 4. Behavior State (LearningEvents history)
  const recentEvents = await prisma.learningEvent.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const totalEventsCount = await prisma.learningEvent.count({
    where: { studentId },
  });

  return {
    studentId,
    userId: studentProfile.userId,
    learningContext: {
      currentCourseId: currentContext?.courseId || null,
      currentModuleId: currentContext?.moduleId || null,
      currentLessonId: currentContext?.lessonId || null,
      currentContentId: currentContext?.contentId || null,
      learningGoals: studentProfile.learningGoals || null,
      focusTopics: studentProfile.focusTopics || null,
      preferredLearningStyle: studentProfile.preferredLearningStyle || null,
    },
    knowledgeState: conceptMasteries.map((cm) => ({
      id: cm.id,
      kc: cm.concept,
      masteryProbability: cm.masteryScore,
      confidence: cm.confidenceLevel,
      status: cm.status,
      attemptsCount: cm.attemptsCount,
      recentScores: Array.isArray(cm.recentScores) ? cm.recentScores : [],
      trend: cm.trend,
      lastCourseId: cm.lastCourseId,
      lastAssessedAt: cm.lastAssessedAt,
      updatedAt: cm.updatedAt,
    })),
    misconceptionState: knowledgeGaps.map((kg) => ({
      id: kg.id,
      hypothesis: kg.concept,
      probability: kg.severity,
      status: kg.status,
      detectedAt: kg.detectedAt,
      closedAt: kg.closedAt,
    })),
    behaviorState: {
      totalEventsCount,
      recentActivityAt: recentEvents[0]?.createdAt || null,
      recentEvents: recentEvents.map((ev) => ({
        id: ev.id,
        eventType: ev.eventType,
        eventCategory: ev.eventCategory,
        courseId: ev.courseId,
        lessonId: ev.lessonId,
        quizId: ev.quizId,
        payload: ev.payload,
        createdAt: ev.createdAt,
      })),
    },
  };
};

/**
 * Initializes or provisions initial Knowledge Components for a learner.
 * Uses default initial BKT parameters.
 */
const initializeLearnerState = async ({ callingUser, data }) => {
  const studentProfile = await resolveStudentProfile({
    callingUser,
    targetStudentId: data.studentId,
  });
  const studentId = studentProfile.id;

  const initializedKcs = [];
  for (const item of data.kcs) {
    const bktDefaults = getBktParamsForKc(item.kc);
    const initialMastery = typeof item.masteryProbability === "number" ? item.masteryProbability : bktDefaults.pL0;
    const initialConfidence = typeof item.confidence === "number" ? item.confidence : 0.1;

    const mastery = await prisma.conceptMastery.upsert({
      where: {
        studentId_concept: {
          studentId,
          concept: item.kc,
        },
      },
      update: {
        ...(typeof item.masteryProbability === "number" ? { masteryScore: item.masteryProbability } : {}),
        ...(typeof item.confidence === "number" ? { confidenceLevel: item.confidence } : {}),
        ...(data.courseId ? { lastCourseId: data.courseId } : {}),
      },
      create: {
        studentId,
        concept: item.kc,
        masteryScore: initialMastery,
        confidenceLevel: initialConfidence,
        status: "UNASSESSED",
        attemptsCount: 0,
        recentScores: [],
        lastCourseId: data.courseId || null,
      },
    });
    initializedKcs.push(mastery);
  }

  if (data.courseId) {
    await prisma.studentState.upsert({
      where: {
        studentId_courseId: {
          studentId,
          courseId: data.courseId,
        },
      },
      update: { updatedAt: new Date() },
      create: { studentId, courseId: data.courseId },
    });
  }

  return {
    studentId,
    initializedKcs: initializedKcs.map((cm) => ({
      kc: cm.concept,
      masteryProbability: cm.masteryScore,
      confidence: cm.confidenceLevel,
      status: cm.status,
    })),
  };
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

/**
 * Internal helper to record/upsert a misconception in KnowledgeGap.
 */
const recordMisconceptionStateInternal = async ({
  studentId,
  hypothesis,
  relatedKC,
  probability,
  status = "OPEN",
}) => {
  const existingGap = await prisma.knowledgeGap.findFirst({
    where: {
      studentId,
      concept: hypothesis,
    },
  });

  if (existingGap) {
    return prisma.knowledgeGap.update({
      where: { id: existingGap.id },
      data: {
        severity: probability,
        status,
        ...(status === "RESOLVED" || status === "CLOSED" ? { closedAt: new Date() } : {}),
      },
    });
  }

  return prisma.knowledgeGap.create({
    data: {
      studentId,
      concept: hypothesis,
      severity: probability,
      status,
      detectedAt: new Date(),
    },
  });
};

/**
 * Public method to record or update misconception state.
 */
const recordMisconceptionState = async ({ callingUser, data }) => {
  const studentProfile = await resolveStudentProfile({
    callingUser,
    targetStudentId: data.studentId,
  });
  return recordMisconceptionStateInternal({
    studentId: studentProfile.id,
    hypothesis: data.hypothesis,
    relatedKC: data.relatedKC,
    probability: data.probability,
    status: data.status,
  });
};

/**
 * Evaluates current learner state for a given KC and returns the adaptive pedagogical decision.
 */
const getPedagogicalDecision = async ({ callingUser, data }) => {
  const studentProfile = await resolveStudentProfile({
    callingUser,
    targetStudentId: data?.studentId,
  });
  const studentId = studentProfile.id;
  const kc = data?.kc;

  if (!kc || typeof kc !== "string" || !kc.trim()) {
    throw new ApiError(400, "Knowledge Component (kc) is required");
  }

  const cleanKc = kc.trim();

  // Fetch concept mastery for this KC for the target student
  const kcStateRecord = await prisma.conceptMastery.findFirst({
    where: { studentId, concept: cleanKc },
  });

  // Validate that the requested KC exists in the learner model state / system concept masteries
  const kcExistsInSystem =
    kcStateRecord ||
    (await prisma.conceptMastery.findFirst({
      where: { concept: cleanKc },
    }));

  if (!kcExistsInSystem) {
    throw new ApiError(404, "Knowledge component not found");
  }

  const kcState = kcStateRecord
    ? {
        kc: kcStateRecord.concept,
        masteryProbability: kcStateRecord.masteryScore,
        confidence: kcStateRecord.confidenceLevel,
        status: kcStateRecord.status,
        attemptsCount: kcStateRecord.attemptsCount,
        recentScores: Array.isArray(kcStateRecord.recentScores) ? kcStateRecord.recentScores : [],
        trend: kcStateRecord.trend,
      }
    : null;

  // Extract hypotheses linked to this specific KC from its recent evidence history
  const kcRecentScores = Array.isArray(kcStateRecord?.recentScores) ? kcStateRecord.recentScores : [];
  const linkedHypotheses = Array.from(
    new Set(
      kcRecentScores
        .map((s) => s && s.misconceptionHypothesis)
        .filter((h) => typeof h === "string" && h.trim().length > 0)
    )
  );

  const targetConcepts = Array.from(new Set([cleanKc, ...linkedHypotheses]));

  // Fetch active misconception (KnowledgeGap) matching targetConcepts OR matching KC directly
  const misconceptionRecord = await prisma.knowledgeGap.findFirst({
    where: {
      studentId,
      status: "OPEN",
      OR: [
        { concept: { in: targetConcepts } },
        { kc: cleanKc },
      ],
    },
    orderBy: { severity: "desc" },
  });

  const misconception = misconceptionRecord
    ? {
        id: misconceptionRecord.id,
        concept: misconceptionRecord.concept,
        hypothesis: misconceptionRecord.concept,
        severity: misconceptionRecord.severity,
        probability: misconceptionRecord.severity,
        status: misconceptionRecord.status,
      }
    : null;

  // Fetch learning context
  const learningContextRecord = await prisma.studentState.findFirst({
    where: { studentId },
    orderBy: { updatedAt: "desc" },
  });

  const { evaluatePedagogicalDecision } = require("./decision.service");

  return evaluatePedagogicalDecision({
    kc,
    kcState,
    misconception,
    learningContext: learningContextRecord,
    hasNextTarget: Boolean(data?.hasNextTarget),
  });
};

module.exports = {
  getLearnerState,
  initializeLearnerState,
  recordEvidence,
  recordMisconceptionState,
  getPedagogicalDecision,
};

