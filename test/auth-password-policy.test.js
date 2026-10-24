const test = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcrypt");

const prisma = require("../src/config/database");

// auth.service destructures sendEmail at require time, so stub it first.
const mail = require("../src/utils/mail");
const sentEmails = [];
mail.sendEmail = async (to, subject, html) => {
  sentEmails.push({ to, subject, html });
};

const authService = require("../src/modules/auth/auth.service");
const sessionService = require("../src/modules/sessions/session.service");
const {
  registerSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyResetOtpSchema,
} = require("../src/modules/auth/auth.validation");
const { PASSWORD_REGEX } = require("../src/modules/auth/password.policy");
const { otpEmail } = require("../src/utils/emailTemplates");

const STRONG = "Str0ng!Pass";
const OTHER_STRONG = "An0ther#Pass";

const stubUser = (user) => {
  const originals = {
    findFirst: prisma.user.findFirst,
    findUnique: prisma.user.findUnique,
    update: prisma.user.update,
  };
  const updates = [];
  prisma.user.findFirst = async () => user;
  prisma.user.findUnique = async () => user;
  prisma.user.update = async (args) => {
    updates.push(args);
    return user;
  };
  return {
    updates,
    restore() {
      Object.assign(prisma.user, originals);
    },
  };
};

const resetUser = async (password = STRONG) => ({
  id: "user-1",
  name: "Asha",
  email: "asha@example.com",
  password: await bcrypt.hash(password, 4),
  otp: "123456",
  otpExpiresAt: new Date(Date.now() + 60_000),
  isVerified: true,
});

// ---------------------------------------------------------------- regex

test("password regex accepts a policy-compliant password", () => {
  for (const pw of [STRONG, OTHER_STRONG, "Aa1!aaaa", "P@ssw0rd_2026"]) {
    assert.ok(PASSWORD_REGEX.test(pw), pw);
  }
});

test("password regex rejects passwords missing a required class", () => {
  const cases = {
    "too short": "Aa1!aaa",
    "no uppercase": "str0ng!pass",
    "no lowercase": "STR0NG!PASS",
    "no digit": "Strong!Pass",
    "no special": "Str0ngPass1",
    "contains space": "Str0ng! Pass",
    "too long": "Aa1!" + "a".repeat(125),
  };
  for (const [why, pw] of Object.entries(cases)) {
    assert.ok(!PASSWORD_REGEX.test(pw), why);
  }
});

test("register and reset schemas enforce the policy", () => {
  const weak = "password123";
  assert.ok(
    registerSchema.validate({ name: "Asha", email: "a@b.co", password: weak }).error
  );
  assert.ok(
    !registerSchema.validate({ name: "Asha", email: "a@b.co", password: STRONG }).error
  );
  assert.ok(
    resetPasswordSchema.validate({ email: "a@b.co", otp: "123456", newPassword: weak }).error
  );
});

test("change-password schema rejects a new password equal to the current one", () => {
  const { error } = changePasswordSchema.validate({
    currentPassword: STRONG,
    newPassword: STRONG,
  });
  assert.ok(error);
  assert.match(error.details[0].message, /different from your current password/);

  assert.ok(
    !changePasswordSchema.validate({ currentPassword: STRONG, newPassword: OTHER_STRONG }).error
  );
});

test("verify-reset-otp schema requires a 6-digit OTP", () => {
  assert.ok(verifyResetOtpSchema.validate({ email: "a@b.co", otp: "12345" }).error);
  assert.ok(!verifyResetOtpSchema.validate({ email: "a@b.co", otp: "123456" }).error);
});

// ---------------------------------------------------------------- service

test("verifyResetOtp accepts a valid OTP without consuming it", async () => {
  const user = await resetUser();
  const stub = stubUser(user);
  try {
    const result = await authService.verifyResetOtp(user.email, "123456");
    assert.match(result.message, /verified/i);
    assert.equal(stub.updates.length, 0, "OTP must not be cleared at step 1");
  } finally {
    stub.restore();
  }
});

