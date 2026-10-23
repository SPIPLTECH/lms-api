const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../../config/database");
const { sendEmail } = require("../../utils/mail");
const { otpEmail } = require("../../utils/emailTemplates");
const { authError } = require("../../utils/authErrors");
const sessionService = require("../sessions/session.service");
const { verifyGoogleIdToken } = require("./googleToken.service");
const { AUDIT_EVENTS, recordAuditEvent } = require("../audit/audit.service");
const { evaluatorSummaryForUser } = require("../evaluators/evaluator.service");

const REGISTER_OTP_MINUTES = 10;
const OTP_MINUTES = 5;

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const sendOtpEmail = async ({ to, name, otp, purpose, expiresInMinutes }) => {
  const { subject, html } = otpEmail({ purpose, otp, expiresInMinutes, name });
  await sendEmail(to, subject, html);
};
/**
 * Generate Access Token
 *
 * `sid` names the AuthSession this token belongs to; verifyToken checks that
 * row on every request, so the token is only as valid as its session (a
 * password change or reset ends the account's other sessions).
 */
const generateAccessToken = (user, sessionId) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      sid: sessionId
    },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn:
        process.env.ACCESS_TOKEN_EXPIRE || "1d"
    }
  );
};

/**
 * The response every successful sign-in returns. The refresh credential is
 * the session's opaque token (stored hashed); `deviceKey` is present only
 * when this sign-in issued the browser a new one.
 */
const buildSignInResult = async (user, { session, refreshToken, deviceKey }) => ({
  accessToken: generateAccessToken(user, session.id),
  refreshToken,
  ...(deviceKey ? { deviceKey } : {}),
  session: {
    id: session.id,
    expiresAt: session.expiresAt,
    absoluteExpiry: session.absoluteExpiry
  },
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    studentProfile: user.studentProfile,
    teacherProfile: user.teacherProfile,
    adminProfile: user.adminProfile,
    // Evaluator accounts only (null otherwise): access period and feedback status.
    evaluator: await evaluatorSummaryForUser(user.id)
  }
});

const recordLoginFailure = (userId, reasonCode, authMethod) =>
  recordAuditEvent({
    userId,
    eventType: AUDIT_EVENTS.LOGIN_FAILED,
    reasonCode,
    metadata: { authMethod }
  });


/**
 * Register User
 */
const register = async (data) => {
  const hashedPassword = await bcrypt.hash(data.password, 10);

  const otp = generateOTP();
  const expiry = new Date(Date.now() + REGISTER_OTP_MINUTES * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      phoneNumber: data.phoneNumber,
      address: data.address,
      password: hashedPassword,
      role: "STUDENT", // force default role
      otp,
      otpExpiresAt: expiry
    }
  });

  // NEW: create student profile automatically
  await prisma.studentProfile.create({
    data: {
      userId: user.id,
      phone: data.phoneNumber || null
    }
  });

  await sendOtpEmail({
    to: data.email,
    name: data.name,
    otp,
    purpose: "verify",
    expiresInMinutes: REGISTER_OTP_MINUTES
  });

  return {
    message: "OTP sent to email"
  };
};

const verifyOtp = async (email, otp) => {
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) throw new Error("User not found");

  if (user.otp !== otp)
    throw new Error("Invalid OTP");

  if (new Date() > user.otpExpiresAt)
    throw new Error("OTP expired");

  await prisma.user.update({
    where: { email },
    data: {
      isVerified: true,
      otp: null,
      otpExpiresAt: null
    }
  });

  return { message: " Verified" };
};
/**
 * Login User
 */
