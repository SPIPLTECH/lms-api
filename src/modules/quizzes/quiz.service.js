const prisma = require("../../config/database");
const { Prisma } = require("@prisma/client");
const notificationService = require("../notifications/notification.service");
const learnerModelService = require("../learner-model/learnerModel.service");
const { MISCONCEPTION_TAXONOMY, isKnownMisconceptionType } = require("../learner-model/misconceptionTaxonomy.config");
const misconceptionClassifier = require("../learner-model/misconceptionClassifier.service");
const {
  claimSequenceOrder,
  releaseSequenceOrder,
  mostSpecificParentField,
  assertCourseReorderAllowed,
} = require("../contents/contentOrder.util");
const { buildQualificationOutcome } = require("../../utils/qualificationResult");
const { QUALIFYING_TAG } = require("../../utils/qualification");
// One rule for the attempt allowance, shared with nextAction.service so a
// student is never told a limit that submit would not enforce.
const { effectiveMaxAttempts, buildAttemptAllowance } = require("../../utils/attemptAllowance");


// Tracks classifyAndApply() calls dispatched below fire-and-forget (never
// awaited by the HTTP response, by design — see the dispatch site). Exists
// solely so callers that need to know when that background write has
// actually landed (namely: tests tearing down a student fixture) can wait
// for it deterministically, instead of deleting the student's row while a
// KnowledgeGap.create() for that same student may still be in flight —
// which fails with a KnowledgeGap_studentId_fkey violation once the row is
// gone. Does not change response timing for real requests.
const pendingMisconceptionClassifications = new Set();

// Tracks the post-submission side-effect chains dispatched by submitQuiz --
// the progress rollup, learner-model evidence and instructor notification it
// answers the HTTP caller without waiting for. Same purpose as the set above:
// give tests (and a graceful shutdown) a deterministic way to wait for work
// that a real request intentionally does not.
const pendingSubmissionSideEffects = new Set();

const flushPendingSubmissionSideEffects = () =>
  Promise.allSettled([...pendingSubmissionSideEffects]);

// Awaits the side-effect chains first: the classifier is dispatched from
// inside them, so flushing only the classifier set could return before a
// classification has even been queued.
const flushPendingMisconceptionClassifications = async () => {
  await flushPendingSubmissionSideEffects();
  return Promise.allSettled([...pendingMisconceptionClassifications]);
};

const evaluateAnswer = (answer, correctAnswer, questionType) => {
  if (answer === undefined || answer === null || answer === "") {
    return 0;
  }

  const type = String(questionType || '').toUpperCase();

  // 1. MATCH_PAIRS (Object mapping match)
  if (type === "MATCH_PAIRS" || (typeof correctAnswer === "object" && correctAnswer !== null && !Array.isArray(correctAnswer))) {
    if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
      return 0;
    }
    const keysA = Object.keys(answer);
    const keysB = Object.keys(correctAnswer);
    if (keysB.length === 0) return 0;
    
    let correctCount = 0;
    keysA.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(correctAnswer, key) && 
          String(answer[key]).trim().toLowerCase() === String(correctAnswer[key]).trim().toLowerCase()) {
        correctCount++;
      }
    });
    return Math.max(0, correctCount / keysB.length);
  }

  // 2. ARRANGE_TOKENS (Ordered Array match)
  if (type === "ARRANGE_TOKENS") {
    if (!Array.isArray(answer) || !Array.isArray(correctAnswer)) return 0;
    if (correctAnswer.length === 0) return 0;
    
    let correctCount = 0;
    answer.forEach((val, idx) => {
      if (idx < correctAnswer.length && String(val).trim().toLowerCase() === String(correctAnswer[idx]).trim().toLowerCase()) {
        correctCount++;
      }
    });
    return Math.max(0, correctCount / correctAnswer.length);
  }

  // 3. MCQ_MULTI / MULTIPLE_CORRECT (Order-independent Array match)
  if (type === "MCQ_MULTI" || type === "MULTIPLE_CORRECT" || Array.isArray(correctAnswer) || Array.isArray(answer)) {
    const selArr = Array.isArray(answer)
      ? answer.map(s => String(s).trim().toLowerCase())
      : [String(answer).trim().toLowerCase()];
    const corrArr = Array.isArray(correctAnswer)
      ? correctAnswer.map(c => String(c).trim().toLowerCase())
      : [String(correctAnswer).trim().toLowerCase()];

    if (corrArr.length === 0) return 0;
    
    let correctCount = 0;
    let incorrectCount = 0;

    selArr.forEach((val) => {
      if (corrArr.includes(val)) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    });
    
    const score = (correctCount - incorrectCount) / corrArr.length;
    return Math.max(0, score);
  }

  // 4. Primitive types (MCQ_SINGLE, MCQ, TRUE_FALSE, FILL_BLANK, SHORT_ANSWER, LONG_ANSWER)
  const selStr = String(answer).trim().toLowerCase();
  const corrStr = String(correctAnswer).trim().toLowerCase();
  return selStr === corrStr ? 1 : 0;
};

const normalizeOptionText = (value) => String(value).trim().toLowerCase();

/**
 * Phase 7A — Tier 1 deterministic misconception detection.
 *
 * Resolves the instructor-authored misconceptionTag (if any) for the
 * specific distractor a student selected. Pure, synchronous, zero I/O — safe
 * to call inline during scoring with no added latency.
 *
 * Only applies to single-select answers (a plain string) matched against
 * discrete `options`; MCQ_MULTI/ARRANGE_TOKENS/MATCH_PAIRS answers (arrays/
 * objects) have no single "selected option" and always return null here.
 *
 * Never guesses: an option list with duplicate text that both match the
 * submitted answer is ambiguous and returns null rather than picking either.
 *
 * @param {Array} options - Question.options — plain strings and/or
 *   { optionText, isCorrect, misconceptionTag? } objects may be mixed.
 * @param {*} studentAnswerRaw - the raw submitted answer value.
 * @returns {string|null} A taxonomy-validated misconception type, or null.
 */
const resolveMisconceptionTag = (options, studentAnswerRaw) => {
  if (typeof studentAnswerRaw !== "string") return null;
  if (!Array.isArray(options) || options.length === 0) return null;

  const normalizedAnswer = normalizeOptionText(studentAnswerRaw);
  const candidates = [];

  for (const entry of options) {
    let optText = null;
    let optTag = null;

    if (typeof entry === "string") {
      optText = entry;
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      optText = entry.optionText ?? entry.text ?? null;
      optTag = entry.misconceptionTag ?? null;
    } else {
      continue; // malformed entry — skip it, never crash resolution
    }

    if (typeof optText !== "string" || !optText.trim()) continue;

    if (normalizeOptionText(optText) === normalizedAnswer) {
      candidates.push({ optText, optTag });
    }
  }

  // Zero matches (e.g. free-text answer) or duplicate option text
  // (ambiguous — never guess which one was actually selected).
  if (candidates.length !== 1) return null;

  const tag = candidates[0].optTag;
  if (!isKnownMisconceptionType(tag)) return null; // no tag, or a stale/invalid one

  return tag;
};

/**
 * Phase 7B — plain-text rendering of Question.options for the classifier
 * prompt. Options may be legacy strings or { optionText, ... } objects;
 * the classifier only ever receives display text, never raw DB shapes.
 */
const formatOptionsForDisplay = (options) => {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt) => {
      if (typeof opt === "string") return opt;
      if (opt && typeof opt === "object") return String(opt.optionText ?? opt.text ?? "");
      return String(opt);
    })
    .filter(Boolean);
};

/**
 * Phase 7B — plain-text rendering of an answer value (correctAnswer or a
 * submitted answer), which per evaluateAnswer's supported shapes may be a
 * string, an array (MCQ_MULTI/ARRANGE_TOKENS), or an object (MATCH_PAIRS).
 */
