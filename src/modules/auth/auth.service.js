const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../../config/database");
// const {
//   sendVerificationEmail
// } = require("../../services/email.service");

// console.log(
//   "sendVerificationEmail:",
//   sendVerificationEmail
// );


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

  const token = crypto.randomBytes(32).toString("hex");

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      phoneNumber : data.phoneNumber,
      address : data.address,
      password: hashedPassword,
    
    }
  });

  // await sendVerificationEmail(user.email, token);

  // return {
  //   message:
  //     "Registration successful."
  // };
};
/**
 * Login User
 */
const login = async (
  email,
  password
) => {
  const user =
    await prisma.user.findUnique({
      where: { email }
    });

  if (!user) {
    throw new Error(
      "Invalid credentials"
    );
  }

  const isMatch =
    await bcrypt.compare(
      password,
      user.password
    );

  if (!isMatch) {
    throw new Error(
      "Invalid credentials"
    );
  }

  // if (
  //   user.isVerified === false
  // ) {
  //   throw new Error(
  //     "Please verify your email first"
  //   );
  // }

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
      role: user.role
    }
  };
};

/**
 * Verify Email
 */
// const verifyEmail = async (req, res) => {
//   const { token } = req.query;

//   const user = await prisma.user.findFirst({
//     where: {
//       verificationToken: token
//     }
//   });

//   if (!user) {
//     return res.status(400).json({
//       message: "Invalid token"
//     });
//   }

//   await prisma.user.update({
//     where: { id: user.id },
//     data: {
//       isEmailVerified: true,
//       verificationToken: null
//     }
//   });

//   res.json({
//     message: "Email verified successfully"
//   });
// };
/**
 * Forgot Password
 */
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

    const resetToken =
      crypto.randomBytes(32)
        .toString("hex");

    const resetExpiry =
      new Date(
        Date.now() +
          15 * 60 * 1000
      );

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken:
          resetToken,
        resetPasswordExpires:
          resetExpiry
      }
    });

    return {
      message:
        "Password reset token generated",
      resetToken
    };
  };

/**
 * Reset Password
 */
const resetPassword =
  async (
    token,
    newPassword
  ) => {
    const user =
      await prisma.user.findFirst({
        where: {
          resetPasswordToken:
            token,
          resetPasswordExpires:
            {
              gt: new Date()
            }
        }
      });

    if (!user) {
      throw new Error(
        "Invalid or expired token"
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
        resetPasswordToken:
          null,
        resetPasswordExpires:
          null
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

module.exports = {
  register,
  login,
  logout,
  //verifyEmail,
  forgotPassword,
  resetPassword,
  refreshToken
};