const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const { signMediaToken } = require("./mediaToken");
const { parseR2Url, signedR2Url } = require("../../utils/r2Storage");

/**
 * Where a VIDEO item's bytes come from, and what the LMS can and cannot
 * protect about each kind of source.
 *
 *  kind      source                                  delivered as                  protected?
 *  local     a file under the API's uploads/ dir     signed GET /playback/media/…  the signed URL, yes — but the
 *                                                                                  static /uploads/... URL also
 *                                                                                  still serves it (see note)
 *  blob      a file in our R2 bucket                 signed GET /playback/media/…  yes
 *  youtube   YouTube                                 the YouTube URL               no — YouTube serves it
 *  vimeo     Vimeo                                   the Vimeo URL                 no — Vimeo serves it
 *  external  any other direct link                   the link itself               no — not ours to proxy
 *
 * Every kind is handed out only after a playback lease is held (POST
 * /playback/start), and course/content responses never carry a VIDEO
 * source for students (utils/mediaProtection.js). "Protected" means the
 * bytes are only served while the lease is ACTIVE.
 *
 * Note on /uploads: express.static still serves every file there by direct
 * URL — avatars, thumbnails and attachments depend on that. Locking content
 * files down there was out of scope for this change.
 *
 * External links are deliberately not proxied: proxying arbitrary
 * instructor-entered URLs from the API would make it a server-side request
 * forgery vector. Only our R2 bucket is fetched upstream.
 */

const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");

const YOUTUBE_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;
const VIMEO_HOSTS = /(^|\.)vimeo\.com$/i;

/** The VIDEO source a Content row plays, in the order the player has always used. */
const sourceOf = (content) => content?.videoUrl || content?.fileUrl || content?.externalUrl || null;

/** Resolves a stored /uploads URL (absolute or root-relative) to a file inside uploads/, or null. */
function localUploadPath(parsed) {
  if (!parsed.pathname.startsWith("/uploads/")) return null;
  let relative;
  try {
    relative = decodeURIComponent(parsed.pathname.slice("/uploads/".length));
  } catch {
    return null;
  }
  const absolute = path.resolve(UPLOADS_ROOT, relative);
  if (!absolute.startsWith(UPLOADS_ROOT + path.sep)) return null; // traversal
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? absolute : null;
}

/** @returns {{ kind: "local"|"blob"|"youtube"|"vimeo"|"external"|"none", url?, filePath?, r2Key? }} */
function classifySource(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") return { kind: "none" };
  const url = rawUrl.trim();

  let parsed;
  try {
    parsed = new URL(url, "http://relative.invalid");
  } catch {
    return { kind: "none" };
  }

  if (YOUTUBE_HOSTS.test(parsed.hostname)) return { kind: "youtube", url };
  if (VIMEO_HOSTS.test(parsed.hostname)) return { kind: "vimeo", url };

  const filePath = localUploadPath(parsed);
  if (filePath) return { kind: "local", url, filePath };

  const r2Key = parseR2Url(url);
  if (r2Key) return { kind: "blob", url, r2Key };

  if (parsed.hostname === "relative.invalid") return { kind: "none" };
  return { kind: "external", url };
}

/**
 * The media descriptor POST /playback/start returns once the lease is held.
 * `url` is root-relative for signed media — the client resolves it against
 * the API origin, exactly as it does for /uploads paths.
 */
function buildMediaDescriptor(content, lease, { now = new Date(), maxAgeSeconds }) {
  const source = classifySource(sourceOf(content));

  if (source.kind === "local" || source.kind === "blob") {
    const expiresAt = new Date(now.getTime() + maxAgeSeconds * 1000);
    const token = signMediaToken({ leaseId: lease.id, contentId: content.id, expiresAt });
    return { kind: "file", url: `/playback/media/${token}`, protected: true, expiresAt };
  }
  if (source.kind === "none") return null;
  return { kind: source.kind, url: source.url, protected: false };
}

const PRIVATE_NO_STORE = "private, no-store";

/** Sends a local upload with Range support and no shared caching. */
function sendLocalFile(res, filePath) {
  return new Promise((resolve, reject) => {
    res.sendFile(
      filePath,
      { cacheControl: false, dotfiles: "deny", headers: { "Cache-Control": PRIVATE_NO_STORE } },
      (error) => (error && !res.headersSent ? reject(error) : resolve())
    );
  });
}

/** Streams an R2 object to the client through a short-lived signed URL, forwarding Range. */
async function streamBlob(req, res, source) {
  const headers = {};
  const range = req.get("range");
  if (range) headers.Range = range;

  const upstreamUrl = await signedR2Url(source.r2Key);

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const upstream = await fetch(upstreamUrl, { headers, signal: controller.signal, redirect: "error" });
  if (!upstream.ok && upstream.status !== 206) {
    const error = new Error("This video is not available.");
    error.statusCode = upstream.status === 416 ? 416 : 502;
    error.code = "MEDIA_UNAVAILABLE";
    throw error;
  }

  res.status(upstream.status);
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader("Cache-Control", PRIVATE_NO_STORE);

  if (!upstream.body) return res.end();
  await new Promise((resolve) => {
    const body = Readable.fromWeb(upstream.body);
    body.on("error", () => res.destroy());
    res.on("close", resolve);
    body.pipe(res);
  });
}

module.exports = {
  sourceOf,
  classifySource,
  buildMediaDescriptor,
  sendLocalFile,
  streamBlob,
};
