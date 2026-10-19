const axios = require("axios");
const config = require("./evaluator.config");

/**
 * Looks up submissions on the independent feedback site.
 *
 * That site has no webhook, callback or hidden-field support. What it does
 * have is an authenticated admin API (the one its own dashboard uses):
 *
 *   POST /api/admin/login {username, password}       -> { token }
 *   GET  /api/admin/submissions?search=&page=&limit= -> { items, total, page, pages }
 *        item: { id, role, student: { fullName, email, mobile, college }, submittedAt, ... }
 *
 * So completion is verified server-to-server: a submission whose email is the
 * evaluator's account email, submitted inside the evaluator's access period.
 * Only reads are made. The site is on Render's free tier and can take most
 * of a minute to wake, hence the long timeout.
 */

const REQUEST_TIMEOUT_MS = 50 * 1000;

class FeedbackSiteUnavailable extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "FeedbackSiteUnavailable";
    this.cause = cause;
  }
}

let cachedToken = null;

const login = async (apiUrl, credentials) => {
  const response = await axios.post(`${apiUrl}/admin/login`, credentials, { timeout: REQUEST_TIMEOUT_MS });
  const token = response.data?.token;
  if (!token) throw new FeedbackSiteUnavailable("Feedback site login returned no token");
  cachedToken = token;
  return token;
};

const listSubmissions = async (apiUrl, token, search) =>
  axios.get(`${apiUrl}/admin/submissions`, {
    params: { search, page: 1, limit: 50 },
    headers: { Authorization: `Bearer ${token}` },
    timeout: REQUEST_TIMEOUT_MS,
  });

const isConfigured = () => Boolean(config.feedbackApiUrl() && config.feedbackApiCredentials());

/**
 * The earliest submission by `email` with submittedAt in [from, to], or null.
 * Throws FeedbackSiteUnavailable when the site cannot be asked.
 */
const findSubmission = async ({ email, from, to }) => {
  const apiUrl = config.feedbackApiUrl();
  const credentials = config.feedbackApiCredentials();
  if (!apiUrl || !credentials) {
    throw new FeedbackSiteUnavailable("Feedback verification is not configured");
  }

  let response;
  try {
    const token = cachedToken || (await login(apiUrl, credentials));
    try {
      response = await listSubmissions(apiUrl, token, email);
    } catch (error) {
      if (error.response?.status !== 401) throw error;
      // The site's admin tokens expire; log in again once.
      response = await listSubmissions(apiUrl, await login(apiUrl, credentials), email);
    }
  } catch (error) {
    if (error instanceof FeedbackSiteUnavailable) throw error;
    throw new FeedbackSiteUnavailable(
      `Feedback site request failed: ${error.response?.status || error.code || error.message}`,
      error
    );
  }

  const wanted = email.trim().toLowerCase();
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const items = Array.isArray(response.data?.items) ? response.data.items : [];

  const matches = items
    .filter((item) => {
      const itemEmail = String(item?.student?.email || "").trim().toLowerCase();
      const at = new Date(item?.submittedAt).getTime();
      return item?.id && itemEmail === wanted && at >= fromMs && at <= toMs;
    })
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));

  return matches[0] ? { id: String(matches[0].id), submittedAt: new Date(matches[0].submittedAt) } : null;
};

module.exports = { findSubmission, isConfigured, FeedbackSiteUnavailable };