const formatAnswerForDisplay = (value) => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const calculateSubmissionResult = (quiz, answers = []) => {
  const rawQuestions = quiz.quizQuestions ? quiz.quizQuestions.map(qq => ({
    ...qq.question,
    marks: qq.marks ?? qq.question?.marks ?? 1,
    negativeMarks: qq.question?.negativeMarks ?? 0,
    order: qq.order ?? qq.question?.order ?? null
  })) : [];

  const totalMarks = rawQuestions.reduce((sum, question) => sum + (question.marks || 1), 0);
  const answerMap = new Map((answers || []).map((ans) => [ans.questionId, ans.answer]));

  let score = 0;
  // Per-question correctness, kept alongside the aggregate score so callers
  // (the learner-model evidence bridge) can observe each answered question
  // individually instead of only the quiz-level pass/fail.
  const questionEvidence = [];
  // Every question in the quiz, answered or not, with what it was worth and
  // what it earned — the graded half of a QuestionAttempt row, and what the
  // attempt summary is folded from. Unlike questionEvidence above (answered
  // questions only, because an unanswered question is not evidence of
  // anything), this always covers the full question set.
  const questionResults = [];

  rawQuestions.forEach((question) => {
    const answer = answerMap.get(question.id);
    const questionMaxMarks = question.marks !== undefined ? Number(question.marks) : 1;

    if (answer === undefined || answer === null || answer === "") {
      questionResults.push({
        questionId: question.id,
        order: question.order ?? null,
        answered: false,
        answer: null,
        isCorrect: null,
        marksObtained: 0,
        maxMarks: questionMaxMarks
      });
      return;
    }

    {
      const qType = question.questionType || question.type;
      const scoreMultiplier = evaluateAnswer(answer, question.correctAnswer, qType);

      const questionMarks = questionMaxMarks;
      const negativeMarks = question.negativeMarks ? Number(question.negativeMarks) : 0;

      // What this one question moved the score by — the same arithmetic the
      // running total below uses, kept per question so the attempt's marks
      // add up to its score without a second, divergent calculation.
      let marksObtained = 0;
      if (scoreMultiplier > 0) {
        marksObtained = scoreMultiplier * questionMarks;
      } else if (scoreMultiplier === 0 && negativeMarks > 0) {
        marksObtained = -negativeMarks;
      }
      score += marksObtained;

      questionResults.push({
        questionId: question.id,
        order: question.order ?? null,
        answered: true,
        answer,
        isCorrect: scoreMultiplier >= 1,
        marksObtained: Number(marksObtained.toFixed(2)),
        maxMarks: questionMarks
      });

      // A question without a curated topic must NOT fall into a shared
      // "Uncategorized" bucket: two unrelated untagged questions would then
      // silently pollute the same BKT/misconception state. Fall back to a
      // deterministic (never random), per-question KC instead, so an
      // untagged question tracks its own isolated mastery until an
      // instructor tags a real concept via Question.topic.
      const kc = (question.topic && question.topic.trim()) || `question:${question.id}`;

      questionEvidence.push({
        questionId: question.id,
        kc,
        score: Math.max(0, Math.min(1, scoreMultiplier)),
        isCorrect: scoreMultiplier >= 1,
        moduleId: question.moduleId || null,
        studentAnswer: answer,
        questionText: question.question,
        // Tier 1 (Phase 7A): deterministic, authored-tag misconception
        // detection. null when the answer was correct (a misconception is
        // never relevant then), the distractor carries no tag, or the
        // selected option couldn't be determined unambiguously.
        misconceptionTag: scoreMultiplier >= 1 ? null : resolveMisconceptionTag(question.options, answer),
        // Phase 7B: pre-formatted, display-safe copies for the Tier 2
        // classifier dispatch. Kept separate from the raw studentAnswer/
        // questionText above so Tier 1's existing evidence-string output is
        // untouched.
        optionsDisplay: formatOptionsForDisplay(question.options),
        correctAnswerDisplay: formatAnswerForDisplay(question.correctAnswer),
        studentAnswerDisplay: formatAnswerForDisplay(answer)
      });
    }
  });

  const finalScore = Math.max(0, Number(score.toFixed(2)));
  const percentage = totalMarks === 0 ? 0 : Math.round((finalScore / totalMarks) * 100);

  return {
    score: finalScore,
    totalMarks,
    percentage,
    passed: percentage >= (quiz.passingScore || 0),
    questionEvidence,
    questionResults
  };
};

