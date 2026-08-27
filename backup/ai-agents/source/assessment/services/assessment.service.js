const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const observation = require("../../observation");
const studentState = require("../../student-state");

const assessmentRepository = require("../repositories/assessment.repository");
const attemptRepository = require("../repositories/assessmentAttempt.repository");
const resultRepository = require("../repositories/assessmentResult.repository");
const masteryRepository = require("../repositories/conceptMastery.repository");
const gapRepository = require("../repositories/knowledgeGap.repository");
const reassessmentRepository = require("../repositories/reassessmentPlan.repository");

const { extractEvidence, extractOverallScore } = require("./domain/evidenceExtractor");
const { defaultConceptMasteryState, applyEvidence } = require("./domain/masteryReducer");
const { evaluateGap } = require("./domain/gapDetector");
const { generateRecommendations } = require("./domain/recommendationGenerator");
const { scheduleNextReassessment } = require("./domain/reassessmentScheduler");

const { assessmentBus } = require("../events/eventBus");
const { ASSESSMENT_EVENT_NAMES } = require("../events/eventNames");
const { getBoolean } = require("../utils/eventPayload.util");
const { round2 } = require("../utils/scoreMath.util");
const {
  MASTERY_STATUS,
  GAP_STATUS,
  REASSESSMENT_STATUS,
  REASSESSMENT_PRIORITY,
  EVALUATIVE_EVENT_TYPES,
  RISK_ESCALATION_DROPOUT_THRESHOLD,
} = require("../constants");
const {
  toMasteryMapResponse,
  toFullStateResponse,
  toKnowledgeGapsResponse,
  toRecommendationsResponse,
  toReassessmentPlanResponse,
  toHistoryResponse,
} = require("../dto/assessmentResponse.dto");

const priorityForStatus = (status) => {
  if (status === MASTERY_STATUS.WEAK) return REASSESSMENT_PRIORITY.HIGH;
  if (status === MASTERY_STATUS.DEVELOPING) return REASSESSMENT_PRIORITY.MEDIUM;
  return REASSESSMENT_PRIORITY.LOW;
};

const validateEvent = (event) => {
  if (!event || typeof event !== "object") throw new ApiError(400, "Event must be an object");
  if (!event.studentId) throw new ApiError(400, "Event is missing studentId");
  if (!event.eventType) throw new ApiError(400, "Event is missing eventType");
  if (!event.createdAt) throw new ApiError(400, "Event is missing createdAt");
};

/**
 * The core pipeline: Analyze -> Update Concept Mastery -> Detect Knowledge
 * Gaps -> Generate Adaptive Assessment -> Update History -> Save -> Publish.
 *
 * @param {object} event - a LearningEvent row
 * @param {{forceMasteryUpdate?: boolean}} [options]
 *   forceMasteryUpdate: used by recalculate() to reapply mastery updates
 *   even for events that already produced an AssessmentAttempt (because
 *   ConceptMastery was reset to rebuild from scratch) — attempt/result
 *   creation still stays idempotent either way.
 */
