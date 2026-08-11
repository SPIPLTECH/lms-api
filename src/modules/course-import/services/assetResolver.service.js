const path = require("path");

/**
 * Absolute URL, mirroring the existing /contents/upload-file convention
 * (content.routes.js builds `${req.protocol}://${req.get("host")}/uploads/...`)
 * — a root-relative path would resolve against the frontend's own origin
 * instead of the backend's, breaking whenever they run on different
 * origins/ports (the normal case in dev, and behind most deployments).
 */
const buildServedUrl = (ctx, relativePath) => `${ctx.baseUrl}/uploads/course-imports/${ctx.jobId}/${relativePath}`;

const isLocalReference = (src) => {
  if (!src) return false;
  return !/^([a-z][a-z0-9+.-]*:)?\/\//i.test(src) && !src.startsWith("data:") && !src.startsWith("mailto:");
};

/**
 * Resolves a relative local reference (e.g. an <img src>) against the
 * source file's own location within the extracted package. Returns null
 * when the reference would escape the package root — a broken reference,
 * flagged by the validator rather than silently served.
 */
const resolveLocalAsset = (relativeSrc, sourceFileRelativePath, ctx) => {
  const cleanSrc = relativeSrc.split("?")[0].split("#")[0];
  const sourceDir = path.posix.dirname(sourceFileRelativePath.replace(/\\/g, "/"));
  const resolved = path.posix.normalize(path.posix.join(sourceDir, cleanSrc));

  if (resolved.startsWith("..")) return null;

  return { originalPath: resolved, url: buildServedUrl(ctx, resolved) };
};

module.exports = { resolveLocalAsset, isLocalReference, buildServedUrl };