const getQuizzes = async (
  courseId,
  role,
  userId,
  batchId,
  studentId
) => {
  const where = {};

  if (courseId) {
    where.courseId = courseId;
  } else if (role === "INSTRUCTOR") {
    // No specific course requested: scope to this instructor's own courses only.
    where.course = { creatorId: userId };
  } else if (role === "STUDENT" && studentId) {
    // No specific course requested: scope to courses this student is
    // actually enrolled in — previously unscoped here (studentId was
    // resolved by the controller but never passed through), so a student
    // calling GET /quizzes with no courseId got every quiz in the system.
    where.course = { enrollments: { some: { studentId } } };
  }

  if (batchId) {
    where.batchId = batchId;
  }

  const quizzes = await prisma.quiz.findMany({
    where,
    include: {
      course: {
        select: { id: true, title: true }
      },
      quizQuestions: {
        select: { marks: true }
      },
      _count: {
        select: {
          quizQuestions: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  // Total marks = sum of each QuizQuestion's own marks override (not
  // Question.marks — a question can be worth a different amount within a
  // specific quiz). Computed here since Prisma has no relation-sum in
  // findMany; quizQuestions itself isn't returned to callers.
  return quizzes.map(({ quizQuestions, ...quiz }) => ({
    ...quiz,
    totalMarks: quizQuestions.reduce((sum, q) => sum + q.marks, 0)
  }));
};

const getQuizById = async (
  quizId,
  role,
  studentId = null
) => {
  const quiz = await prisma.quiz.findUnique({
    where: {
      id: quizId
    },
    include: {
      quizQuestions: {
        orderBy: { order: "asc" },
        include: { question: true }
      }
    }
  });

  if (!quiz) return null;

  const junctionQuestions = (quiz.quizQuestions || []).map((qq) => ({
    ...qq.question,
    marks: qq.marks ?? qq.question?.marks ?? 1,
    order: qq.order,
    isMandatory: qq.isMandatory,
    quizQuestionId: qq.id
  }));

  let allQuestions = [...junctionQuestions];

  // A student also gets how many attempts they have left, so the attempt UI
  // can stop them before they answer instead of the submit being refused.
  // Read before the stripping below, because which attempt they are on is
  // what decides whether hints may be sent at all.
  const attemptsUsed = studentId ? await countAttemptsUsed(studentId, quizId) : 0;
  const attemptStatus = studentId
    ? buildAttemptAllowance(effectiveMaxAttempts(quiz), attemptsUsed)
    : undefined;

  // Hints are a qualifying-test affordance only, and only from the second
  // attempt onward. A first attempt has to measure what the student already
  // knows — that is the entire basis on which they are allowed to skip the
  // content — so helping them through it would defeat the test. From the
  // second attempt the question is no longer "do you already know this?" but
  // "can you get there?", and a nudge is appropriate.
  //
  // `attemptsUsed` counts SUBMITTED attempts, so the attempt now in progress
  // is attemptsUsed + 1. It is recomputed from the QuizAttempt log on every
  // request, which is why a refresh mid-attempt still knows which attempt
  // this is.
  //
  // Every other kind of quiz is untouched: a Self-Test, a Final or any
  // ordinary lesson quiz never exposes a hint, whatever attempt it is on.
  const currentAttemptNumber = attemptsUsed + 1;
  const hintsUnlocked = quiz.quizTag === QUALIFYING_TAG && currentAttemptNumber >= 2;

  // Students attempting the quiz should not receive the answer key up front —
  // nor a hint they have not earned. Withheld here rather than hidden in the
  // client: a hint that reached the browser on a first attempt would be
  // readable in the network response however the UI chose to render it.
  if (role === "STUDENT" || role === "GUEST") {
    allQuestions = allQuestions.map(({ correctAnswer, explanation, hint, ...rest }) => ({
      ...rest,
      // `hasHint` travels regardless, so the attempt UI can tell "there is no
      // hint for this question" from "you cannot see it yet" without being
      // told what the hint says.
      hasHint: Boolean(hint && String(hint).trim()),
      ...(hintsUnlocked && hint ? { hint } : {})
    }));
  }

  // `quizQuestions` is the raw junction relation, and every row on it carries
  // the UNSANITIZED question — correctAnswer, explanation and hint included.
  // Spreading `quiz` shipped that alongside the sanitized `questions` array,
  // so everything carefully stripped above was still sitting in the same
  // response one key over, readable in the network tab by any student
  // attempting the quiz. It is dropped here for students and guests.
  //
  // No student-facing code reads it: the attempt UI uses `questions`, and the
  // instructor views that do read it (the composer, the course sidebar) are
  // unaffected and already prefer `questions` anyway.
  const { quizQuestions, ...quizFields } = quiz;
  const isStudentOrGuest = role === "STUDENT" || role === "GUEST";

  return {
    ...(isStudentOrGuest ? quizFields : quiz),
    questions: allQuestions,
    ...(attemptStatus && {
      attemptStatus,
      // What the attempt UI needs to render the hint control, decided here.
      currentAttemptNumber,
      hintsUnlocked
    })
  };
};

/**
 * A batch-scoped quiz is created batch-first: the instructor picks a batch,
 * then one of that batch's linked courses, then optionally a module inside
 * that course — enforced here (not just in the UI) so a mismatched
 * batchId/courseId/moduleId combination can never be written via a direct
 * API call either. `batchId` is optional (see schema.prisma) for quizzes
 * created straight from the Course Composer, which aren't tied to any
 * batch — that path skips batch-linkage validation entirely, but still gets
 * the module/course consistency check below.
 */
const validateQuizScope = async ({ batchId, courseId, moduleId, lessonId, topicId, subTopicId, conceptId }) => {
  if (batchId) {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { courses: { select: { id: true } } }
    });

    if (!batch) {
      const error = new Error("Batch not found");
      error.statusCode = 404;
      throw error;
    }

    if (!batch.courses.some((c) => c.id === courseId)) {
      const error = new Error("This course is not linked to the selected batch");
      error.statusCode = 400;
      throw error;
    }
  }

  if (moduleId) {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { courseId: true }
    });

    if (!module || module.courseId !== courseId) {
      const error = new Error("This module does not belong to the selected course");
      error.statusCode = 400;
      throw error;
    }
  }

  if (lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { module: { select: { id: true, courseId: true } } }
    });

    if (!lesson || lesson.module.courseId !== courseId) {
      const error = new Error("This lesson does not belong to the selected course");
      error.statusCode = 400;
      throw error;
    }

    if (moduleId && lesson.module.id !== moduleId) {
      const error = new Error("This lesson does not belong to the selected module");
      error.statusCode = 400;
      throw error;
    }
  }

  if (topicId) {
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      select: { lessonId: true, lesson: { select: { module: { select: { id: true, courseId: true } } } } }
    });

    if (!topic || topic.lesson.module.courseId !== courseId) {
      const error = new Error("This topic does not belong to the selected course");
      error.statusCode = 400;
      throw error;
    }

    if (lessonId && topic.lessonId !== lessonId) {
      const error = new Error("This topic does not belong to the selected lesson");
      error.statusCode = 400;
      throw error;
    }
  }

  // SubTopic / Concept follow exactly the same two checks the four existing
  // levels use: the parent must sit under the selected course, and must not
  // contradict a more-specific parent the caller also supplied.
  if (subTopicId) {
    const subTopic = await prisma.subTopic.findUnique({
      where: { id: subTopicId },
      select: {
        topicId: true,
        topic: { select: { lesson: { select: { module: { select: { courseId: true } } } } } }
      }
    });

    if (!subTopic || subTopic.topic.lesson.module.courseId !== courseId) {
      const error = new Error("This subtopic does not belong to the selected course");
      error.statusCode = 400;
      throw error;
    }

    if (topicId && subTopic.topicId !== topicId) {
      const error = new Error("This subtopic does not belong to the selected topic");
      error.statusCode = 400;
      throw error;
    }
  }

  if (conceptId) {
    const concept = await prisma.concept.findUnique({
      where: { id: conceptId },
      select: {
        subTopicId: true,
        subTopic: {
          select: {
            topicId: true,
            topic: { select: { lesson: { select: { module: { select: { courseId: true } } } } } }
          }
        }
      }
    });

    if (!concept || concept.subTopic.topic.lesson.module.courseId !== courseId) {
      const error = new Error("This concept does not belong to the selected course");
      error.statusCode = 400;
      throw error;
    }

    if (subTopicId && concept.subTopicId !== subTopicId) {
      const error = new Error("This concept does not belong to the selected subtopic");
      error.statusCode = 400;
      throw error;
    }

    if (topicId && concept.subTopic.topicId !== topicId) {
      const error = new Error("This concept does not belong to the selected topic");
      error.statusCode = 400;
      throw error;
    }
  }
};

const QUIZ_PARENT_PRECEDENCE = ["conceptId", "subTopicId", "topicId", "lessonId", "moduleId", "courseId"];

/** Most-specific non-null parent field on a quiz payload — courseId is
 * always present (schema-required), so this always resolves. Matches the
 * concept > subtopic > topic > lesson > module > course precedence this
 * codebase already uses elsewhere (validateQuizScope's nesting checks, the
 * frontend's isTopicQuiz/isLessonQuiz labeling). */
const resolveQuizParentField = (data) => QUIZ_PARENT_PRECEDENCE.find((f) => data[f]);

/** A Self-Test is never timed, and the server -- not the form -- owns that.
 * The *effective* tag decides, never the presence of a timeLimit key: a
 * client flipping FINAL -> SELF_TEST legitimately sends only { quizTag },
 * and the stale time limit still has to come off the row. */
const applyTagTimerRule = (effectiveTag, quizData) =>
  effectiveTag === "SELF_TEST" ? { ...quizData, timeLimit: null } : quizData;

/**
 * A QUALIFYING quiz is scored and limited like a Final — it decides whether a
 * student may skip real material, so it keeps a real attempt limit and may be
 * timed. It differs only in what passing MEANS, which is handled outside the
 * quiz module entirely (see utils/qualification.js).
 */
const isGatedTag = (tag) => tag === "FINAL" || tag === "QUALIFYING";

/**
 * A qualifying test must say what it qualifies the student to skip, and that
 * is the lesson or topic it is attached to. Without one it would be a test
 * that exempts the student from nothing — rejected here rather than saved as
 * a quiz that can never do its job. Refused at module and course level too:
 * skipping is offered at lesson and topic level only.
 */
const assertQualifyingTargetPresent = (tag, quizData) => {
  if (tag !== "QUALIFYING") return;
  if (quizData.lessonId || quizData.topicId) return;

  const error = new Error(
    "A qualifying test must be attached to the lesson or topic it lets the student skip."
  );
  error.statusCode = 400;
  throw error;
};

/** Attempts follow the tag the same way. A Self-Test is practice and is
 * stored as unlimited (0). A Final or Qualifying test always carries a real
 * limit of at least one: a blank or 0 request, or a quiz that was a Self-Test
 * until this edit, becomes 1. An edit that doesn't touch attempts leaves an
 * existing limit alone. */
const applyTagAttemptRule = (effectiveTag, quizData, existingAttempts) => {
  if (!isGatedTag(effectiveTag)) return { ...quizData, attempts: 0 };
  if (quizData.attempts !== undefined) {
    return { ...quizData, attempts: Math.max(1, Math.round(Number(quizData.attempts)) || 1) };
  }
  if (existingAttempts !== undefined && !(Number(existingAttempts) > 0)) {
    return { ...quizData, attempts: 1 };
  }
  return quizData;
};

