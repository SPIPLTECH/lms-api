const prisma = require("../../config/database");
const { evaluatePedagogicalDecision } = require("./decision.service");
const { PEDAGOGICAL_STRATEGIES, DECISION_PRIORITY } = require("./decision.config");
// Phase 8 signals. Required as a module, not destructured, for the same
// reason recommendationService is in nextAction.service: a destructured
// binding is captured at require time and cannot be stubbed.
const retentionService = require("./retention.service");
const { RETENTION_STATUS, TRANSFER_STATUS } = require("./retention.config");

/**
 * Student-facing learning recommendations.
 *
 * This is NOT a recommendation engine. The decision of what a student should
 * do about a concept already exists and is already deterministic:
 * evaluatePedagogicalDecision() turns a learner's ConceptMastery and
 * KnowledgeGap state into a pedagogical strategy. This module does three
 * things around it, and nothing else:
 *
 *   1. Asks that engine about each concept the student actually has evidence
 *      for — never about concepts they have not met.
 *   2. Translates the strategy into language a student can act on, and adds a
 *      plain reason drawn from their own answers (missed / skipped / needed a
 *      hint), so "why am I seeing this" is answerable.
 *   3. Resolves each one to real, reachable course content, and drops anything
 *      that cannot be — a recommendation that leads nowhere is worse than no
 *      recommendation.
 *
 * No LLM is involved anywhere in here. Nothing here writes to mastery,
 * evidence, progression or qualification: analytics of this kind must be able
 * to run without changing what it is measuring.
 */

/** Strategies that mean "the student needs to go back to something". */
const REMEDIAL_STRATEGIES = new Set([
  PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION,
  PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION,
  PEDAGOGICAL_STRATEGIES.REVIEW
]);

/** Strategies that mean "keep going / consolidate". */
const PRACTICE_STRATEGIES = new Set([
  PEDAGOGICAL_STRATEGIES.GUIDED_PRACTICE,
  PEDAGOGICAL_STRATEGIES.INDEPENDENT_PRACTICE
]);

const PRIORITY_ORDER = {
  [DECISION_PRIORITY.HIGH]: 0,
  [DECISION_PRIORITY.MEDIUM]: 1,
  [DECISION_PRIORITY.LOW]: 2
};

/**
 * How a mastery status reads to a student.
 *
 * The stored enum is already the vocabulary — no second calculation, and no
 * raw probability. A student is told where they stand, not the number behind
 * it: the score is an internal model estimate, and showing it invites reading
 * far more precision into it than it carries.
 */
const MASTERY_LABELS = {
  MASTERED: "Strong",
  DEVELOPING: "Developing",
  WEAK: "Needs practice",
  UNASSESSED: "Not assessed yet"
};

/**
 * Whether a knowledge component is something a student can be shown.
 *
 * Two kinds are not. "General" is the placeholder an untagged question falls
 * back to. And `question:<id>` is the synthetic per-question KC the quiz
 * service mints when a question carries no curated topic — deliberately, so
 * two unrelated untagged questions don't pollute one shared mastery bucket
 * (see calculateSubmissionResult). Both are internal bookkeeping: showing
 * either to a student means telling them their weak area is
 * "question:cmu2lqgza01io", which is meaningless to them and exposes an
 * internal identifier besides.
 *
 * They still count as evidence inside the model — they are just not spoken
 * aloud.
 */
const isStudentFacingConcept = (concept) => {
  const value = (concept || "").trim();
  if (!value) return false;
  if (value.toLowerCase() === "general") return false;
  if (value.startsWith("question:")) return false;
  return true;
};

/**
 * Per-concept evidence from the student's own question records.
 *
 * Aggregated in the database, grouped by concept, across every attempt the
 * student has made in this course. This is what makes a reason specific — a
 * student who keeps getting a concept wrong and one who keeps skipping past
 * it need to hear different things, and both are visible here.
 */
const fetchConceptEvidence = async (studentId, courseId) => {
  const rows = await prisma.questionAttempt.findMany({
    where: {
      quizAttempt: { studentId, ...(courseId ? { quiz: { courseId } } : {}) },
      question: { topic: { not: null } }
    },
    select: {
      isCorrect: true,
      answered: true,
      skipped: true,
      hintViewed: true,
      question: { select: { topic: true } }
    }
  });

  const byConcept = new Map();
  for (const row of rows) {
    const concept = (row.question?.topic || "").trim();
    if (!isStudentFacingConcept(concept)) continue;

    if (!byConcept.has(concept)) {
      byConcept.set(concept, { asked: 0, correct: 0, incorrect: 0, skipped: 0, hinted: 0 });
    }
    const entry = byConcept.get(concept);
    entry.asked += 1;
    if (row.answered && row.isCorrect === true) entry.correct += 1;
    else if (row.answered) entry.incorrect += 1;
    if (row.skipped === true) entry.skipped += 1;
    if (row.hintViewed === true) entry.hinted += 1;
  }

  return byConcept;
};

