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
    // Translate Prisma unique constraint violations (P2002) into
    // user-friendly 409 Conflict responses before passing to the
    // global error handler via next(). Using bare throw inside catch
    // causes unhandled promise rejections in Express 4 and is
    // fragile in Express 5.
    if (error.code === "P2002") {
      const field = error.meta?.target?.[0];
      const message =
        field === "email"
          ? "Email already registered."
          : field === "phoneNumber"
          ? "Phone number already registered."
          : "User already exists.";

      const conflictError = new Error(message);
      conflictError.statusCode = 409;
      return next(conflictError);
    }

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
const profile = async (req, res, next) => {
  try {
    const user = await authService.getProfile(req.user.id);

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Forgot Password
 */
const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    const result = await authService.verifyOtp(email, otp);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

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
        otp,
        email,
        newPassword
      } = req.body;

      const result =
        await authService.resetPassword(
          otp,
          email,
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
const changePassword = async (
  req,
  res,
  next
) => {
  try {
    const { currentPassword, newPassword } =
      req.body;

    const result =
      await authService.changePassword(
        req.user.id,
        currentPassword,
        newPassword
      );

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    next(error);
  }
};
const resendVerification = async (
  req,
  res,
  next
) => {
  try {
    const { email } = req.body;

    const result =
      await authService.resendVerification(
        email
      );

    res.status(200).json({
      success: true,
      message: result.message
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
  forgotPassword,
  resetPassword,
  refreshToken,
  changePassword,
  verifyOtp,
  resendVerification
};