// userId: the instructor building the quiz. Questions typed straight into the
// builder are real repository rows, and the repository shows an instructor only
// their own — a row inserted here without an author would belong to nobody and
// would never appear in the bank of the person who just wrote it.
const createQuiz = async (
  data,
  userId = null
) => {
  await validateQuizScope(data);
  assertQualifyingTargetPresent(data.quizTag, data);

  const { questions, ...quizData } = data;

  const orderField = resolveQuizParentField(quizData);
  const requestedOrder =
    quizData.order === undefined || quizData.order === null ? null : quizData.order;

  // The quiz takes its position in its most specific parent's ONE common
  // sequence (shared with that parent's Content, Assignments and child
  // entity): appended after the last item of any type, or — the Composer's
  // "add quiz here" — inserted at the given position with every later item
  // of any type moved down one, atomically with the insert.
  const quiz = await prisma.$transaction(async (tx) => {
    quizData.order = await claimSequenceOrder(orderField, quizData[orderField], requestedOrder, tx, "quiz");
    return tx.quiz.create({
      data: {
        ...applyTagAttemptRule(quizData.quizTag, applyTagTimerRule(quizData.quizTag, quizData)),
        moduleId: quizData.moduleId || null,
        lessonId: quizData.lessonId || null
      }
    });
  });

  if (Array.isArray(questions) && questions.length > 0) {
    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx];
      let questionId = q.id;

      const isDraftId =
        !questionId ||
        typeof questionId !== "string" ||
        questionId.startsWith("draft-") ||
        questionId.startsWith("temp-");

      if (isDraftId) {
        const createdQ = await prisma.question.create({
          data: {
            question: q.question || q.title || "Untitled Question",
            questionType: (q.questionType || q.type || "MCQ_SINGLE").toUpperCase(),
            options: Array.isArray(q.options) ? q.options : [],
            correctAnswer:
              typeof q.correctAnswer === "object"
                ? JSON.stringify(q.correctAnswer)
                : String(q.correctAnswer ?? ""),
            explanation: q.explanation || "",
            // A mid-attempt nudge, distinct from the post-submission explanation
            // above. Null rather than "" when absent, so "no hint authored" stays
            // distinguishable from an empty one.
            hint: q.hint?.trim() ? q.hint.trim() : null,
            marks: Number(q.marks) || 1,
            difficulty: (q.difficulty || "MEDIUM").toUpperCase(),
            isRequired: q.isMandatory !== false,
            createdBy: userId,
          },
        });
        questionId = createdQ.id;
      }

      await prisma.quizQuestion.create({
        data: {
          quizId: quiz.id,
          questionId,
          order: idx + 1,
          marks: Number(q.marks) || 1,
          isMandatory: q.isMandatory !== false,
        },
      });
    }
  }

  try {
    const course = await prisma.course.findUnique({
      where: { id: quiz.courseId },
      select: { title: true }
    });

    if (course && quiz.isPublished) {
      await notificationService.notifyEnrolledStudents(
        quiz.courseId,
        {
          title: "New Quiz Available 📝",
          message: `A new quiz "${quiz.title}" has been added to your course "${course.title}".`,
          type: "QUIZ_PUBLISHED",
          link: `/courses/${quiz.courseId}/quizzes`,
          actorId: userId
        },
        null,
        `quiz_published_${quiz.id}`,
        userId
      );
    }
  } catch (error) {
    console.error("Error sending quiz creation notification:", error.message);
  }

  return getQuizById(quiz.id, "INSTRUCTOR");
};

const updateQuiz = async (
  quizId,
  data,
  userId = null
) => {
  const existing = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!existing) {
    const error = new Error("Quiz not found");
    error.statusCode = 404;
    throw error;
  }

  const { questions, ...quizData } = data;

  // The tag may be changing in this very request, or may not be in the
  // payload at all -- either way the row's resulting tag is what governs
  // whether a time limit may survive.
  const effectiveTag = quizData.quizTag ?? existing.quizTag;

  // Retagging an existing quiz as QUALIFYING is only valid if it already
  // hangs off a lesson or topic — the scope columns aren't editable here, so
  // the check reads the stored row rather than the payload.
  assertQualifyingTargetPresent(effectiveTag, {
    lessonId: quizData.lessonId ?? existing.lessonId,
    topicId: quizData.topicId ?? existing.topicId
  });

  const updatedQuiz = await prisma.quiz.update({
    where: {
      id: quizId
    },
    data: applyTagAttemptRule(effectiveTag, applyTagTimerRule(effectiveTag, quizData), existing.attempts)
  });

  if (Array.isArray(questions)) {
    // Re-link questions cleanly
    await prisma.quizQuestion.deleteMany({ where: { quizId } });

    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx];
      let questionId = q.id;

      const isDraftId =
        !questionId ||
        typeof questionId !== "string" ||
        questionId.startsWith("draft-") ||
        questionId.startsWith("temp-");

      if (isDraftId) {
        const createdQ = await prisma.question.create({
          data: {
            question: q.question || q.title || "Untitled Question",
            questionType: (q.questionType || q.type || "MCQ_SINGLE").toUpperCase(),
            options: Array.isArray(q.options) ? q.options : [],
            correctAnswer:
              typeof q.correctAnswer === "object"
                ? JSON.stringify(q.correctAnswer)
                : String(q.correctAnswer ?? ""),
            explanation: q.explanation || "",
            // A mid-attempt nudge, distinct from the post-submission explanation
            // above. Null rather than "" when absent, so "no hint authored" stays
            // distinguishable from an empty one.
            hint: q.hint?.trim() ? q.hint.trim() : null,
            marks: Number(q.marks) || 1,
            difficulty: (q.difficulty || "MEDIUM").toUpperCase(),
            isRequired: q.isMandatory !== false,
            createdBy: userId,
          },
        });
        questionId = createdQ.id;
      } else {
        try {
          await prisma.question.update({
            where: { id: questionId },
            data: {
              question: q.question || q.title || "Untitled Question",
              questionType: (q.questionType || q.type || "MCQ_SINGLE").toUpperCase(),
              options: Array.isArray(q.options) ? q.options : [],
              correctAnswer:
                typeof q.correctAnswer === "object"
                  ? JSON.stringify(q.correctAnswer)
                  : String(q.correctAnswer ?? ""),
              explanation: q.explanation || "",
              // A mid-attempt nudge, distinct from the post-submission explanation
              // above. Null rather than "" when absent, so "no hint authored" stays
              // distinguishable from an empty one.
              hint: q.hint?.trim() ? q.hint.trim() : null,
              marks: Number(q.marks) || 1,
              difficulty: (q.difficulty || "MEDIUM").toUpperCase(),
              isRequired: q.isMandatory !== false,
            },
          });
        } catch {
          const createdQ = await prisma.question.create({
            data: {
              question: q.question || q.title || "Untitled Question",
              questionType: (q.questionType || q.type || "MCQ_SINGLE").toUpperCase(),
              options: Array.isArray(q.options) ? q.options : [],
              correctAnswer:
                typeof q.correctAnswer === "object"
                  ? JSON.stringify(q.correctAnswer)
                  : String(q.correctAnswer ?? ""),
              explanation: q.explanation || "",
              // A mid-attempt nudge, distinct from the post-submission explanation
              // above. Null rather than "" when absent, so "no hint authored" stays
              // distinguishable from an empty one.
              hint: q.hint?.trim() ? q.hint.trim() : null,
              marks: Number(q.marks) || 1,
              difficulty: (q.difficulty || "MEDIUM").toUpperCase(),
              isRequired: q.isMandatory !== false,
              createdBy: userId,
            },
          });
          questionId = createdQ.id;
        }
      }

      await prisma.quizQuestion.create({
        data: {
          quizId,
          questionId,
          order: idx + 1,
          marks: Number(q.marks) || 1,
          isMandatory: q.isMandatory !== false,
        },
      });
    }
  }

  return getQuizById(quizId, "INSTRUCTOR");
};