/**
 * A plain-language reason, drawn from what the student actually did.
 *
 * Deliberately describes behaviour ("you missed several questions"), never a
 * verdict about the student ("you don't understand this"). The evidence
 * supports the former and not the latter, and the difference matters to
 * someone reading it about themselves.
 *
 * A single hint never becomes a reason on its own — reaching for one hint is
 * not a weakness signal, and treating it as one would make the feature feel
 * punitive for using a tool the product offers.
 */
const buildReason = (evidence, decision) => {
  if (evidence) {
    if (evidence.incorrect >= 2) {
      return `You missed ${evidence.incorrect} questions on this topic in recent quizzes.`;
    }
    if (evidence.skipped >= 2) {
      return `You skipped ${evidence.skipped} questions related to this concept.`;
    }
    if (evidence.hinted >= 2) {
      return `You used hints on ${evidence.hinted} recent questions in this topic.`;
    }
    if (evidence.incorrect === 1 && evidence.asked <= 2) {
      return "A recent question on this topic didn't go as expected.";
    }
  }

  // No question-level evidence to point at (e.g. mastery decayed over time, or
  // a misconception was recorded from another source). Fall back to something
  // honest and non-committal rather than inventing a cause.
  if (decision.strategy === PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION) {
    return "Your recent answers suggest a mix-up worth clearing up on this topic.";
  }
  if (decision.strategy === PEDAGOGICAL_STRATEGIES.REVIEW) {
    return "It's been a while since you practised this — a quick review should help.";
  }
  return "Some more practice on this topic is recommended.";
};

/** The student-facing action for a strategy. */
const buildAction = (strategy) => {
  if (strategy === PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION) {
    return { kind: "REVIEW_TOPIC", label: "Review Topic" };
  }
  if (strategy === PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION) {
    return { kind: "REVIEW_TOPIC", label: "Review Topic" };
  }
  if (strategy === PEDAGOGICAL_STRATEGIES.REVIEW) {
    return { kind: "REVIEW_TOPIC", label: "Review Topic" };
  }
  return { kind: "PRACTISE", label: "Practise" };
};

/**
 * Where a concept actually lives in this course, so a recommendation can link
 * somewhere real.
 *
 * Matched on the course's own naming — a Topic whose title is the concept —
 * because Question.topic and Topic.title are the two places the same idea is
 * named. Exact, or nothing: a fuzzy match that sends a student to the wrong
 * lesson is worse than no link at all.
 *
 * Two normalisations before comparing, both of them systematic rather than
 * approximate. Case and surrounding whitespace, and a leading ordinal — these
 * courses number their topics ("2.1 Boolean Algebra") while questions tag the
 * concept plainly ("Boolean Algebra"), so without stripping it nothing would
 * ever match. The rule only removes a leading digits-and-dots prefix; it never
 * compares partial words, so "Inheritance" still fails to match "Java
 * Inheritance Basics".
 */
const normalizeConceptKey = (value) =>
  String(value || "")
    .trim()
    // "2.1 Boolean Algebra" -> "Boolean Algebra"; "Boolean Algebra" unchanged.
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, "")
    .trim()
    .toLowerCase();

/**
 * Content a recommendation is allowed to point at.
 *
 * A suggestion is always to go BACK over something — "Review X", "Practise
 * X". That only makes sense for content the student has already been
 * through, so a target must be settled: `completed`, or `qualified` (they
 * passed its qualifying test and skipped it, which is still content they
 * have been assessed on and can legitimately be sent back to).
 *
 * Without this, a wrong answer in a qualifying test — which deliberately
 * asks about material the student has NOT studied yet — produced "Review
 * Polymorphism" for a topic they had never opened. That is not a review, it
 * is the ordinary learning path, and CONTINUE_LEARNING already owns it.
 *
 * Read from TopicProgress, the same materialized roll-up the learning path
 * reads, so a recommendation can never disagree with the path about whether
 * a topic is done.
 */