const login = async (
  email,
  password,
  { deviceKey = null, currentRefreshToken = null, userAgent = null } = {}
) => {
  const user = await prisma.user.findUnique({
  where: { email },
  include: {
    studentProfile: true,
    teacherProfile: true,
    adminProfile: true
  }
});

  if (!user) {
    await recordLoginFailure(null, "INVALID_CREDENTIALS", sessionService.AUTH_METHODS.PASSWORD);
    const error = new Error("Invalid credentials");
    error.statusCode = 401;
    throw error;
  }

  const isMatch =
    await bcrypt.compare(
      password,
      user.password
    );

  if (!isMatch) {
    await recordLoginFailure(user.id, "INVALID_CREDENTIALS", sessionService.AUTH_METHODS.PASSWORD);
    const error = new Error("Invalid credentials");
    error.statusCode = 401;
    throw error;
  }

  if (!user.isVerified) {
    throw new Error("Verify email first");
  }

  // Enforce account status — SUSPENDED/BLOCKED/INACTIVE accounts are denied
  // even if credentials are correct. This makes admin suspension effective.
  if (user.status !== "ACTIVE") {
    await recordLoginFailure(user.id, "ACCOUNT_SUSPENDED", sessionService.AUTH_METHODS.PASSWORD);
    throw authError("ACCOUNT_SUSPENDED");
  }

  // Every role may be signed in on several devices (config/accessPolicy.js);
  // this only rotates or replaces THIS device's own session.
  const created = await sessionService.createSession({
    userId: user.id,
    authMethod: sessionService.AUTH_METHODS.PASSWORD,
    deviceKey,
    currentRefreshToken,
    userAgent
  });

  // The legacy single refresh-token column is no longer read; clear the
  // plaintext JWT it held rather than leave it lying in the table.
  if (user.refreshToken) {
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: null } });
  }

  return buildSignInResult(user, created);
};

/**
 * Sign in with a Google ID token.
 *
 * Account policy (approved): Google sign-in works only for an existing LMS
 * user. The verified (issuer, sub) is the identity key:
 *  1. a linked identity resolves straight to its user;
 *  2. otherwise the account is found by the token's email, only when Google
 *     says that email is verified and exactly one LMS user has it
 *     (case-insensitively), and only if that user has no Google identity
 *     linked already — then (issuer, sub) is linked to it, once;
 *  3. anything else is 403 ACCOUNT_NOT_ALLOWED. No account is created.
 * After the first link, a later change of email on either side does not
 * move the identity to a different account.
 */
const loginWithGoogle = async (
  credential,
  { deviceKey = null, currentRefreshToken = null, userAgent = null, verify = verifyGoogleIdToken } = {}
) => {
  const GOOGLE = sessionService.AUTH_METHODS.GOOGLE;

  let identity;
  try {
    identity = await verify(credential);
  } catch (error) {
    if (error.code === "GOOGLE_TOKEN_INVALID") await recordLoginFailure(null, "GOOGLE_TOKEN_INVALID", GOOGLE);
    throw error;
  }

  const profileInclude = { studentProfile: true, teacherProfile: true, adminProfile: true };

  const linked = await prisma.userIdentity.findUnique({
    where: { issuer_subject: { issuer: identity.issuer, subject: identity.subject } },
    include: { user: { include: profileInclude } }
  });

  let user = linked?.user || null;

  if (!user) {
    if (!identity.emailVerified || !identity.email) {
      await recordLoginFailure(null, "GOOGLE_EMAIL_UNVERIFIED", GOOGLE);
      throw authError("ACCOUNT_NOT_ALLOWED");
    }

    const candidates = await prisma.user.findMany({
      where: { email: { equals: identity.email, mode: "insensitive" } },
      include: { ...profileInclude, identities: { where: { provider: "google" }, select: { id: true } } },
      take: 2
    });

    // Zero matches: no LMS account. Two: ambiguous — never guess.
    if (candidates.length !== 1) {
      await recordLoginFailure(null, candidates.length === 0 ? "NO_LINKED_ACCOUNT" : "AMBIGUOUS_EMAIL", GOOGLE);
      throw authError("ACCOUNT_NOT_ALLOWED");
    }

    const candidate = candidates[0];
    // Already linked to a different Google account: refuse rather than relink.
    if (candidate.identities.length > 0) {
      await recordLoginFailure(candidate.id, "LINKED_TO_OTHER_GOOGLE_ACCOUNT", GOOGLE);
      throw authError("ACCOUNT_NOT_ALLOWED");
    }

    if (candidate.status !== "ACTIVE") {
      await recordLoginFailure(candidate.id, "ACCOUNT_SUSPENDED", GOOGLE);
      throw authError("ACCOUNT_SUSPENDED");
    }

    try {
      await prisma.userIdentity.create({
        data: {
          userId: candidate.id,
          provider: "google",
          issuer: identity.issuer,
          subject: identity.subject,
          email: identity.email
        }
      });
    } catch (error) {
      // A concurrent first sign-in linked it already. Accept only if that
      // link points at this same user.
      if (error?.code !== "P2002") throw error;
      const winner = await prisma.userIdentity.findUnique({
        where: { issuer_subject: { issuer: identity.issuer, subject: identity.subject } }
      });
      if (winner?.userId !== candidate.id) throw authError("ACCOUNT_NOT_ALLOWED");
    }

    // Google has verified ownership of this email address, which is what the
    // LMS's own email OTP proves; an unverified LMS account is marked verified.
    if (!candidate.isVerified) {
      await prisma.user.update({ where: { id: candidate.id }, data: { isVerified: true } });
    }

    await recordAuditEvent({ userId: candidate.id, eventType: AUDIT_EVENTS.IDENTITY_LINKED, metadata: { provider: "google" } });
    const { identities, ...rest } = candidate;
    user = rest;
  } else {
    await prisma.userIdentity.update({ where: { id: linked.id }, data: { lastUsedAt: new Date() } });
  }

  if (user.status !== "ACTIVE") {
    await recordLoginFailure(user.id, "ACCOUNT_SUSPENDED", GOOGLE);
    throw authError("ACCOUNT_SUSPENDED");
  }

  const created = await sessionService.createSession({
    userId: user.id,
    authMethod: GOOGLE,
    deviceKey,
    currentRefreshToken,
    userAgent
  });

  return buildSignInResult(user, created);
};