const deleteQuiz = async (
  quizId
) => {
  const existing = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!existing) {
    const error = new Error("Quiz not found");
    error.statusCode = 404;
    throw error;
  }

  // Removing a quiz closes its slot in its most specific parent's common sequence.
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.quiz.delete({
      where: {
        id: quizId
      }
    });
    const parentField = mostSpecificParentField(existing);
    await releaseSequenceOrder(parentField, parentField && existing[parentField], existing.order, tx);
    return deleted;
  });
};

/** A date the client sent, or null — never an Invalid Date reaching Prisma. */
const toDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The status a question ended the attempt in, from the facts about it.
 * Answering always wins — a question the student skipped and then went back
 * and answered is ANSWERED, not SKIPPED. Skip outranks a bare visit, since
 * skipping is a deliberate "not this one" and visiting is not.
 */
const resolveQuestionStatus = ({ answered, skipped, visited }) => {
  if (answered) return "ANSWERED";
  if (skipped) return "SKIPPED";
  if (visited) return "VISITED";
  return "NOT_VISITED";
};

/**
 * One QuestionAttempt row per question in the quiz, ready to write under a
 * QuizAttempt.
 *
 * The grading half (answered / answer / isCorrect / marksObtained / maxMarks)
 * comes from `result`, i.e. from the server's own scoring — never from the
 * client. The activity half (visited / skipped / hintViewed / timestamps) can
 * only come from the attempt UI, so it is read from `questionStates`, and is
 * simply absent for a client that doesn't send it.
 *
 * Client-reported state for a question that isn't in this quiz is dropped:
 * the question set drives the rows, so a stale or crafted payload can't add
 * records for questions the student was never shown.
 */
const buildQuestionAttemptRows = (result, questionStates = []) => {
  const stateMap = new Map(
    (questionStates || [])
      .filter((state) => state && state.questionId)
      .map((state) => [state.questionId, state])
  );

  return (result.questionResults || []).map((questionResult) => {
    const state = stateMap.get(questionResult.questionId) || {};
    const answered = questionResult.answered;
    // An answered question was necessarily visited, whatever the client said.
    const visited = answered || Boolean(state.visited) || state.status === "VISITED" ||
      state.status === "ANSWERED" || state.status === "SKIPPED";
    const skipped = Boolean(state.skipped) || state.status === "SKIPPED";

    return {
      questionId: questionResult.questionId,
      answer: questionResult.answer ?? null,
      status: resolveQuestionStatus({ answered, skipped, visited }),
      visited,
      skipped,
      answered,
      isCorrect: questionResult.isCorrect,
      marksObtained: questionResult.marksObtained,
      maxMarks: questionResult.maxMarks,
      hintViewed: Boolean(state.hintViewed),
      order: questionResult.order ?? null,
      firstVisitedAt: toDateOrNull(state.firstVisitedAt),
      lastVisitedAt: toDateOrNull(state.lastVisitedAt),
      answeredAt: answered ? toDateOrNull(state.answeredAt) : null,
      skippedAt: skipped ? toDateOrNull(state.skippedAt) : null
    };
  });
};

/**
 * The attempt summary, folded from its question rows — every figure the
 * result page shows is counted here, from the records, rather than kept as
 * its own column that could drift out of step with them.
 */
const summarizeQuestionAttempts = (rows = []) => {
  const answered = rows.filter((r) => r.answered);
  const correct = answered.filter((r) => r.isCorrect === true);
  const visited = rows.filter((r) => r.visited);
  const marksObtained = Number(
    rows.reduce((sum, r) => sum + Number(r.marksObtained || 0), 0).toFixed(2)
  );
  const maxMarks = Number(rows.reduce((sum, r) => sum + Number(r.maxMarks || 0), 0).toFixed(2));
  // Mirrors calculateSubmissionResult: an attempt is never scored below zero,
  // however much negative marking it collected.
  const score = Math.max(0, marksObtained);

  return {
    totalQuestions: rows.length,
    answeredCount: answered.length,
    unansweredCount: rows.length - answered.length,
    skippedCount: rows.filter((r) => r.skipped).length,
    visitedCount: visited.length,
    notVisitedCount: rows.length - visited.length,
    correctCount: correct.length,
    incorrectCount: answered.length - correct.length,
    hintViewedCount: rows.filter((r) => r.hintViewed).length,
    marksObtained,
    maxMarks,
    score,
    percentage: maxMarks === 0 ? 0 : Math.round((score / maxMarks) * 100)
  };
};

/**
 * The three tallies QuizAttempt carries as columns. They are folded from the
 * same question rows as everything else — the columns exist because attempts
 * submitted before question-level tracking have no rows to fold, and the
 * Submissions page still has to render them.
 */
const countAnswerOutcomes = (result, questionStates = []) => {
  const { correctCount, incorrectCount, unansweredCount } = summarizeQuestionAttempts(
    buildQuestionAttemptRows(result, questionStates)
  );
  return { correctCount, incorrectCount, unansweredCount };
};

