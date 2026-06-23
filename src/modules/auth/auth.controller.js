const authService = require("./auth.service");

/**
 * Register
 */
const register = async (
  req,
  res,
  next
) => {
  try {
    const user =
      await authService.register(
        req.body
      );

    res.status(201).json({
      success: true,
      message:
        "User registered successfully",
      data: user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login
 */
const login = async (
  req,
  res,
  next
) => {
  try {
    const { email, password } =
      req.body;

    const result =
      await authService.login(
        email,
        password
      );

    res.json({
      success: true,
      message:
        "Login successful",
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout
 */
const logout = async (
  req,
  res,
  next
) => {
  try {
    const result =
      await authService.logout(
        req.user.id
      );

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Profile
 */
const profile = async (
  req,
  res
) => {
  res.json({
    success: true,
    data: req.user
  });
};

/**
 * Verify Email
 */
// const verifyEmail =
//   async (
//     req,
//     res,
//     next
//   ) => {
//     try {
//       const { token } =
//         req.params;

//       const result =
//         await authService.verifyEmail(
//           token
//         );

//       res.json({
//         success: true,
//         message:
//           result.message
//       });
//     } catch (error) {
//       next(error);
//     }
//   };

/**
 * Forgot Password
 */
const forgotPassword =
  async (
    req,
    res,
    next
  ) => {
    try {
      const { email } =
        req.body;

      const result =
        await authService.forgotPassword(
          email
        );

      res.json({
        success: true,
        message:
          result.message,
        data: result
      });
    } catch (error) {
      next(error);
    }
  };

/**
 * Reset Password
 */
const resetPassword =
  async (
    req,
    res,
    next
  ) => {
    try {
      const {
        token,
        newPassword
      } = req.body;

      const result =
        await authService.resetPassword(
          token,
          newPassword
        );

      res.json({
        success: true,
        message:
          result.message
      });
    } catch (error) {
      next(error);
    }
  };

/**
 * Refresh Token
 */
const refreshToken =
  async (
    req,
    res,
    next
  ) => {
    try {
      const { refreshToken } =
        req.body;

      const result =
        await authService.refreshToken(
          refreshToken
        );

      res.json({
        success: true,
        message:
          "Token refreshed successfully",
        data: result
      });
    } catch (error) {
      next(error);
    }
  };

module.exports = {
  register,
  login,
  logout,
  profile,
  //verifyEmail,
  forgotPassword,
  resetPassword,
  refreshToken
};