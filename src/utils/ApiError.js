class ApiError extends Error {
    constructor(statusCode, message, code = undefined, details = undefined) {
        super(message);

        this.statusCode = statusCode;
        this.status = statusCode;
        this.success = false;

        if (code) this.code = code;
        if (details) {
            if (Array.isArray(details)) {
                this.errors = details;
            } else if (typeof details === "object") {
                Object.assign(this, details);
            }
        }

        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = ApiError;