const fetchSettledTopicIds = async (studentId, courseId) => {
  const rows = await prisma.topicProgress.findMany({
    where: {
      studentId,
      OR: [{ completed: true }, { qualified: true }],
      topic: { lesson: { module: { courseId } } }
    },
    select: { topicId: true }
  });

  return new Set(rows.map((row) => row.topicId));
};

const resolveConceptTargets = async (concepts, courseId, studentId) => {
  if (concepts.length === 0 || !courseId) return new Map();

  const topics = await prisma.topic.findMany({
    where: {
      isPublished: true,
      lesson: { isPublished: true, module: { isPublished: true, courseId } }
    },
    select: {
      id: true,
      title: true,
      lessonId: true,
      lesson: { select: { id: true, title: true, moduleId: true } }
    }
  });

  const byTitle = new Map(topics.map((t) => [normalizeConceptKey(t.title), t]));
  const settled = await fetchSettledTopicIds(studentId, courseId);
  const resolved = new Map();

  for (const concept of concepts) {
    const match = byTitle.get(normalizeConceptKey(concept));
    if (!match) continue;
    // Nothing to review yet — see fetchSettledTopicIds.
    if (!settled.has(match.id)) continue;
    resolved.set(concept, {
      kind: "TOPIC",
      topicId: match.id,
      lessonId: match.lesson.id,
      moduleId: match.lesson.moduleId,
      title: match.title,
      lessonTitle: match.lesson.title
    });
  }

  return resolved;
};

/**
 * The student's weak areas, as the mastery model already records them.
 *
 * Only concepts the student has actually been assessed on — UNASSESSED is not
 * a weakness, it is an absence of information, and reporting it as one would
 * invent a problem the evidence does not support.
 */
const buildWeakAreas = (masteries, evidenceByConcept) =>
  masteries
    .filter((m) => isStudentFacingConcept(m.concept))
    .filter((m) => m.status === "WEAK" || m.status === "DEVELOPING")
    .map((m) => {
      const evidence = evidenceByConcept.get(m.concept) || null;
      return {
        concept: m.concept,
        // The stored status, relabelled — not a second calculation.
        masteryLabel: MASTERY_LABELS[m.status] ?? MASTERY_LABELS.UNASSESSED,
        status: m.status,
        summary: m.status === "WEAK" ? "Needs more practice" : "Review recommended",
        // Counts from the student's own answers. No internal scores.
        questionsAsked: evidence?.asked ?? 0,
        questionsMissed: evidence ? evidence.incorrect + evidence.skipped : 0
      };
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "WEAK" ? -1 : 1;
      return b.questionsMissed - a.questionsMissed || a.concept.localeCompare(b.concept);
    });

/**
 * Recommendations for one student, most important first.
 *
 * @param {object} studentProfile  already resolved AND authorized by the caller
 *   (learnerModel.service's resolveStudentProfile) — this function does not
 *   re-check identity and must never be called with an unverified profile.
 * @param {string|null} courseId   narrows evidence and targets to one course.
 * @param {number} limit           the dashboard shows a handful, not a backlog.
 */
/**
 * Turns Phase 8 signals into recommendations the existing pipeline can carry.
 *
 * Three rules, each keyed to a fact the current-mastery engine cannot see:
 *
 *   DECAYED        -> review. The student HAD this and the delayed answers
 *                     went badly. Worth saying even when mastery reads well,
 *                     which is exactly when the engine says ADVANCE.
 *   dueForReview   -> a lighter nudge. Demonstrated, not decayed, untouched
 *                     for a fortnight. No claim is made about whether it has
 *                     actually faded, because nothing measured it.
 *   REPEATED_ONLY  -> practice in a new context, and only when retention is
 *                     not already a problem: a student who is shaky on the
 *                     basics does not need a harder variation, and stacking
 *                     both cards on one concept would be noise.
 *
 * De-duplicated against the mastery loop's own candidates: if that loop
 * already has something to say about a concept, it keeps the floor.
 */
