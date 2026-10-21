const jwt = require("jsonwebtoken");

const authService = require("./auth.service");

/** What every sign-in needs to know about the calling browser. */
const signInContext = (req) => ({
  deviceKey: req.get("x-device-key") || null,
  // Proof of possession of this browser's current session, if it has one;
  // lets the same device re-authenticate without a 409 (see session.service).
  currentRefreshToken: req.body?.currentRefreshToken || null,
  userAgent: req.get("user-agent") || null
});

/**
 * The session id named by the Bearer token, if its signature is ours. Expiry
 * is ignored on purpose: logging out with an expired access token must still
 * end the session it belongs to.
 */
const sessionIdFromBearer = (req) => {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(
      header.slice(7),
      process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
      { ignoreExpiration: true }
    );
    return decoded?.sid || null;
  } catch {
    return null;
  }
};

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
        password,
        signInContext(req)
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
 * Google sign-in. The body carries only Google's ID token (`credential`);
 * identity comes from verifying it, never from client-supplied profile data.
 */
const googleLogin = async (req, res, next) => {
  try {
    const result = await authService.loginWithGoogle(
      req.body.credential,
      signInContext(req)
    );

    res.json({
      success: true,
      message: "Login successful",
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout
 */
const logout = async (req, res, next) => {
  try {
    const refreshToken = req.body?.refreshToken;

    await authService.logout({
      sessionId: sessionIdFromBearer(req),
      refreshToken
    });

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    // 503 LOGOUT_FAILED: the session may still be active, so the client must
    // not report a successful sign-out.
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
 * Verify Reset OTP — checks the code without consuming it, so the reset
 * screen can unlock the new-password step.
 */
const verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    const result = await authService.verifyResetOtp(email, otp);

    res.json({
      success: true,
      message: result.message
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
          refreshToken,
          req.get("x-device-key") || null
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
  googleLogin,
  logout,
  profile,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  refreshToken,
  changePassword,
  verifyOtp,
  resendVerification
};