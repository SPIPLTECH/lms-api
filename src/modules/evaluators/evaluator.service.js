const bcrypt = require("bcrypt");
const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const { sendEmail } = require("../../utils/mail");
const {
  EVALUATOR_ACCESS_MS,
  expiryFor,
  evaluatorState,
  loadAccess,
  forgetEvaluatorAccess,
} = require("../../utils/evaluatorAccess");
const config = require("./evaluator.config");
const feedbackSite = require("./feedbackSite.client");
const emailVerification = require("./emailVerification");

/** What the client is told about an evaluator account (null for everyone else). */
const evaluatorSummary = (access, now = Date.now()) => {
  if (!access) return null;
  return {
    ...evaluatorState(access, now),
    startsAt: access.startsAt,
    expiresAt: access.expiresAt,
    feedbackCompletedAt: access.feedbackCompletedAt,
    feedbackUrl: config.feedbackUrl(),
  };
};

/**
 * For login and the session profile. Re-reads the row (refreshing the
 * middleware's cache too). Never fails the caller: without it the client
 * just doesn't know yet, and the API still enforces access.
 */
const evaluatorSummaryForUser = async (userId) => {
  try {
    forgetEvaluatorAccess(userId);
    return evaluatorSummary(await loadAccess(userId));
  } catch (error) {
    console.warn("Evaluator summary unavailable:", error?.message);
    return null;
  }
};

const registrationInfo = () => ({
  open: config.registrationEnabled() && config.courseIds().length > 0 && Boolean(config.feedbackUrl()),
  accessHours: EVALUATOR_ACCESS_MS / (60 * 60 * 1000),
});

const assertRegistrationOpen = () => {
  if (!config.registrationEnabled()) {
    throw new ApiError(404, "Evaluator registration is not open.", "EVALUATOR_REGISTRATION_CLOSED");
  }
  const courseIds = config.courseIds();
  if (courseIds.length === 0 || !config.feedbackUrl()) {
    throw new ApiError(503, "Evaluator registration is not configured yet.", "EVALUATOR_NOT_CONFIGURED");
  }
  return courseIds;
};

const assertEmailFree = async (email) => {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new ApiError(409, "Email already registered.", "EMAIL_TAKEN");
};

/**
 * Step 1 of registration: email a 6-digit code. Nothing is stored — the
 * returned `challenge` is what verifyEmailCode checks the code against.
 */
const sendEmailCode = async (email) => {
  assertRegistrationOpen();
  await assertEmailFree(email);

  const { otp, challenge, expiresAt } = emailVerification.issueCode(email);
  try {
    await sendEmail(
      email,
      "Your Orange Tree LMS Evaluator Verification Code",
      `
      <h2>Orange Tree LMS</h2>
      <p>Your verification code is:</p>
      <h1>${otp}</h1>
      <p>Valid for ${emailVerification.OTP_VALID_MS / 60000} minutes. If you did not ask for this, ignore this email.</p>
      `
    );
  } catch (error) {
    console.warn("Evaluator verification email failed:", error?.message);
    throw new ApiError(502, "We couldn't send the verification email. Please try again.", "EMAIL_SEND_FAILED");
  }
  return { email, challenge, expiresAt };
};

/** Step 2: check the code; the token it returns is required by step 3. */
const verifyEmailCode = ({ email, otp, challenge }) => emailVerification.verifyCode(email, otp, challenge);

/**
 * Step 3: creates the account, its StudentProfile, its EvaluatorAccess row and
 * the C-CAT enrollments in one transaction: either all of it exists or none
 * of it does. Only for an email proven by step 2, so the account is created
 * already verified and nothing is ever stored for an unverified email.
 */
