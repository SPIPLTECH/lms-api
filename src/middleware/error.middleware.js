const { isPublicErrorCode } = require("../utils/authErrors");

const RUNTIME_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];

/**
 * An error nobody raised on purpose: a database or runtime failure, or an
 * outbound HTTP call that failed. Its message describes our internals (the
 * Prisma query, file paths on the server, an upstream URL), so the client
 * gets a generic message and the request id instead; the log keeps it all.
 * Errors the code raises itself — an explicit status, or a plain Error with
 * a message meant for the user — are passed through as before.
 */
const isInternalError = (err) =>
  !(err.statusCode || err.status) &&
  (String(err.name || "").startsWith("PrismaClient") ||
    err.isAxiosError === true ||
    RUNTIME_ERRORS.some((type) => err instanceof type));

const errorHandler = (err, req, res, next) => {
  console.error(err);

  const statusCode = err.statusCode || err.status || 500;

  const response = {
    success: false,
    message: isInternalError(err)
      ? "Something went wrong on our side. Please try again."
      : err.message || "Internal Server Error"
  };
  if (isInternalError(err) && req.requestId) response.requestId = req.requestId;

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