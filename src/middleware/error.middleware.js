const { isPublicErrorCode } = require("../utils/authErrors");

const errorHandler = (err, req, res, next) => {
  console.error(err);

  const statusCode = err.statusCode || err.status || 500;

  const response = {
    success: false,
    message: err.message || "Internal Server Error"
  };

  if (err.code !== undefined) response.code = err.code;
  if (err.hasStudentData !== undefined) response.hasStudentData = err.hasStudentData;
  if (err.errors !== undefined) response.errors = err.errors;

  // Stable application codes (SESSION_ALREADY_ACTIVE, …) are also given in
  // the `error` object the sign-in/playback contract specifies, with the
  // request's correlation id. The top-level fields above are unchanged.
  if (isPublicErrorCode(err.code)) {
    response.error = { code: err.code, message: response.message, requestId: req.requestId };
  }

  return res.status(statusCode).json(response);
};

module.exports = errorHandler;