const runPipeline = async (event, { forceMasteryUpdate = false } = {}) => {
  validateEvent(event);

  if (!EVALUATIVE_EVENT_TYPES.includes(event.eventType)) {
    return null; // not evaluative — outside this agent's concern
  }

  const evidenceList = extractEvidence(event);
  const overallScore = extractOverallScore(event);

  if (evidenceList.length === 0 && overallScore === null) {
    return null; // nothing derivable from this event's payload
  }

  const studentId = event.studentId;
  const now = event.createdAt;

  const existingAttempt = await attemptRepository.findBySourceEventId(event.id);
  const shouldRecordAttempt = !existingAttempt && Boolean(event.quizId || event.assignmentId);
  const shouldUpdateMastery = evidenceList.length > 0 && (forceMasteryUpdate || !existingAttempt);

  if (!shouldRecordAttempt && !shouldUpdateMastery) {
    return null; // already fully processed, nothing new to apply
  }

  const masteryDeltas = {};
  const gapsDetected = [];
  const gapsClosed = [];
  const confidenceSamples = [];
  const touchedMasteryStates = [];

  const { attemptRecord } = await prisma.$transaction(async (tx) => {
    if (shouldUpdateMastery) {
      for (const evidence of evidenceList) {
        const previous =
          (await masteryRepository.findByStudentAndConcept(studentId, evidence.concept, tx)) ||
          defaultConceptMasteryState(evidence.concept);
        const wasOpen = previous.status === MASTERY_STATUS.WEAK;

        const next = applyEvidence(previous, evidence, now);
        await masteryRepository.upsert(studentId, evidence.concept, next, tx);

        touchedMasteryStates.push(next);
        confidenceSamples.push(next.confidenceLevel);
        masteryDeltas[evidence.concept] = round2(next.masteryScore - previous.masteryScore);

        const gapAction = evaluateGap(next.masteryScore);
        if (gapAction.action === "ENSURE_OPEN") {
          await gapRepository.ensureOpen(studentId, evidence.concept, gapAction.severity, tx);
          if (!wasOpen) gapsDetected.push(evidence.concept);
        } else {
          await gapRepository.ensureClosed(studentId, evidence.concept, now, tx);
          if (wasOpen) gapsClosed.push(evidence.concept);
        }

        if (next.nextReassessmentAt) {
          await reassessmentRepository.upsertPending(
            studentId,
            evidence.concept,
            { scheduledFor: next.nextReassessmentAt, reason: "mastery-update", priority: priorityForStatus(next.status) },
            tx
          );
        }
      }
    }

    let attemptRecord = null;

    if (shouldRecordAttempt) {
      const assessment = await assessmentRepository.findOrCreateStandard(
        { studentId, courseId: event.courseId, quizId: event.quizId, assignmentId: event.assignmentId },
        tx
      );

      const passed = getBoolean(event.payload, "passed") ?? (overallScore !== null ? overallScore >= 50 : null);

      attemptRecord = await attemptRepository.create(
        assessment.id,
        {
          studentId,
          sourceEventId: event.id,
          scorePercent: overallScore,
          passed,
          timeSpentSeconds: null,
          conceptScoresSnapshot:
            evidenceList.length > 0 ? Object.fromEntries(evidenceList.map((e) => [e.concept, e.scorePercent])) : null,
          submittedAt: now,
        },
        tx
      );

      const confidenceAtTime =
        confidenceSamples.length > 0
          ? round2(confidenceSamples.reduce((a, b) => a + b, 0) / confidenceSamples.length)
          : 0;

      const overall =
        overallScore !== null
          ? overallScore
          : touchedMasteryStates.length > 0
          ? round2(touchedMasteryStates.reduce((a, m) => a + m.masteryScore, 0) / touchedMasteryStates.length)
          : 0;

      await resultRepository.create(
        attemptRecord.id,
        studentId,
        { overallScore: overall, masteryDeltas, gapsDetected, gapsClosed, confidenceAtTime },
        tx
      );
    }

    return { attemptRecord };
  });

  if (shouldUpdateMastery) {
    const allMastery = await masteryRepository.findAllByStudent(studentId);
    const recommendations = generateRecommendations(allMastery, now);

    for (const recommendation of recommendations) {
      await assessmentRepository.replaceActiveRecommendation(studentId, recommendation);
    }

    assessmentBus.publish(ASSESSMENT_EVENT_NAMES.ASSESSMENT_UPDATED, {
      studentId,
      triggeredByEventId: event.id,
      conceptsTouched: evidenceList.map((e) => e.concept),
      gapsDetected,
      gapsClosed,
      recommendationsGenerated: recommendations.length,
    });
  }

  return { attemptId: attemptRecord?.id || null };
};

/** Live entry point — one event at a time, from the bus or the manual API. */
const evaluate = (event) => runPipeline(event, { forceMasteryUpdate: false });

/**
 * POST /assessment/evaluate: re-triggers processing for one already-
 * recorded LearningEvent by id. Deliberately takes an id, not raw event
 * data — Observation Agent is the only legitimate event-ingestion point,
 * this just re-runs analysis on something it already recorded (useful if
 * the live bus subscriber ever missed it).
 *
 * @param {string} eventId
 * @param {string} expectedStudentId - authorization check: the event must belong to this student
 */
const evaluateByEventId = async (eventId, expectedStudentId) => {
  const event = await observation.getEventById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }
  if (event.studentId !== expectedStudentId) {
    throw new ApiError(403, "Event does not belong to this student");
  }

  const outcome = await evaluate(event);
  return { eventId, studentId: expectedStudentId, processed: Boolean(outcome), attemptId: outcome?.attemptId || null };
};

/**
 * Event-sourced rebuild: resets *current-state* tables (ConceptMastery,
 * open gaps, pending/due reassessment plans) and replays every evaluative
 * event for this student from scratch. History tables (AssessmentAttempt,
 * AssessmentResult, closed gaps, completed plans) are immutable facts and
 * are never rewritten — replay skips creating a duplicate attempt for an
 * event that already produced one, but still reapplies its mastery
 * contribution since the mastery table was just cleared.
 */