test("verifyResetOtp rejects a wrong or expired OTP with 400", async () => {
  const user = await resetUser();
  const stub = stubUser(user);
  try {
    await assert.rejects(authService.verifyResetOtp(user.email, "000000"), {
      message: "Invalid OTP",
      statusCode: 400,
    });
    user.otpExpiresAt = new Date(Date.now() - 1000);
    await assert.rejects(authService.verifyResetOtp(user.email, "123456"), {
      message: "OTP expired",
      statusCode: 400,
    });
  } finally {
    stub.restore();
  }
});

test("resetPassword rejects reusing the previous password", async () => {
  const user = await resetUser(STRONG);
  const stub = stubUser(user);
  try {
    await assert.rejects(authService.resetPassword("123456", user.email, STRONG), {
      statusCode: 400,
      message: /different from your previous password/,
    });
    assert.equal(stub.updates.length, 0);
  } finally {
    stub.restore();
  }
});

test("resetPassword stores a new password, clears the OTP and ends the account's session", async () => {
  const user = await resetUser(STRONG);
  const stub = stubUser(user);
  // Since F-04 a reset also revokes the account's sessions; stubbed so this
  // test stays database-free.
  const originalRevoke = sessionService.revokeUserSessions;
  const revoked = [];
  sessionService.revokeUserSessions = async (userId, reason) => {
    revoked.push([userId, reason]);
    return [];
  };
  try {
    await authService.resetPassword("123456", user.email, OTHER_STRONG);
    assert.equal(stub.updates.length, 1);
    const { data } = stub.updates[0];
    assert.equal(data.otp, null);
    assert.ok(await bcrypt.compare(OTHER_STRONG, data.password));
    assert.deepEqual(revoked, [[user.id, "PASSWORD_RESET"]]);
  } finally {
    stub.restore();
    sessionService.revokeUserSessions = originalRevoke;
  }
});

test("changePassword rejects a new password equal to the current one", async () => {
  const user = await resetUser(STRONG);
  const stub = stubUser(user);
  try {
    await assert.rejects(authService.changePassword(user.id, STRONG, STRONG), {
      statusCode: 400,
      message: /different from your current password/,
    });
    assert.equal(stub.updates.length, 0);
  } finally {
    stub.restore();
  }
});

test("forgotPassword sends the branded reset email", async () => {
  const user = await resetUser();
  const stub = stubUser(user);
  sentEmails.length = 0;
  try {
    await authService.forgotPassword(user.email);
    assert.equal(sentEmails.length, 1);
    const [email] = sentEmails;
    assert.equal(email.subject, "Your Orange Tree LMS password reset code");
    const otp = stub.updates[0].data.otp;
    assert.ok(email.html.includes(otp));
    assert.ok(email.html.includes("Hi Asha,"));
    assert.ok(email.html.includes("5 minutes"));
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------- template

test("otpEmail renders purpose-specific copy and escapes the name", () => {
  const verify = otpEmail({
    purpose: "verify",
    otp: "654321",
    expiresInMinutes: 10,
    name: "<script>x</script>",
  });
  assert.equal(verify.subject, "Verify your Orange Tree LMS account");
  assert.ok(verify.html.includes("Verify your email address"));
  assert.ok(verify.html.includes("654321"));
  assert.ok(verify.html.includes("10 minutes"));
  assert.ok(!verify.html.includes("<script>"));
  assert.ok(verify.html.includes("&lt;script&gt;"));

  const reset = otpEmail({ purpose: "reset", otp: "111222", expiresInMinutes: 5 });
  assert.ok(reset.html.includes("Reset your password"));
  assert.ok(reset.html.includes("Hi there,"));

  assert.throws(() => otpEmail({ purpose: "nope", otp: "1", expiresInMinutes: 1 }));
});