const addLongitudinalCandidates = ({ candidates, signals, targets, courseId }) => {
  const alreadyCovered = new Set(candidates.map((c) => c.concept));

  for (const signal of signals) {
    if (alreadyCovered.has(signal.concept)) continue;

    const target = targets.get(signal.concept);
    if (!target) continue;

    const base = {
      concept: signal.concept,
      priority: DECISION_PRIORITY.MEDIUM,
      masteryLabel: signal.label,
      target: {
        kind: target.kind,
        topicId: target.topicId,
        lessonId: target.lessonId,
        moduleId: target.moduleId,
        courseId: courseId ?? null,
        title: target.title,
        lessonTitle: target.lessonTitle
      },
      // Longitudinal counts, in the same counts-only spirit as the evidence
      // above: how many delayed answers, how many landed. No rates, no
      // mastery probabilities, nothing the student would read as a score.
      evidence: {
        delayedAnswered: signal.retention.delayedAnswered,
        delayedCorrect: signal.retention.delayedCorrect,
        distinctQuestionsSeen: signal.transfer.distinctSeen
      }
    };

    if (signal.retention.status === RETENTION_STATUS.DECAYED) {
      candidates.push({
        ...base,
        id: `retention:${signal.concept}`,
        type: "REVIEW_CONCEPT",
        title: `Review ${target.title}`,
        reason: "You had this earlier, but recent questions on it didn't go as well.",
        action: { kind: "REVIEW_TOPIC", label: "Review Topic" }
      });
      alreadyCovered.add(signal.concept);
      continue;
    }

    if (signal.retention.dueForReview) {
      candidates.push({
        ...base,
        id: `retention:${signal.concept}`,
        type: "REVIEW_CONCEPT",
        title: `Review ${target.title}`,
        reason: "It's been a while since you worked on this one.",
        action: { kind: "REVIEW_TOPIC", label: "Review Topic" }
      });
      alreadyCovered.add(signal.concept);
      continue;
    }

    const retentionIsFine =
      signal.retention.status === RETENTION_STATUS.RETAINED ||
      signal.retention.status === RETENTION_STATUS.INSUFFICIENT_EVIDENCE;

    if (signal.transfer.status === TRANSFER_STATUS.REPEATED_ONLY && retentionIsFine) {
      candidates.push({
        ...base,
        id: `transfer:${signal.concept}`,
        type: "PRACTISE_CONCEPT",
        title: `Practise applying ${target.title}`,
        // The signal's own wording, which already distinguishes "all on one
        // question" from "all in one quiz" — two different facts about the
        // student's history, and they are the one person who can tell them
        // apart.
        reason: `${signal.detail} Worth trying it somewhere new.`,
        action: { kind: "PRACTICE_TOPIC", label: "Practise" }
      });
      alreadyCovered.add(signal.concept);
    }
  }
};

