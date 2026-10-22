/**
 * Evaluator feature configuration — all from the environment, read per call
 * so a changed value needs no code change.
 *
 *   EVALUATOR_REGISTRATION_ENABLED  "true" opens POST /evaluators/register.
 *                                   Anything else keeps it closed (existing
 *                                   evaluators are still enforced).
 *   EVALUATOR_COURSE_IDS            Comma-separated course ids every new
 *                                   evaluator is enrolled in (C-CAT Section A
 *                                   and Section B).
 *   EVALUATOR_FEEDBACK_URL          The independent feedback site evaluators
 *                                   are sent to. Unset: no feedback link is
 *                                   shown and registration stays closed.
 *   EVALUATOR_FEEDBACK_API_URL      The feedback site's API base. Defaults to
 *                                   <EVALUATOR_FEEDBACK_URL>/api.
 *   EVALUATOR_FEEDBACK_ADMIN_USERNAME / EVALUATOR_FEEDBACK_ADMIN_PASSWORD
 *                                   Server-side credentials for that API, used
 *                                   only to look up an evaluator's submission.
 *                                   Never sent to the browser.
 */

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

const feedbackUrl = () => trimmed(process.env.EVALUATOR_FEEDBACK_URL) || null;

const feedbackApiUrl = () => {
  const explicit = trimmed(process.env.EVALUATOR_FEEDBACK_API_URL);
  if (explicit) return explicit.replace(/\/+$/, "");
  const site = feedbackUrl();
  return site ? `${site.replace(/\/+$/, "")}/api` : null;
};

const feedbackApiCredentials = () => {
  const username = trimmed(process.env.EVALUATOR_FEEDBACK_ADMIN_USERNAME);
  const password = process.env.EVALUATOR_FEEDBACK_ADMIN_PASSWORD || "";
  return username && password ? { username, password } : null;
};

const courseIds = () =>
  [...new Set(trimmed(process.env.EVALUATOR_COURSE_IDS).split(",").map((id) => id.trim()).filter(Boolean))];

const registrationEnabled = () => trimmed(process.env.EVALUATOR_REGISTRATION_ENABLED) === "true";

module.exports = {
  feedbackUrl,
  feedbackApiUrl,
  feedbackApiCredentials,
  courseIds,
  registrationEnabled,
};
