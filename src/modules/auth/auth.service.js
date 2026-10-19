const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../../config/database");
const { sendEmail } = require("../../utils/mail");
const { otpEmail } = require("../../utils/emailTemplates");

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
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn:
        process.env.ACCESS_TOKEN_EXPIRE || "1d"
    }
  );
};

/**
 * Generate Refresh Token
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user.id
    },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn:
        process.env.REFRESH_TOKEN_EXPIRE || "7d"
    }
  );
};


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
  password
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
    const error = new Error(
      "Your account has been suspended. Please contact support."
    );
    error.statusCode = 403;
    throw error;
  }

  const accessToken =
    generateAccessToken(user);

  const refreshToken =
    generateRefreshToken(user);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      refreshToken
    }
  });

  return {
    accessToken,
    refreshToken,
    user: {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  studentProfile: user.studentProfile,
  teacherProfile: user.teacherProfile,
  adminProfile: user.adminProfile
}
    }
  
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

    await prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        password: hashedPassword,
        otp: null,
        otpExpiresAt: null
      }
    });

    return {
      message:
        "Password reset successfully"
    };
  };

/**
 * Refresh Access Token
 */
const refreshToken = async (token) => {
  try {
    if (!token) {
      const error = new Error("Refresh token required");
      error.statusCode = 401;
      throw error;
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET
    );

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.id
      }
    });

    if (!user || user.refreshToken !== token) {
      const error = new Error("Invalid refresh token");
      error.statusCode = 401;
      throw error;
    }

    const accessToken = generateAccessToken(user);

    return {
      accessToken
    };
  } catch (error) {
    const authErr = new Error(error.message || "Invalid refresh token");
    authErr.statusCode = 401;
    throw authErr;
  }
};

/**
 * Logout User
 */
const logout = async (userId, tokenFromReq) => {
  try {
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          refreshToken: null
        }
      }).catch((err) => {
        console.warn("Notice: Could not clear refreshToken by userId:", userId, err?.message);
      });
    } else if (tokenFromReq) {
      await prisma.user.updateMany({
        where: { refreshToken: tokenFromReq },
        data: {
          refreshToken: null
        }
      }).catch((err) => {
        console.warn("Notice: Could not clear refreshToken by token:", err?.message);
      });
    }
  } catch (error) {
    console.warn("Logout service handled exception:", error?.message);
  }

  return {
    success: true,
    message: "Logged out successfully"
  };
};
const changePassword = async (
  userId,
  currentPassword,
  newPassword
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
      password: hashedPassword
    }
  });

  return {
    message:
      "Password changed successfully"
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

  return user;
};

module.exports = {
  register,
  login,
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