const parseStoredAnswers = (answers) => {
  if (Array.isArray(answers)) return answers;
  if (typeof answers === "string") {
    try {
      const parsed = JSON.parse(answers);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

/**
 * A QuizSubmission made before the QuizAttempt log existed, shaped as the
 * attempt-1 row it stands in for. It keeps the submission's id, so a link to
 * it keeps working once it's copied into the log. Answer tallies need the
 * quiz's questions (with quizQuestions.question); without them they're null.
 */
const legacySubmissionAsAttempt = (submission, quiz = null) => {
  const outcomes = quiz
    ? countAnswerOutcomes(calculateSubmissionResult(quiz, parseStoredAnswers(submission.answers)))
    : { correctCount: null, incorrectCount: null, unansweredCount: null };

  return {
    id: submission.id,
    quizId: submission.quizId,
    studentId: submission.studentId,
    attemptNumber: 1,
    answers: submission.answers,
    score: submission.score,
    totalMarks: submission.totalMarks,
    percentage: submission.percentage,
    passed: submission.passed,
    ...outcomes,
    timeTakenSeconds: null,
    submittedAt: submission.submittedAt
  };
};

/**
 * How many attempts a student has used on a quiz: the QuizAttempt log, or 1
 * for a submission that predates the log.
 */
const countAttemptsUsed = async (studentId, quizId) => {
  const logged = await prisma.quizAttempt.count({ where: { studentId, quizId } });
  if (logged > 0) return logged;

  const legacy = await prisma.quizSubmission.findUnique({
    where: { studentId_quizId: { studentId, quizId } },
    select: { id: true }
  });
  return legacy ? 1 : 0;
};

const submitQuiz = async (
  studentId,
  quizId,
  answers = [],
  timeTakenSeconds = null,
  questionStates = []
) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { quizQuestions: { orderBy: { order: "asc" }, include: { question: true } } }
  });

  if (!quiz) {
    const error = new Error("Quiz not found");
    error.statusCode = 404;
    throw error;
  }

  const result = calculateSubmissionResult(quiz, answers);
  // One record per question, graded server-side, with the attempt UI's visit
  // and skip history merged in. Everything the attempt reports about itself
  // is folded from these — see summarizeQuestionAttempts.
  const questionAttemptRows = buildQuestionAttemptRows(result, questionStates);
  const summary = summarizeQuestionAttempts(questionAttemptRows);
  const outcomes = {
    correctCount: summary.correctCount,
    incorrectCount: summary.incorrectCount,
    unansweredCount: summary.unansweredCount
  };

  // The attempt-log row and the latest-attempt QuizSubmission are written in
  // one transaction, with the attempt limit checked inside it, so a double
  // submit can neither exceed Quiz.attempts nor leave the two out of step.
  // Two racing submits compute the same attemptNumber, and the unique
  // (studentId, quizId, attemptNumber) index rejects the second.
  let submission;
  let attempt;
  try {
    ({ submission, attempt } = await prisma.$transaction(async (tx) => {
      const lastLogged = await tx.quizAttempt.findFirst({
        where: { studentId, quizId },
        orderBy: { attemptNumber: "desc" },
        select: { attemptNumber: true }
      });
      const existing = await tx.quizSubmission.findUnique({
        where: { studentId_quizId: { studentId, quizId } }
      });

      let attemptsUsed = lastLogged?.attemptNumber ?? 0;

      // A submission from before the log existed is the student's first
      // attempt — copy it in before the upsert below overwrites it.
      if (attemptsUsed === 0 && existing) {
        await tx.quizAttempt.create({ data: legacySubmissionAsAttempt(existing, quiz) });
        attemptsUsed = 1;
      }

      if (!buildAttemptAllowance(effectiveMaxAttempts(quiz), attemptsUsed).canAttempt) {
        const error = new Error(
          `You have used all ${quiz.attempts} attempt${quiz.attempts === 1 ? "" : "s"} allowed for this quiz.`
        );
        error.statusCode = 403;
        throw error;
      }

      const createdAttempt = await tx.quizAttempt.create({
        data: {
          studentId,
          quizId,
          attemptNumber: attemptsUsed + 1,
          answers,
          score: result.score,
          totalMarks: result.totalMarks,
          percentage: result.percentage,
          passed: result.passed,
          ...outcomes,
          timeTakenSeconds
        }
      });

      // Written under the attempt just created, in the same transaction, so
      // an attempt can never be committed without its question records. They
      // are keyed by this attempt's id, so nothing here can reach an earlier
      // attempt's rows — a retake adds a fresh set and leaves the previous
      // attempt exactly as it was submitted.
      if (questionAttemptRows.length > 0) {
        await tx.questionAttempt.createMany({
          data: questionAttemptRows.map((row) => ({
            ...row,
            // A nullable Json column needs Prisma's explicit null sentinel;
            // a bare `null` is rejected at runtime.
            answer: row.answer === null ? Prisma.DbNull : row.answer,
            quizAttemptId: createdAttempt.id
          }))
        });
      }

      const latest = await tx.quizSubmission.upsert({
        where: {
          studentId_quizId: {
            studentId,
            quizId
          }
        },
        update: {
          answers,
          score: result.score,
          totalMarks: result.totalMarks,
          percentage: result.percentage,
          passed: result.passed,
          submittedAt: createdAttempt.submittedAt
        },
        create: {
          studentId,
          quizId,
          answers,
          score: result.score,
          totalMarks: result.totalMarks,
          percentage: result.percentage,
          passed: result.passed,
          submittedAt: createdAttempt.submittedAt
        }
      });

      return { submission: latest, attempt: createdAttempt };
    }, { timeout: 15000 }));
  } catch (error) {
    if (error.code === "P2002") {
      const conflict = new Error("This attempt has already been submitted.");
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }

  // Everything below is a side effect of a submission that is already
  // committed above: the progress rollup, the per-question learner-model
  // evidence, and the instructor's notification. None of it changes what
  // the student gets back, and all of it is slow — the rollup alone fans
  // out into ~16 relation queries plus one upsert per topic, and the
  // database is remote (~100ms a round trip). Awaiting it inline pushed
  // the response past the client's 15s timeout, so the browser reported a
  // failed submission for answers that had in fact been recorded, and the
  // student resubmitted — spending another real attempt. So it is
  // dispatched here and deliberately NOT awaited. Each step already logs
  // and swallows its own failures; the catch below is a backstop so a
  // throw between them can't surface as an unhandled rejection.
  const sideEffects = (async () => {
    // Synchronize QuizProgress when quiz is passed authoritatively
    if (result.passed) {
      try {
        const existingQp = await prisma.quizProgress.findUnique({
          where: { studentId_quizId: { studentId, quizId } }
        });
        await prisma.quizProgress.upsert({
          where: { studentId_quizId: { studentId, quizId } },
          create: {
            studentId,
            quizId,
            completed: true,
            completedAt: new Date()
          },
          update: {
            completed: true,
            completedAt: existingQp?.completedAt || new Date()
          }
        });
      } catch (qpErr) {
        console.error("QuizProgress sync failed after quiz submission:", qpErr);
      }
    }

    // Recompute course progress after quiz submission
    try {
      const { recomputeCourseProgress } = require("../../utils/progressRollup");
      await recomputeCourseProgress(studentId, quiz.courseId);
    } catch (err) {
      console.error("Progress rollup recalculation failed after quiz submission:", err);
    }

    // Feed each answered question into the existing learner-model evidence
    // pipeline (BKT + misconception detection) as its own observation, so
    // multiple questions on the same KC aren't collapsed into one data point.
    // This is a best-effort side effect: the QuizSubmission above is already
    // committed and is the source of truth for the student's score, so a
    // failure here is logged loudly rather than rolling back the submission
    // or silently claiming an adaptive update that didn't happen.
    for (const evidence of result.questionEvidence) {
      try {
        const recordResult = await learnerModelService.recordEvidence({
          callingUser: { role: "ADMIN" },
          data: {
            studentId,
            kc: evidence.kc,
            score: evidence.score,
            isCorrect: evidence.isCorrect,
            courseId: quiz.courseId,
            quizId,
            ...(evidence.moduleId ? { moduleId: evidence.moduleId } : {}),
            // Tier 1 (Phase 7A): reuses the EXISTING misconceptionHypothesis
            // field on the EXISTING recordEvidence/evaluateAndDetectMisconception
            // call chain — misconception.service.js is untouched. The resolved
            // taxonomy type becomes `concept`/the hypothesis identity, exactly
            // as any other caller-supplied hypothesis would.
            ...(evidence.misconceptionTag ? { misconceptionHypothesis: evidence.misconceptionTag } : {}),
            metadata: { questionId: evidence.questionId, quizSubmissionId: submission.id }
          }
        });

        // Narrow, additive follow-up: attach taxonomy metadata to the SAME
        // KnowledgeGap row misconception.service.js just created/updated,
        // scoped strictly to the new columns (kc/type/description/confidence/
        // evidence). Severity and status were already set above, untouched.
        if (evidence.misconceptionTag && recordResult.recordedMisconception) {
          const taxonomyEntry = MISCONCEPTION_TAXONOMY[evidence.misconceptionTag];
          await prisma.knowledgeGap.update({
            where: { id: recordResult.recordedMisconception.id },
            data: {
              kc: evidence.kc,
              type: evidence.misconceptionTag,
              description: taxonomyEntry.description,
              confidence: 1.0,
              evidence: `Selected "${evidence.studentAnswer}" for question: "${evidence.questionText}"`
            }
          });
        } else if (!evidence.isCorrect) {
          // Tier 2 (Phase 7B): the answer was wrong and Tier 1 found no
          // authored tag for the selected distractor. Fire-and-forget —
          // deliberately NOT awaited, so an LLM call can never add latency to
          // (or fail) this response. Any outcome (a new/continued
          // KnowledgeGap, or any of the classifier's own discard/failure
          // paths) is applied strictly after this function has already
          // returned to the HTTP caller.
          const classificationPromise = misconceptionClassifier
            .classifyAndApply({
              studentId,
              kc: evidence.kc,
              questionText: evidence.questionText,
              options: evidence.optionsDisplay,
              correctAnswer: evidence.correctAnswerDisplay,
              studentAnswer: evidence.studentAnswerDisplay,
              isCorrect: evidence.isCorrect,
              score: evidence.score
            })
            .catch((error) => {
              console.error(
                `Misconception classifier dispatch failed (student=${studentId}, quiz=${quizId}, question=${evidence.questionId}, kc=${evidence.kc}):`,
                error
              );
            })
            .finally(() => pendingMisconceptionClassifications.delete(classificationPromise));

          pendingMisconceptionClassifications.add(classificationPromise);
        }
      } catch (error) {
        console.error(
          `Learner-model evidence recording failed (student=${studentId}, quiz=${quizId}, question=${evidence.questionId}, kc=${evidence.kc}):`,
          error
        );
      }
    }

    // Notify the instructor
    try {
      const course = await prisma.course.findUnique({
        where: { id: quiz.courseId },
        select: { title: true, creatorId: true }
      });

      const student = await prisma.studentProfile.findUnique({
        where: { id: studentId },
        include: {
          user: {
            select: {
              name: true
            }
          }
        }
      });

      if (course && student) {
        await notificationService.createNotification(course.creatorId, {
          title: "Quiz Submitted 📝",
          message: `${student.user.name} submitted the quiz "${quiz.title}" for "${course.title}" (Score: ${result.percentage}%).`,
          type: "QUIZ_SUBMISSION",
          link: `/courses/${quiz.courseId}/quizzes`,
          eventId: `quiz_submission_${submission.id}`,
          actorId: student.userId
        });
      }
    } catch (error) {
      console.error("Error creating quiz submission notification:", error.message);
    }
  })()
    .catch((error) => {
      console.error(
        `Post-submission side effects failed (student=${studentId}, quiz=${quizId}):`,
        error
      );
    })
    .finally(() => pendingSubmissionSideEffects.delete(sideEffects));

  pendingSubmissionSideEffects.add(sideEffects);

  return {
    ...submission,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber
  };
};

/**
 * Whether this result may show the answer key.
 *
 * For every ordinary quiz: yes. The attempt is over and reviewing the answers
 * is the point of a result page.
 *
 * For a QUALIFYING test it is yes ONLY once the student can no longer change
 * the outcome — they passed, or they are out of attempts. While a retake is
 * still available, handing over the answer key would let a student fail
 * attempt 1, read every correct answer off their own result page, and score
 * 100% on attempt 2. That is qualification forged through a legitimate
 * endpoint: the lesson gets skipped without the knowledge the test exists to
 * establish, and it makes the attempt-2 hint rule pointless, since the
 * answers themselves were already handed over.
 *
 * Their own answers, score and per-question correctness are still shown —
 * the student learns exactly what they got wrong, just not what was right.
 */
const mayRevealAnswerKey = ({ quiz, passed, canAttempt }) => {
  if (!quiz || quiz.quizTag !== QUALIFYING_TAG) return true;
  return passed === true || canAttempt !== true;
};

/** Question fields that give the answer away, stripped as a set. */
const stripAnswerKey = ({ correctAnswer, explanation, hint, ...rest }) => rest;

/** One attempt as it appears in an attempt-history list. */
const toAttemptSummary = (attempt) => ({
  id: attempt.id,
  attemptNumber: attempt.attemptNumber,
  score: attempt.score,
  totalMarks: attempt.totalMarks,
  percentage: attempt.percentage,
  passed: attempt.passed,
  timeTakenSeconds: attempt.timeTakenSeconds ?? null,
  submittedAt: attempt.submittedAt
});

/**
 * A student's result for a quiz — the latest attempt, or the one named by
 * attemptId — plus the quiz's question set for the result-review page, the
 * student's whole attempt history, and their remaining allowance. Null when
 * there is no such attempt.
 *
 * Normally this includes correctAnswer/explanation: the student has submitted,
 * so there is nothing left to protect. A QUALIFYING test is the exception
 * while it can still be retaken — see withholdAnswerKeyWhileRetakeable.
 */
const getQuizResult = async (studentId, quizId, attemptId = null) => {
  const [submission, logged, quiz] = await Promise.all([
    prisma.quizSubmission.findUnique({
      where: {
        studentId_quizId: {
          studentId,
          quizId
        }
      }
    }),
    prisma.quizAttempt.findMany({
      where: { studentId, quizId },
      orderBy: { attemptNumber: "asc" },
      include: {
        // Each attempt keeps its own question records, so opening an earlier
        // attempt reads that attempt's answers and statuses, not the latest's.
        // The question's concept comes along for a qualifying test's weak-area
        // report; it is a single extra join, not a second query.
        questionAttempts: {
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          include: { question: { select: { id: true, topic: true, moduleId: true } } }
        }
      }
    }),
    prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        // Titles for the result page header.
        course: { select: { id: true, title: true } },
        module: { select: { id: true, title: true } },
        quizQuestions: {
          orderBy: { order: "asc" },
          include: { question: true }
        }
      }
    })
  ]);

  const history =
    logged.length > 0
      ? logged
      : submission
        ? [legacySubmissionAsAttempt(submission, quiz)]
        : [];

  if (history.length === 0) return null;

  const latest = history[history.length - 1];
  const selected = attemptId ? history.find((a) => a.id === attemptId) : latest;

  if (!selected) return null;

  const allowance = buildAttemptAllowance(quiz ? effectiveMaxAttempts(quiz) : 0, history.length);
  // Decided against the student's standing across the WHOLE quiz, not the one
  // attempt being viewed: opening attempt 1 while attempt 2 is still to come
  // must not reveal what attempt 2 is about to ask.
  const revealAnswerKey = mayRevealAnswerKey({
    quiz,
    passed: history.some((a) => a.passed === true),
    canAttempt: allowance.canAttempt
  });

  const questions = (quiz?.quizQuestions || []).map((qq) => {
    const question = {
      ...qq.question,
      marks: qq.marks ?? qq.question?.marks ?? 1,
      order: qq.order
    };
    return revealAnswerKey ? question : stripAnswerKey(question);
  });

  // An attempt submitted before question-level tracking existed has no rows
  // to read, so its records are reconstructed from the answers it stored —
  // grading only, since a past attempt's visit and skip history was never
  // captured and cannot be invented. Nothing is written back: a submitted
  // attempt is immutable.
  const questionAttempts =
    selected.questionAttempts?.length > 0
      ? selected.questionAttempts
      : quiz
        ? buildQuestionAttemptRows(
            calculateSubmissionResult(quiz, parseStoredAnswers(selected.answers))
          )
        : [];

  return {
    id: selected.id,
    quizId,
    studentId,
    answers: selected.answers,
    score: selected.score,
    totalMarks: selected.totalMarks,
    percentage: selected.percentage,
    passed: selected.passed,
    submittedAt: selected.submittedAt,
    // Concept scores are only ever kept on the latest-attempt row.
    conceptScores: selected === latest ? submission?.conceptScores ?? null : null,
    attemptId: selected.id,
    attemptNumber: selected.attemptNumber,
    isLatestAttempt: selected === latest,
    timeTakenSeconds: selected.timeTakenSeconds ?? null,
    correctCount: selected.correctCount,
    incorrectCount: selected.incorrectCount,
    unansweredCount: selected.unansweredCount,
    totalQuestions: questions.length,
    // The question-level record of this attempt, and the tallies folded from
    // it — answered/unanswered/skipped/visited/correct/marks. Counted from
    // the records on every read, never from stored counters.
    questionAttempts,
    summary: summarizeQuestionAttempts(questionAttempts),
    // Present only for a QUALIFYING quiz: whether this attempt earned the
    // skip, and when it didn't, the concepts that went wrong and the content
    // to go back to. Null for an ordinary Self-Test or Final.
    qualification: quiz
      ? await buildQualificationOutcome(quiz, { ...selected, questionAttempts }, null, {
          allowance,
          history: history.map(toAttemptSummary)
        })
      : null,
    // True only once the answers are safe to show — false on a qualifying
    // test the student can still retake. The review UI reads this instead of
    // inferring it, so it never renders an answer column that isn't there.
    answerKeyRevealed: revealAnswerKey,
    attempts: history.map(toAttemptSummary),
    ...allowance,
    // The raw junction relation carries the UNSANITIZED question, so it would
    // hand back exactly what `questions` above just stripped.
    quiz: quiz
      ? { ...(revealAnswerKey ? quiz : (({ quizQuestions, ...rest }) => rest)(quiz)), questions }
      : null
  };
};

