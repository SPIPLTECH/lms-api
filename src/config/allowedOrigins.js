/**
 * Single source of truth for which browser origins this API accepts.
 *
 * There are two CORS layers in this process and they used to be configured
 * independently: Express (src/app.js, driven by CORS_ALLOWED_ORIGINS) and
 * Socket.io (src/socket/index.js, driven by FRONTEND_URL plus a hardcoded
 * localhost/vercel list). That split is why serving the app over the LAN
 * half-works out of the box — REST calls from http://192.168.x.x:3000 are
 * accepted, while the realtime socket handshake from the same page is
 * rejected, silently killing chat, presence and notifications.
 *
 * Both layers now read this module.
 *
 * LAN origins
 * -----------
 * When the dev machine serves the frontend to phones/laptops on the same
 * Wi-Fi, the browser's Origin is http://<private-LAN-IP>:3000 — an address
 * that changes with the network (DHCP), so it cannot be pinned in .env.
 * Instead we accept any origin whose host is a loopback or RFC1918 private
 * address. Those ranges are not routable from the internet, so this widens
 * the allowlist only to machines already on the same local network.
 *
 * Gated by ALLOW_LAN_ORIGINS:
 *   "true"/"1"  -> always on
 *   "false"/"0" -> always off
 *   unset       -> on unless NODE_ENV === "production"
 */

// Kept from src/socket/index.js so existing deployments keep working.
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://lms-web-demo.vercel.app",
];

// Loopback + the three RFC1918 private ranges, with an optional port.
// 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16.
const PRIVATE_ORIGIN_PATTERN =
  /^https?:\/\/(?:localhost|\[::1\]|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$/i;

const splitList = (value) =>
  (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Origins named explicitly in the environment. CORS_ALLOWED_ORIGINS and
 * FRONTEND_URL are both comma-separated lists and both are honoured, because
 * the two layers historically read one each.
 */
const configuredOrigins = () => [
  ...new Set([
    ...splitList(process.env.CORS_ALLOWED_ORIGINS),
    ...splitList(process.env.FRONTEND_URL),
  ]),
];

const lanOriginsAllowed = () => {
  const flag = (process.env.ALLOW_LAN_ORIGINS || "").trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return process.env.NODE_ENV !== "production";
};

/**
 * `origin` is undefined for same-origin navigations and for every non-browser
 * caller — curl, Razorpay webhooks, the Next.js route handlers' server-side
 * fetch. Those have no CORS to enforce, so they are always allowed; rejecting
 * them here would break the payment webhook and the upload proxy.
 */
const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  const explicit = [...configuredOrigins(), ...DEFAULT_ALLOWED_ORIGINS];
  if (explicit.includes(origin)) return true;

  return lanOriginsAllowed() && PRIVATE_ORIGIN_PATTERN.test(origin);
};

/**
 * Value for the `origin` option of the `cors` package (Socket.io uses the same
 * package, so this works for both).
 */
const corsOriginDelegate = (origin, callback) => {
  callback(null, isAllowedOrigin(origin));
};

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  configuredOrigins,
  lanOriginsAllowed,
  isAllowedOrigin,
  corsOriginDelegate,
};
