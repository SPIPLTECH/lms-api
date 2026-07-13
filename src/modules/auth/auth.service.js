const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../../config/database");
const { sendEmail } = require("../../utils/mail");
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
  const expiry = new Date(Date.now() + 10 * 60 * 1000);

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

  await sendEmail(
    data.email,
    "Verify Your Account",
    `
    <h2>Orange Tree LMS</h2>
    <p>Your OTP is:</p>
    <h1>${otp}</h1>
    <p>Valid for 5 minutes</p>
    `
  );

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
  return Math.floor(100000 + Math.random() * 900000).toString();
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
       "Yo are not verified");}
    const Newotp = generateOTP();
  
    await prisma.user.update({
      where: { id: user.id },
      data: {
        otp : Newotp,
        otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
     
      }
    });
    await sendEmail(
     email,
     "OTP for Update password of Your Account",
  `
    <h2>Orange Tree LMS</h2>
    <p>Your OTP is:</p>
    <h1>${Newotp}</h1>
    <p>Valid for 5 minutes</p>
  `
     );
     return {
     message: "OTP sent to email"
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
      await prisma.user.findFirst({
        where: {
          email:email
        }
      });

    if (!user) {
      throw new Error(
        "Invalid User"
      );
    }

    if(otp!=user.otp)
    {
      throw new Error(
        "Invalid OTP"
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
        password:
          hashedPassword,
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
const refreshToken =
  async (token) => {
    try {
      const decoded =
        jwt.verify(
          token,
          process.env
            .JWT_REFRESH_SECRET
        );

      const user =
        await prisma.user.findUnique(
          {
            where: {
              id: decoded.id
            }
          }
        );

      if (
        !user ||
        user.refreshToken !==
          token
      ) {
        throw new Error(
          "Invalid refresh token"
        );
      }

      const accessToken =
        generateAccessToken(
          user
        );

      return {
        accessToken
      };
    } catch (error) {
      throw new Error(
        "Invalid refresh token"
      );
    }
  };

/**
 * Logout User
 */
const logout = async (
  userId
) => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      refreshToken: null
    }
  });

  return {
    message:
      "Logged out successfully"
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
    Date.now() + 5 * 60 * 1000
  );

  await prisma.user.update({
    where: { email },
    data: {
      otp,
      otpExpiresAt: otpExpiry
    }
  });

  await sendEmail(
    email,
    "Verify Your Orange Tree LMS Account",
    `
    <h2>Orange Tree LMS</h2>
    <p>Your verification OTP:</p>
    <h1>${otp}</h1>
    <p>Valid for 5 minutes</p>
    `
  );

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
  resetPassword,
  refreshToken,
  changePassword,
  verifyOtp,
  resendVerification,
  getProfile
};