/** 
 * Forgot Password
 */
const generateOTP = () => {
  return crypto.randomInt(100000, 1000000).toString();
};
const forgotPassword =
  async (email) => {
    const user =
      await prisma.user.findUnique({
        where: { email }
      });

    if (!user) {
      throw new Error(
        "User not found"
      );
    }
    if(!user.isVerified){
      throw new Error(
       "You are not verified");}
    const Newotp = generateOTP();
  
    await prisma.user.update({
      where: { id: user.id },
      data: {
        otp : Newotp,
        otpExpiresAt: new Date(Date.now() + OTP_MINUTES * 60 * 1000),
     
      }
    });
    await sendOtpEmail({
      to: email,
      name: user.name,
      otp: Newotp,
      purpose: "reset",
      expiresInMinutes: OTP_MINUTES
    });
     return {
     message: "OTP sent to email"
    };

  
  };

/**
 * Load the user for a password reset and check the emailed OTP. Shared by
 * verifyResetOtp (step 1, does not consume the OTP) and resetPassword (step 2).
 */
const findUserWithValidResetOtp = async (email, otp) => {
  const user =
    await prisma.user.findFirst({
      where: {
        email: email
      }
    });

  if (!user) {
    throw badRequest(
      "Invalid User"
    );
  }

  if (!user.otp || String(user.otp) !== String(otp)) {
    throw badRequest(
      "Invalid OTP"
    );
  }

  if (!user.otpExpiresAt || new Date() > new Date(user.otpExpiresAt)) {
    throw badRequest(
      "OTP expired"
    );
  }

  return user;
};

/**
 * Verify Reset OTP
 */
const verifyResetOtp = async (email, otp) => {
  await findUserWithValidResetOtp(email, otp);

  return {
    message: "OTP verified. You can now set a new password."
  };
};

/**
 * Reset Password
 */
const resetPassword =
  async (
    otp,
    email,
    newPassword
  ) => {
    const user =
      await findUserWithValidResetOtp(email, otp);

    const isSamePassword =
      await bcrypt.compare(
        newPassword,
        user.password
      );

    if (isSamePassword) {
      throw badRequest(
        "New password must be different from your previous password."
      );
    }

    const hashedPassword =
      await bcrypt.hash(
        newPassword,
        10
      );

    // The legacy refresh-token column is no longer read; clear it with the
    // new password.
    await prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        password: hashedPassword,
        refreshToken: null,
        otp: null,
        otpExpiresAt: null
      }
    });

    // A reset proves control of the email, not of the signed-in device. End
    // any session (and its playback lease) so whoever held the old password
    // is signed out, and the owner is not refused with SESSION_ALREADY_ACTIVE.
    await sessionService.revokeUserSessions(user.id, sessionService.END_REASONS.PASSWORD_RESET);

    return {
      message:
        "Password reset successfully"
    };
  };

