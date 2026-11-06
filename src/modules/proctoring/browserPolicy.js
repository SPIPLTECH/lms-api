const ApiError = require("../../utils/ApiError");

/**
 * Proctored exams run on a laptop or desktop with current Chrome or Edge, because
 * those are the browsers the camera, microphone and fullscreen behaviour was built
 * for. This reads what the browser says about itself, so it guides honest students
 * and is not a security boundary.
 */

const DEFAULT_MIN_VERSION = 120;
const MOBILE = /Mobi|Android|iPhone|iPad|iPod|Tablet/i;
const OTHER_CHROMIUM = /OPR\/|Opera|SamsungBrowser|YaBrowser|Vivaldi/i;

const minVersion = (env = process.env) => Number(env.PROCTORING_MIN_BROWSER_VERSION) || DEFAULT_MIN_VERSION;

function isAllowedBrowser(headers = {}) {
  const userAgent = String(headers["user-agent"] || "");
  if (headers["sec-ch-ua-mobile"] === "?1" || MOBILE.test(userAgent) || OTHER_CHROMIUM.test(userAgent)) return false;
  const match = userAgent.match(/Edg\/(\d+)/) || userAgent.match(/Chrome\/(\d+)/);
  return Boolean(match) && Number(match[1]) >= minVersion();
}

function assertAllowedBrowser(headers) {
  if (!isAllowedBrowser(headers)) {
    throw new ApiError(403, "Proctored exams need a laptop or desktop computer with a current version of Chrome or Edge.", "DEVICE_NOT_ALLOWED");
  }
}

module.exports = { assertAllowedBrowser, isAllowedBrowser };