const recalculate = async (studentId) => {
  await prisma.$transaction([
    prisma.conceptMastery.deleteMany({ where: { studentId } }),
    prisma.knowledgeGap.deleteMany({ where: { studentId, status: GAP_STATUS.OPEN } }),
    prisma.reassessmentPlan.deleteMany({
      where: { studentId, status: { in: [REASSESSMENT_STATUS.PENDING, REASSESSMENT_STATUS.DUE] } },
    }),
  ]);

  const allEvents = await observation.getStudentEventLog(studentId);
  const evaluativeEvents = allEvents.filter((e) => EVALUATIVE_EVENT_TYPES.includes(e.eventType));

  let processed = 0;
  for (const event of evaluativeEvents) {
    const outcome = await runPipeline(event, { forceMasteryUpdate: true });
    if (outcome) processed += 1;
  }

  return { studentId, eventsProcessed: processed, totalEvaluativeEvents: evaluativeEvents.length };
};

/**
 * Secondary trigger: Student State reports rising dropout risk. Pulls
 * reassessment for this student's not-yet-mastered concepts sooner —
 * pure scheduling, never a notification or a course recommendation.
 */
const reconcileRiskEscalation = async (studentId) => {
  const risk = await studentState.getRiskSnapshot(studentId);
  if (!risk || risk.dropoutRiskScore < RISK_ESCALATION_DROPOUT_THRESHOLD) return { escalated: 0 };

  const masteryRows = await masteryRepository.findAllByStudent(studentId);
  const now = new Date();
  let escalated = 0;

  for (const mastery of masteryRows) {
    if (mastery.status === MASTERY_STATUS.MASTERED || mastery.status === MASTERY_STATUS.UNASSESSED) continue;

    const scheduledFor = scheduleNextReassessment(mastery.status, now, true);
    if (!scheduledFor) continue;

    await masteryRepository.upsert(studentId, mastery.concept, { nextReassessmentAt: scheduledFor });
    await reassessmentRepository.upsertPending(studentId, mastery.concept, {
      scheduledFor,
      reason: "risk-escalation",
      priority: priorityForStatus(mastery.status),
    });
    escalated += 1;
  }

  return { escalated };
};

// --- Read-side queries -----------------------------------------------------

const getMastery = async (studentId) => {
  const rows = await masteryRepository.findAllByStudent(studentId);
  return toMasteryMapResponse(studentId, rows);
};

const getFullState = async (studentId) => {
  const [masteryRows, openGaps, currentRecommendations, pendingReassessments] = await Promise.all([
    masteryRepository.findAllByStudent(studentId),
    gapRepository.findAllOpenByStudent(studentId),
    assessmentRepository.findCurrentRecommendations(studentId),
    reassessmentRepository.findByStudent(studentId, {}),
  ]);

  return toFullStateResponse(studentId, { masteryRows, openGaps, currentRecommendations, pendingReassessments });
};

const getHistory = async (studentId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const [attempts, total] = await Promise.all([
    attemptRepository.findByStudent(studentId, { skip, take: limit }),
    prisma.assessmentAttempt.count({ where: { studentId } }),
  ]);

  return toHistoryResponse(studentId, attempts, { page, limit, total, totalPages: Math.ceil(total / limit) || 1 });
};

const getKnowledgeGaps = async (studentId) => {
  const gaps = await gapRepository.findAllOpenByStudent(studentId);
  return toKnowledgeGapsResponse(studentId, gaps);
};

const getRecommendations = async (studentId) => {
  const assessments = await assessmentRepository.findCurrentRecommendations(studentId);
  return toRecommendationsResponse(studentId, assessments);
};

const getReassessmentPlan = async (studentId) => {
  const plans = await reassessmentRepository.findByStudent(studentId, {});
  return toReassessmentPlanResponse(studentId, plans);
};

/**
 * Batch read for cross-agent consumers aggregating many students at once
 * (e.g. Teacher Insight's class-wide concept analysis) — two queries
 * (mastery + gaps) instead of 2N. Returns flat arrays rather than a
 * per-student map since class-wide aggregation groups by concept, not by
 * student, on the consumer side.
 *
 * @param {string[]} studentIds
 */
const getBatchAssessmentSummary = async (studentIds) => {
  if (studentIds.length === 0) return { masteryRows: [], openGaps: [] };

  const [masteryRows, openGaps] = await Promise.all([
    masteryRepository.findAllByStudents(studentIds),
    gapRepository.findAllOpenByStudents(studentIds),
  ]);

  return { masteryRows, openGaps };
};

module.exports = {
  evaluate,
  evaluateByEventId,
  recalculate,
  reconcileRiskEscalation,
  getMastery,
  getFullState,
  getHistory,
  getKnowledgeGaps,
  getRecommendations,
  getBatchAssessmentSummary,
  getReassessmentPlan,
};