/**
 * Refresh Access Token
 */
const refreshToken = async (token, deviceKey = null) => {
  if (!token) {
    throw authError("SESSION_INVALID", "Refresh token required");
  }

  // Enforces session status, idle/absolute expiry, device binding and the
  // account's status — a suspended user cannot refresh.
  const session = await sessionService.refreshSession({
    refreshToken: token,
    deviceKey
  });

  return {
    accessToken: generateAccessToken(session.user, session.id),
    role: session.user.role
  };
};

/**
 * Logout User
 *
 * Ends the caller's session (named by the access token's `sid`, or by the
 * refresh credential when the access token is gone) and its playback lease,
 * in one transaction. Idempotent: logging out twice is not an error.
 *
 * A failure to end it is NOT reported as success: the session would stay
 * ACTIVE, and with one session per account the user would be refused
 * everywhere while the client believed they had signed out.
 */
const logout = async ({ sessionId = null, refreshToken: token = null } = {}) => {
  try {
    await sessionService.logout({ sessionId, refreshToken: token });
  } catch (error) {
    console.warn("Logout could not end the session:", error?.message);
    throw authError("LOGOUT_FAILED");
  }

  return {
    success: true,
    message: "Logged out successfully"
  };
};
/**
 * Change Password (signed in). Every OTHER session of the account is signed
 * out, with its playback lease; the session making the change (`sessionId`)
 * stays signed in with its current credentials, so no new tokens are issued.
 */
const changePassword = async (
  userId,
  currentPassword,
  newPassword,
  { sessionId = null } = {}
) => {
  const user =
    await prisma.user.findUnique({
      where: { id: userId }
    });

  if (!user) {
    throw new Error("User not found");
  }

  const isMatch =
    await bcrypt.compare(
      currentPassword,
      user.password
    );

  if (!isMatch) {
    throw new Error(
      "Current password is incorrect"
    );
  }

  const isSamePassword =
    await bcrypt.compare(
      newPassword,
      user.password
    );

  if (isSamePassword) {
    throw badRequest(
      "New password must be different from your current password."
    );
  }

  const hashedPassword =
    await bcrypt.hash(
      newPassword,
      10
    );

  await prisma.user.update({
    where: { id: userId },
    data: {
      password: hashedPassword,
      refreshToken: null
    }
  });

  const ended = await sessionService.revokeOtherSessions(
    userId,
    sessionId,
    sessionService.END_REASONS.PASSWORD_CHANGED
  );

  return {
    message:
      "Password changed successfully",
    otherSessionsSignedOut: ended.length
  };
};
const resendVerification = async (email) => {
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (user.isVerified) {
    throw new Error("Email already verified");
  }

  const otp = generateOTP();
  const otpExpiry = new Date(
    Date.now() + OTP_MINUTES * 60 * 1000
  );

  await prisma.user.update({
    where: { email },
    data: {
      otp,
      otpExpiresAt: otpExpiry
    }
  });

  await sendOtpEmail({
    to: email,
    name: user.name,
    otp,
    purpose: "verify",
    expiresInMinutes: OTP_MINUTES
  });

  return {
    message:
      "Verification email sent successfully"
  };
};

const getProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      studentProfile: {
        select: {
          id: true,
          phone: true,
          education: true,
          guardianName: true,
          dateOfBirth: true,
        },
      },
      teacherProfile: true,
      adminProfile: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return { ...user, evaluator: await evaluatorSummaryForUser(user.id) };
};

module.exports = {
  register,
  login,
  loginWithGoogle,
  generateAccessToken,
  logout,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  refreshToken,
  changePassword,
  verifyOtp,
  resendVerification,
  getProfile
};