const getRecommendations = async (studentProfile, { courseId = null, limit = 4 } = {}) => {
  const studentId = studentProfile.id;

  const [masteries, gaps, evidenceByConcept, longitudinal] = await Promise.all([
    prisma.conceptMastery.findMany({
      where: { studentId, ...(courseId ? { lastCourseId: courseId } : {}) },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.knowledgeGap.findMany({ where: { studentId, status: "OPEN" } }),
    fetchConceptEvidence(studentId, courseId),
    // Phase 8. One aggregated query alongside the three that were already
    // here, not a per-concept fan-out.
    retentionService.getLearningSignals(studentProfile, { courseId })
  ]);

  const signals = longitudinal.signals;

  // A student with no evidence yet gets no recommendations — not filler.
  // The dashboard has its own empty state for this.
  if (masteries.length === 0) {
    return { recommendations: [], weakAreas: [], masteryOverview: [] };
  }

  const gapByConcept = new Map(gaps.map((g) => [g.concept, g]));
  // Resolved once for both sources. A Phase 8 signal exists for any concept
  // the student has answered a question on, which is very nearly but not
  // exactly the set with a ConceptMastery row — so both are offered to the
  // resolver, and the same settled-content gate applies to each.
  const targets = await resolveConceptTargets(
    [...new Set([...masteries.map((m) => m.concept), ...signals.map((s) => s.concept)])],
    courseId,
    studentId
  );

  const candidates = [];

  for (const mastery of masteries) {
    // Internal bookkeeping KCs never become a student-facing card.
    if (!isStudentFacingConcept(mastery.concept)) continue;

    const kcState = {
      kc: mastery.concept,
      masteryProbability: mastery.masteryScore,
      confidence: mastery.confidenceLevel,
      status: mastery.status,
      attemptsCount: mastery.attemptsCount,
      recentScores: Array.isArray(mastery.recentScores) ? mastery.recentScores : [],
      trend: mastery.trend
    };

    const gap = gapByConcept.get(mastery.concept) || null;

    // THE existing deterministic engine. Not re-implemented, not adjusted —
    // called, and its answer respected.
    const decision = evaluatePedagogicalDecision({
      kc: mastery.concept,
      kcState,
      misconception: gap
        ? { hypothesis: gap.concept, probability: gap.severity, status: gap.status }
        : null,
      hasNextTarget: false
    });

    // ADVANCE and CHALLENGE mean "nothing to fix here". Surfacing those as
    // recommendations would be recommending something just because it exists,
    // which is exactly what a student learns to ignore.
    const isRemedial = REMEDIAL_STRATEGIES.has(decision.strategy);
    const isPractice = PRACTICE_STRATEGIES.has(decision.strategy);
    if (!isRemedial && !isPractice) continue;

    // Practice suggestions are only worth making where the student's own
    // answers show a reason; remediation stands on the mastery state alone.
    const evidence = evidenceByConcept.get(mastery.concept) || null;
    const hasEvidence = evidence && (evidence.incorrect > 0 || evidence.skipped > 0 || evidence.hinted > 0);
    if (isPractice && !hasEvidence) continue;

    // Nowhere to send them is a dead card. Dropped rather than rendered.
    const target = targets.get(mastery.concept);
    if (!target) continue;

    candidates.push({
      id: `concept:${mastery.concept}`,
      type: isRemedial ? "REVIEW_CONCEPT" : "PRACTISE_CONCEPT",
      concept: mastery.concept,
      title: `Review ${target.title}`,
      reason: buildReason(evidence, decision),
      action: buildAction(decision.strategy),
      masteryLabel: MASTERY_LABELS[mastery.status] ?? MASTERY_LABELS.UNASSESSED,
      priority: decision.priority,
      target: {
        kind: target.kind,
        topicId: target.topicId,
        lessonId: target.lessonId,
        moduleId: target.moduleId,
        courseId: courseId ?? mastery.lastCourseId ?? null,
        title: target.title,
        lessonTitle: target.lessonTitle
      },
      // Counts only — never masteryScore/confidence, which are internal model
      // estimates and would read as far more precise than they are.
      evidence: evidence
        ? {
            questionsAsked: evidence.asked,
            incorrect: evidence.incorrect,
            skipped: evidence.skipped,
            hintsUsed: evidence.hinted
          }
        : null
    });
  }

  // ---- Phase 8: retention and transfer as ADDITIONAL candidate sources ----
  //
  // Not a second engine. The loop above asks evaluatePedagogicalDecision
  // about the student's CURRENT mastery, and that engine answers ADVANCE or
  // CHALLENGE for a concept the student is good at — both of which are
  // dropped, correctly, as "nothing to do". But "good at it now" and "it
  // still held up a fortnight later" are different facts, and the engine has
  // no input that carries the second one. That is the gap Phase 8 fills.
  //
  // Everything these add is subject to the same two gates as the loop above:
  // the concept must resolve to real content, and that content must be
  // settled for this student (resolveConceptTargets). A retention
  // recommendation can no more point at unstudied content than any other.
  //
  // Priority is fixed at MEDIUM, deliberately. nextAction.service only ever
  // promotes a HIGH recommendation to the student's primary action, so these
  // can surface in Recommended-for-You and as secondary offers without
  // changing a single Phase 7 primary decision.
  addLongitudinalCandidates({ candidates, signals, targets, courseId });

  candidates.sort((a, b) => {
    const byPriority = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
    if (byPriority !== 0) return byPriority;
    const aMissed = (a.evidence?.incorrect ?? 0) + (a.evidence?.skipped ?? 0);
    const bMissed = (b.evidence?.incorrect ?? 0) + (b.evidence?.skipped ?? 0);
    return bMissed - aMissed || a.concept.localeCompare(b.concept);
  });

  return {
    // One card per concept — the id is the concept, so a student can never be
    // shown the same topic twice under two strategies.
    recommendations: candidates.slice(0, limit),
    weakAreas: buildWeakAreas(masteries, evidenceByConcept),
    masteryOverview: masteries
      .filter((m) => isStudentFacingConcept(m.concept) && m.status !== "UNASSESSED")
      .map((m) => ({
        concept: m.concept,
        status: m.status,
        masteryLabel: MASTERY_LABELS[m.status] ?? MASTERY_LABELS.UNASSESSED
      }))
  };
};

module.exports = {
  MASTERY_LABELS,
  normalizeConceptKey,
  isStudentFacingConcept,
  REMEDIAL_STRATEGIES,
  PRACTICE_STRATEGIES,
  buildReason,
  buildWeakAreas,
  resolveConceptTargets,
  fetchConceptEvidence,
  getRecommendations
};
