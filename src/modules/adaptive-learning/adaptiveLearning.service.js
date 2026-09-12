const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const learnerModelService = require("../learner-model/learnerModel.service");
const { evaluateAnswer } = require("../quizzes/quiz.service");
const { buildPedagogicalPrompt } = require("./pedagogicalPrompt.builder");
const {
  buildVerificationQuestionPrompt,
  verificationQuestionOutputSchema,
  parseVerificationQuestionResponse,
} = require("./verificationQuestion.builder");
const { signVerificationToken, verifyVerificationToken } = require("./verificationToken.service");
const llmService = require("../llm/llm.service");

/**
 * Resolves server-trusted educational context (question text/options/correctAnswer
 * and the calling student's own answer, if any) for a quizId+questionId pair.
 */
const resolveEducationalContext = async ({ callingUser, quizId, questionId }) => {
  try {
    const [studentProfile, question, link] = await Promise.all([
      prisma.studentProfile.findUnique({ where: { userId: callingUser.id } }),
      prisma.question.findUnique({ where: { id: questionId } }),
      prisma.quizQuestion.findUnique({ where: { quizId_questionId: { quizId, questionId } } }),
    ]);

    if (!studentProfile || !question || !link) {
      return null;
    }

    const submission = await prisma.quizSubmission.findUnique({
      where: { studentId_quizId: { studentId: studentProfile.id, quizId } },
    });

    const matchedAnswer = Array.isArray(submission?.answers)
      ? submission.answers.find((a) => a && a.questionId === questionId)
      : null;

    return {
      questionId,
      questionText: question.question,
      questionType: question.questionType,
      options: question.options,
      correctAnswer: question.correctAnswer,
      studentAnswer: matchedAnswer ? matchedAnswer.answer : null,
    };
  } catch (error) {
    console.error(
      `Educational context resolution failed: quizId=${quizId}, questionId=${questionId}`,
      error
    );
    return null;
  }
};

/**
 * Shared preparation step for respond and respondStream.
 */
const prepareGeneration = async ({ callingUser, data = {} }) => {
  const decision = await learnerModelService.getPedagogicalDecision({
    callingUser,
    data: {
      kc: data.kc,
      hasNextTarget: data.hasNextTarget,
      courseId: data.courseId,
    },
  });

  const educationalContext =
    data.quizId && data.questionId
      ? await resolveEducationalContext({ callingUser, quizId: data.quizId, questionId: data.questionId })
      : null;

  const { systemPrompt, prompt, context } = buildPedagogicalPrompt({
    decision,
    studentMessage: data.message,
    educationalContext,
  });

  return { decision, systemPrompt, prompt, context };
};

const buildResponsePayload = (decision, llmResult) => ({
  strategy: decision.strategy,
  reason: decision.reason,
  priority: decision.priority,
  kc: decision.kc,
  response: llmResult.response,
  model: llmResult.model,
  thinkingEnabled: llmResult.thinkingEnabled,
  usage: llmResult.usage,
  latency: llmResult.latency,
});

/**
 * Buffered LLM response generation.
 */
const respond = async ({ callingUser, data = {} }) => {
  const { decision, systemPrompt, prompt, context } = await prepareGeneration({ callingUser, data });

  const llmResult = await llmService.generate({
    systemPrompt,
    prompt,
    context,
    think: false,
  });

  return buildResponsePayload(decision, llmResult);
};

/**
 * Streaming LLM response generation.
 */
const respondStream = async ({ callingUser, data = {}, onToken, signal }) => {
  const { decision, systemPrompt, prompt, context } = await prepareGeneration({ callingUser, data });

  const llmResult = await llmService.generateStream({
    systemPrompt,
    prompt,
    context,
    think: false,
    onToken,
    signal,
  });

  return buildResponsePayload(decision, llmResult);
};

/**
 * Generates ONE diagnostic verification / concept check question.
 */
const generateVerificationQuestion = async ({ callingUser, data = {} }) => {
  const decision = await learnerModelService.getPedagogicalDecision({
    callingUser,
    data: { kc: data.kc, hasNextTarget: false, courseId: data.courseId },
  });

  const educationalContext =
    data.quizId && data.questionId
      ? await resolveEducationalContext({ callingUser, quizId: data.quizId, questionId: data.questionId })
      : null;

  const misconceptionHypothesis = data.misconception || decision.misconception?.hypothesis || null;

  const { systemPrompt, prompt } = buildVerificationQuestionPrompt({
    decision,
    educationalContext,
    targetKc: data.kc,
    misconception: misconceptionHypothesis,
  });

  const llmResult = await llmService.generate({ systemPrompt, prompt, think: false });
  const parsed = parseVerificationQuestionResponse(llmResult.response);

  const { error, value } = verificationQuestionOutputSchema.validate(parsed || {});
  if (error) {
    throw new ApiError(502, "Failed to generate a verification question. Please try again.");
  }

  const normalizedOptions = value.options.map((opt) => opt.trim());
  const uniqueOptionCount = new Set(normalizedOptions.map((opt) => opt.toLowerCase())).size;
  if (uniqueOptionCount !== 4) {
    throw new ApiError(502, "Failed to generate a valid verification question. Please try again.");
  }

  const correctAnswer = normalizedOptions[value.correctAnswerIndex];

  const purpose = data.purpose || (decision.strategy === "CONCEPT_REMEDIATION" ? "CONCEPT_REMEDIATION_CHECK" : "REMEDIATION_CHECK");

  const verificationToken = signVerificationToken({
    kc: data.kc,
    correctAnswer,
    courseId: data.courseId || null,
    parentQuestionId: data.questionId || null,
    misconception: misconceptionHypothesis,
    purpose,
  });

  return {
    question: value.question.trim(),
    options: normalizedOptions,
    type: "MCQ_SINGLE",
    kc: data.kc,
    purpose,
    verificationToken,
  };
};

/**
 * Scores a verification / concept check answer server-side, records evidence, and re-evaluates decision.
 */
const evaluateVerificationAnswer = async ({ callingUser, data = {} }) => {
  const claims = verifyVerificationToken(data.verificationToken);

  const score = evaluateAnswer(data.selectedAnswer, claims.correctAnswer, "MCQ_SINGLE");
  const isCorrect = score >= 1;

  const evidencePurpose = claims.purpose || "REMEDIATION_CHECK";

  await learnerModelService.recordEvidence({
    callingUser,
    data: {
      kc: claims.kc,
      score,
      isCorrect,
      courseId: claims.courseId || undefined,
      ...(claims.misconception ? { misconceptionHypothesis: claims.misconception } : {}),
      metadata: {
        purpose: evidencePurpose,
        parentQuestionId: claims.parentQuestionId,
        misconception: claims.misconception,
      },
    },
  });

  const nextDecision = await learnerModelService.getPedagogicalDecision({
    callingUser,
    data: { kc: claims.kc, hasNextTarget: false, courseId: claims.courseId || undefined },
  });

  return {
    isCorrect,
    correctAnswer: claims.correctAnswer,
    kc: claims.kc,
    nextDecision,
  };
};

module.exports = {
  respond,
  respondStream,
  generateVerificationQuestion,
  evaluateVerificationAnswer,
};
