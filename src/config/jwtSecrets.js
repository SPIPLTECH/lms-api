/**
 * Validates JWT signing secrets at process startup.
 *
 * Generate cryptographically strong 64-byte secrets with:
 *   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
 */

const MIN_SECRET_LENGTH = 32;

function validateJwtSecrets(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const baseSecret = typeof env.JWT_SECRET === "string" ? env.JWT_SECRET.trim() : undefined;
  const accessSecret = (env.JWT_ACCESS_SECRET || baseSecret || "").trim();
  const refreshSecret = (env.JWT_REFRESH_SECRET || baseSecret || "").trim();

  const missing = [];
  if (baseSecret === "") missing.push("JWT_SECRET");
  if (!accessSecret) missing.push("JWT_ACCESS_SECRET (or JWT_SECRET)");
  if (!refreshSecret) missing.push("JWT_REFRESH_SECRET (or JWT_SECRET)");

  if (missing.length > 0) {
    throw new Error(
      `[security] Missing required JWT signing secret(s): ${missing.join(", ")}.`
    );
  }

  const weak = [];
  if (baseSecret !== undefined && baseSecret.length < MIN_SECRET_LENGTH) {
    weak.push(`JWT_SECRET (length ${baseSecret.length} < ${MIN_SECRET_LENGTH})`);
  }
  if (accessSecret.length < MIN_SECRET_LENGTH) {
    weak.push(`JWT_ACCESS_SECRET (length ${accessSecret.length} < ${MIN_SECRET_LENGTH})`);
  }
  if (refreshSecret.length < MIN_SECRET_LENGTH) {
    weak.push(`JWT_REFRESH_SECRET (length ${refreshSecret.length} < ${MIN_SECRET_LENGTH})`);
  }

  if (weak.length > 0) {
    const message =
      `[security] Weak JWT secret(s) detected: ${weak.join(", ")}. ` +
      `Generate 64-byte random hex secrets before running in production.`;
    if (isProduction) {
      throw new Error(message);
    }
    console.warn(message);
    return { valid: false, warnings: weak };
  }

  return { valid: true, warnings: [] };
}

module.exports = {
  MIN_SECRET_LENGTH,
  validateJwtSecrets,
};