/**
 * Every quiz a student has attempted, one entry per quiz, most recent
 * activity first — the quiz half of the student Submissions page. Each
 * entry carries the latest attempt, the best percentage, the attempt
 * history and the student's remaining allowance.
 */
const getMyQuizSubmissions = async (studentId) => {
  const [logged, submissions] = await Promise.all([
    prisma.quizAttempt.findMany({
      where: { studentId },
      orderBy: { attemptNumber: "asc" },
      select: {
        id: true,
        quizId: true,
        attemptNumber: true,
        score: true,
        totalMarks: true,
        percentage: true,
        passed: true,
        timeTakenSeconds: true,
        submittedAt: true
      }
    }),
    prisma.quizSubmission.findMany({ where: { studentId } })
  ]);

  const historyByQuiz = new Map();
  for (const attempt of logged) {
    if (!historyByQuiz.has(attempt.quizId)) historyByQuiz.set(attempt.quizId, []);
    historyByQuiz.get(attempt.quizId).push(attempt);
  }
  // Quizzes last submitted before the attempt log existed.
  for (const submission of submissions) {
    if (!historyByQuiz.has(submission.quizId)) {
      historyByQuiz.set(submission.quizId, [legacySubmissionAsAttempt(submission)]);
    }
  }

  if (historyByQuiz.size === 0) return [];

  const quizzes = await prisma.quiz.findMany({
    where: { id: { in: [...historyByQuiz.keys()] } },
    select: {
      id: true,
      title: true,
      quizTag: true,
      passingScore: true,
      attempts: true,
      lessonId: true,
      course: { select: { id: true, title: true } },
      module: { select: { title: true } },
      lesson: { select: { title: true, module: { select: { title: true } } } },
      topic: {
        select: {
          lessonId: true,
          lesson: { select: { title: true, module: { select: { title: true } } } }
        }
      },
      _count: { select: { quizQuestions: true } }
    }
  });

  return quizzes
    .map((quiz) => {
      const history = historyByQuiz.get(quiz.id).map(toAttemptSummary);
      return {
        id: quiz.id,
        kind: "quiz",
        title: quiz.title,
        quizTag: quiz.quizTag,
        course: quiz.course,
        moduleTitle:
          quiz.module?.title || quiz.lesson?.module?.title || quiz.topic?.lesson?.module?.title || null,
        lessonTitle: quiz.lesson?.title || quiz.topic?.lesson?.title || null,
        lessonId: quiz.lessonId || quiz.topic?.lessonId || null,
        passingScore: quiz.passingScore,
        totalQuestions: quiz._count.quizQuestions,
        latestAttempt: history[history.length - 1],
        bestPercentage: Math.max(...history.map((a) => a.percentage)),
        attempts: history,
        ...buildAttemptAllowance(effectiveMaxAttempts(quiz), history.length)
      };
    })
    .sort(
      (a, b) => new Date(b.latestAttempt.submittedAt) - new Date(a.latestAttempt.submittedAt)
    );
};

