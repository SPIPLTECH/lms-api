const evaluatorService = require("./evaluator.service");

const registrationInfo = (req, res) => {
  res.json({ success: true, data: evaluatorService.registrationInfo() });
};

const register = async (req, res, next) => {
  try {
    const result = await evaluatorService.registerEvaluator(req.body);
    res.status(201).json({
      success: true,
      message: result.emailSent
        ? "Evaluator account created. Check your email for the verification code."
        : "Evaluator account created, but the verification email could not be sent. Use Resend on the next screen.",
      data: result,
    });
  } catch (error) {
    // Same translation as /auth/register. An existing account can't register
    // again, so the access period can't be restarted this way either.
    if (error.code === "P2002") {
      const field = error.meta?.target?.[0];
      const conflictError = new Error(
        field === "email"
          ? "Email already registered."
          : field === "phoneNumber"
          ? "Phone number already registered."
          : "User already exists."
      );
      conflictError.statusCode = 409;
      return next(conflictError);
    }
    next(error);
  }
};

const status = async (req, res, next) => {
  try {
    res.json({ success: true, data: await evaluatorService.getStatus(req.user.id) });
  } catch (error) {
    next(error);
  }
};

const checkFeedback = async (req, res, next) => {
  try {
    const data = await evaluatorService.checkFeedback(req.user.id);
    res.json({
      success: true,
      message: data.found
        ? "Your feedback has been recorded."
        : "We haven't found a feedback submission for your email yet.",
      data,
    });
  } catch (error) {
    next(error);
  }
};

const adminConfirmFeedback = async (req, res, next) => {
  try {
    const data = await evaluatorService.adminConfirmFeedback(req.body.email, req.user.id);
    res.json({ success: true, message: "Feedback confirmed.", data });
  } catch (error) {
    next(error);
  }
};

module.exports = { registrationInfo, register, status, checkFeedback, adminConfirmFeedback };