const registerEvaluator = async (data) => {
  const courseIds = assertRegistrationOpen();
  emailVerification.assertVerified(data.email, data.emailVerificationToken);
  await assertEmailFree(data.email);

  const hashedPassword = await bcrypt.hash(data.password, 10);
  const startsAt = new Date();
  const expiresAt = expiryFor(startsAt);

  const user = await prisma.$transaction(
    async (tx) => {
      // Same rule as enrollment.service createEnrollment: only published courses.
      const courses = await tx.course.findMany({
        where: { id: { in: courseIds }, status: "PUBLISHED" },
        select: { id: true },
      });
      if (courses.length !== courseIds.length) {
        throw new ApiError(
          503,
          "The evaluation courses are not available right now. Please try again later.",
          "EVALUATOR_COURSES_UNAVAILABLE"
        );
      }

      const created = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          phoneNumber: data.phoneNumber || null,
          password: hashedPassword,
          role: "STUDENT", // server-assigned, like /auth/register
          isVerified: true,
          studentProfile: { create: { phone: data.phoneNumber || null } },
          evaluatorAccess: { create: { startsAt, expiresAt } },
        },
        select: { id: true, email: true, studentProfile: { select: { id: true } } },
      });

      const studentId = created.studentProfile.id;
      await tx.enrollment.createMany({
        data: courseIds.map((courseId) => ({ studentId, courseId })),
        skipDuplicates: true,
      });
      const enrolled = await tx.enrollment.count({ where: { studentId, courseId: { in: courseIds } } });
      if (enrolled !== courseIds.length) {
        throw new ApiError(500, "Could not enroll the evaluator in the evaluation courses.", "EVALUATOR_ENROLLMENT_FAILED");
      }

      return created;
    },
    // The database is remote; the default 5s budget is tight for five statements.
    { maxWait: 10000, timeout: 20000 }
  );

  return { email: user.email, expiresAt };
};

const readAccessOrThrow = async (userId) => {
  const access = await prisma.evaluatorAccess.findUnique({ where: { userId } });
  if (!access) {
    throw new ApiError(404, "This is not an evaluator account.", "NOT_AN_EVALUATOR");
  }
  return access;
};

const getStatus = async (userId) => evaluatorSummary(await readAccessOrThrow(userId));

/**
 * Records verified feedback once. Repeating it (a second check, an admin
 * confirming an already-verified account) changes nothing.
 */
const markFeedbackComplete = async (userId, { submissionId = null, completedAt, verifiedBy }) => {
  try {
    await prisma.evaluatorAccess.updateMany({
      where: { userId, feedbackCompletedAt: null },
      data: { feedbackCompletedAt: completedAt, feedbackSubmissionId: submissionId, feedbackVerifiedBy: verifiedBy },
    });
  } catch (error) {
    if (error.code === "P2002") {
      throw new ApiError(
        409,
        "That feedback submission is already linked to another evaluator account.",
        "FEEDBACK_ALREADY_CLAIMED"
      );
    }
    throw error;
  }
  forgetEvaluatorAccess(userId);
  return readAccessOrThrow(userId);
};

/**
 * Asks the feedback site whether this evaluator has submitted. Only a
 * submission found there — same email as the account, made since
 * registration — counts; nothing the client sends does. Feedback is mostly
 * given once the 2 days are over, so the check stays open after expiry
 * (it never reopens learning access).
 */
const checkFeedback = async (userId) => {
  const access = await readAccessOrThrow(userId);
  if (access.feedbackCompletedAt) {
    return { ...evaluatorSummary(access), found: true };
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  let submission;
  try {
    submission = await feedbackSite.findSubmission({
      email: user.email,
      from: access.startsAt,
      to: new Date(),
    });
  } catch (error) {
    if (!(error instanceof feedbackSite.FeedbackSiteUnavailable)) throw error;
    console.warn("Evaluator feedback check failed:", error.message);
    throw new ApiError(
      503,
      "We couldn't reach the feedback site to confirm your submission. Please try again in a minute.",
      "FEEDBACK_SITE_UNAVAILABLE"
    );
  }

  if (!submission) {
    return { ...evaluatorSummary(access), found: false };
  }

  const updated = await markFeedbackComplete(userId, {
    submissionId: submission.id,
    completedAt: submission.submittedAt,
    verifiedBy: "FEEDBACK_SITE",
  });
  return { ...evaluatorSummary(updated), found: true };
};

module.exports = {
  evaluatorSummaryForUser,
  registrationInfo,
  sendEmailCode,
  verifyEmailCode,
  registerEvaluator,
  getStatus,
  checkFeedback,
};