/**
 * Instructor view of "which quizzes did this batch get, and who attempted
 * them" — the whole point of scoping quizzes by batch instead of just by
 * course. Pools submissions across the batch's current student roster only,
 * same join pattern as batch.service.js's getBatchDetailDashboard.
 */
const getBatchQuizzes = async (batchId) => {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: {
      students: {
        select: { id: true, user: { select: { id: true, name: true, email: true } } }
      }
    }
  });

  if (!batch) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  const students = batch.students;
  const studentIds = students.map((s) => s.id);

  const quizzes = await prisma.quiz.findMany({
    where: { batchId },
    include: { _count: { select: { quizQuestions: true } } },
    orderBy: { createdAt: "desc" }
  });

  const quizIds = quizzes.map((q) => q.id);

  const submissions =
    studentIds.length > 0 && quizIds.length > 0
      ? await prisma.quizSubmission.findMany({
          where: { quizId: { in: quizIds }, studentId: { in: studentIds } },
          select: {
            quizId: true,
            studentId: true,
            score: true,
            percentage: true,
            passed: true,
            submittedAt: true
          }
        })
      : [];

  const submissionByQuizAndStudent = new Map(
    submissions.map((s) => [`${s.quizId}:${s.studentId}`, s])
  );

  return quizzes.map((quiz) => {
    const studentResults = students.map((s) => {
      const submission = submissionByQuizAndStudent.get(`${quiz.id}:${s.id}`);
      return {
        studentId: s.id,
        name: s.user.name,
        email: s.user.email,
        attempted: Boolean(submission),
        score: submission?.score ?? null,
        percentage: submission?.percentage ?? null,
        passed: submission?.passed ?? null,
        submittedAt: submission?.submittedAt ?? null
      };
    });

    return {
      ...quiz,
      totalStudents: students.length,
      attemptedCount: studentResults.filter((s) => s.attempted).length,
      students: studentResults
    };
  });
};

const SELF_ASSESSMENT_QUIZ_TITLE = "Self-Generated Practice Quiz";

/**
 * Builds an ad-hoc practice quiz for a student from questions already used
 * anywhere in the course's real quizzes — no new question authoring, just a
 * random sample wrapped in a throwaway Quiz row so the existing attempt/
 * result flow (which expects a real quiz id) works unchanged.
 */
const generateSelfAssessmentQuiz = async (courseId, questionCount = 5) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });

  if (!course) {
    const error = new Error("Course not found");
    error.statusCode = 404;
    throw error;
  }

  const courseQuizQuestions = await prisma.quizQuestion.findMany({
    where: { quiz: { courseId } },
    select: { questionId: true },
    distinct: ["questionId"]
  });

  const questionIds = courseQuizQuestions.map((qq) => qq.questionId);

  if (questionIds.length === 0) {
    const error = new Error("No questions found in this course to generate a practice quiz.");
    error.statusCode = 404;
    throw error;
  }

  const shuffled = [...questionIds].sort(() => Math.random() - 0.5);
  const selectedIds = shuffled.slice(0, Math.max(1, Math.min(questionCount, shuffled.length)));

  return prisma.quiz.create({
    data: {
      title: SELF_ASSESSMENT_QUIZ_TITLE,
      description: "Auto-generated practice quiz from this course's question bank.",
      // Practice by construction, so never timed. This path writes through
      // Prisma directly and never sees createQuizSchema, hence the explicit tag.
      quizTag: "SELF_TEST",
      timeLimit: null,
      passingScore: 60,
      courseId,
      isPublished: true,
      status: "ACTIVE",
      quizQuestions: {
        create: selectedIds.map((questionId, index) => ({
          questionId,
          order: index + 1
        }))
      }
    }
  });
};

// Two-phase reorder: the same @@unique([...parentId, order]) partial index
// that content rows sit under rejects a naive parallel swap (A->2 while B
// still holds 2), so first move every row to a disjoint negative
// placeholder, then to its final order. Mirrors content.service.js's
// reorderContents exactly.
const reorderQuizzes = async (quizzes) => {
  // Course level only: a course quiz stays in the last group — it can never
  // be moved above a course content, module or assignment. Quizzes at every
  // other level are free.
  await assertCourseReorderAllowed("quiz", quizzes);

  const offsetUpdates = quizzes.map((quiz, index) =>
    prisma.quiz.update({
      where: { id: quiz.id },
      data: { order: -1000 - index }
    })
  );

  const finalUpdates = quizzes.map((quiz) =>
    prisma.quiz.update({
      where: { id: quiz.id },
      data: { order: quiz.order }
    })
  );

  return prisma.$transaction([...offsetUpdates, ...finalUpdates]);
};

module.exports = {
  evaluateAnswer,
  resolveMisconceptionTag,
  calculateSubmissionResult,
  resolveQuestionStatus,
  buildQuestionAttemptRows,
  summarizeQuestionAttempts,
  getQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  submitQuiz,
  getQuizResult,
  getMyQuizSubmissions,
  getBatchQuizzes,
  generateSelfAssessmentQuiz,
  flushPendingMisconceptionClassifications,
  flushPendingSubmissionSideEffects,
  reorderQuizzes
};