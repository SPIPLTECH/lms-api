const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");
const learnerModelService = require("../learner-model/learnerModel.service");
const { MISCONCEPTION_TAXONOMY, isKnownMisconceptionType } = require("../learner-model/misconceptionTaxonomy.config");
const misconceptionClassifier = require("../learner-model/misconceptionClassifier.service");
const { getNextOrder } = require("../contents/contentOrder.util");

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
    negativeMarks: qq.question?.negativeMarks ?? 0
  })) : [];
  
  const totalMarks = rawQuestions.reduce((sum, question) => sum + (question.marks || 1), 0);
  const answerMap = new Map((answers || []).map((ans) => [ans.questionId, ans.answer]));

  let score = 0;
  // Per-question correctness, kept alongside the aggregate score so callers
  // (the learner-model evidence bridge) can observe each answered question
  // individually instead of only the quiz-level pass/fail.
  const questionEvidence = [];

  rawQuestions.forEach((question) => {
    const answer = answerMap.get(question.id);

    if (answer !== undefined && answer !== null && answer !== "") {
      const qType = question.questionType || question.type;
      const scoreMultiplier = evaluateAnswer(answer, question.correctAnswer, qType);

      const questionMarks = question.marks !== undefined ? Number(question.marks) : 1;
      const negativeMarks = question.negativeMarks ? Number(question.negativeMarks) : 0;

      if (scoreMultiplier > 0) {
        score += scoreMultiplier * questionMarks;
      } else if (scoreMultiplier === 0 && negativeMarks > 0) {
        score -= negativeMarks;
      }

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
    questionEvidence
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

  // Students attempting the quiz should not receive the answer key up front.
  if (role === "STUDENT" || role === "GUEST") {
    allQuestions = allQuestions.map(
      ({ correctAnswer, explanation, ...rest }) => rest
    );
  }

  // A student also gets how many attempts they have left, so the attempt UI
  // can stop them before they answer instead of the submit being refused.
  const attemptStatus = studentId
    ? buildAttemptAllowance(effectiveMaxAttempts(quiz), await countAttemptsUsed(studentId, quizId))
    : undefined;

  return {
    ...quiz,
    questions: allQuestions,
    ...(attemptStatus && { attemptStatus })
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
const validateQuizScope = async ({ batchId, courseId, moduleId, lessonId, topicId }) => {
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
};

const QUIZ_PARENT_PRECEDENCE = ["topicId", "lessonId", "moduleId", "courseId"];

/** Most-specific non-null parent field on a quiz payload — courseId is
 * always present (schema-required), so this always resolves. Matches the
 * topic > lesson > module > course precedence this codebase already uses
 * elsewhere (validateQuizScope's nesting checks, the frontend's
 * isTopicQuiz/isLessonQuiz labeling). */
const resolveQuizParentField = (data) => QUIZ_PARENT_PRECEDENCE.find((f) => data[f]);

/** A Self-Test is never timed, and the server -- not the form -- owns that.
 * The *effective* tag decides, never the presence of a timeLimit key: a
 * client flipping FINAL -> SELF_TEST legitimately sends only { quizTag },
 * and the stale time limit still has to come off the row. */
const applyTagTimerRule = (effectiveTag, quizData) =>
  effectiveTag === "SELF_TEST" ? { ...quizData, timeLimit: null } : quizData;

/** Attempts follow the tag the same way. A Self-Test is practice and is
 * stored as unlimited (0). A Final always carries a real limit of at least
 * one: a blank or 0 request, or a quiz that was a Self-Test until this edit,
 * becomes 1. An edit that doesn't touch attempts leaves a Final's limit alone. */
const applyTagAttemptRule = (effectiveTag, quizData, existingAttempts) => {
  if (effectiveTag === "SELF_TEST") return { ...quizData, attempts: 0 };
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

  const { questions, ...quizData } = data;

  const orderField = resolveQuizParentField(quizData);
  if (quizData.order === undefined || quizData.order === null) {
    quizData.order = await getNextOrder(orderField, quizData[orderField]);
  } else {
    quizData.order = Number(quizData.order);
    const [collidingContent, collidingQuiz] = await Promise.all([
      prisma.content.findFirst({ where: { [orderField]: quizData[orderField], order: quizData.order }, select: { id: true } }),
      prisma.quiz.findFirst({ where: { [orderField]: quizData[orderField], order: quizData.order }, select: { id: true } }),
    ]);
    if (collidingContent || collidingQuiz) {
      quizData.order = await getNextOrder(orderField, quizData[orderField]);
    }
  }

  const quiz = await prisma.quiz.create({
    data: {
      ...applyTagAttemptRule(quizData.quizTag, applyTagTimerRule(quizData.quizTag, quizData)),
      moduleId: quizData.moduleId || null,
      lessonId: quizData.lessonId || null
    }
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
          link: `/courses/${quiz.courseId}/quizzes`
        },
        null,
        `quiz_published_${quiz.id}`
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

  return prisma.quiz.delete({
    where: {
      id: quizId
    }
  });
};

/** Quiz.attempts is how many attempts each student gets; 0 means unlimited. */
const isUnlimitedAttempts = (maxAttempts) => !(Number(maxAttempts) > 0);

/**
 * The limit that actually applies. A Self-Test can always be retaken whatever
 * is stored — rows saved before that rule still hold the schema default of 1.
 * A Final uses its stored limit (1 unless the instructor changed it).
 */
const effectiveMaxAttempts = (quiz) => (quiz.quizTag === "SELF_TEST" ? 0 : quiz.attempts);

/** Where a student stands against a quiz's attempt limit. */
const buildAttemptAllowance = (maxAttempts, attemptsUsed) => {
  const unlimited = isUnlimitedAttempts(maxAttempts);
  return {
    attemptsUsed,
    maxAttempts: unlimited ? null : maxAttempts,
    unlimitedAttempts: unlimited,
    attemptsRemaining: unlimited ? null : Math.max(0, maxAttempts - attemptsUsed),
    canAttempt: unlimited || attemptsUsed < maxAttempts
  };
};

/** Correct / incorrect / unanswered tallies for one graded attempt. */
const countAnswerOutcomes = (quiz, result) => {
  const totalQuestions = quiz.quizQuestions?.length ?? 0;
  const answered = result.questionEvidence.length;
  const correctCount = result.questionEvidence.filter((e) => e.isCorrect).length;
  return {
    correctCount,
    incorrectCount: answered - correctCount,
    unansweredCount: Math.max(0, totalQuestions - answered)
  };
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
    ? countAnswerOutcomes(quiz, calculateSubmissionResult(quiz, parseStoredAnswers(submission.answers)))
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

const submitQuiz = async (studentId, quizId, answers = [], timeTakenSeconds = null) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { quizQuestions: { include: { question: true } } }
  });

  if (!quiz) {
    const error = new Error("Quiz not found");
    error.statusCode = 404;
    throw error;
  }

  const result = calculateSubmissionResult(quiz, answers);
  const outcomes = countAnswerOutcomes(quiz, result);

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
          eventId: `quiz_submission_${submission.id}`
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
 * attemptId — plus the quiz's full question set (including answer keys) for
 * the result-review page, the student's whole attempt history, and their
 * remaining allowance. Unlike getQuizById, this always includes
 * correctAnswer/explanation — the student has already submitted, so there's
 * nothing left to protect. Null when there is no such attempt.
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
      orderBy: { attemptNumber: "asc" }
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

  const questions = (quiz?.quizQuestions || []).map((qq) => ({
    ...qq.question,
    marks: qq.marks ?? qq.question?.marks ?? 1,
    order: qq.order
  }));

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
    attempts: history.map(toAttemptSummary),
    ...buildAttemptAllowance(quiz ? effectiveMaxAttempts(quiz) : 0, history.length),
    quiz: quiz ? { ...quiz, questions } : null
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