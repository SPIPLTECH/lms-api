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

  return res.status(statusCode).json(response);
};

module.exports = errorHandler;