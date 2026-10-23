/**
 * Withholding video sources from anyone who is not an instructor or admin.
 *
 * A student's player must hold a playback lease before it learns where a
 * video lives (POST /playback/start returns the media descriptor), so no
 * other response may carry a VIDEO row's source. Content rows reach students
 * through many endpoints — the course tree, /contents, /lessons/:id,
 * /topics/:id, /subtopics/:id, /concepts/:id and the learning sequence's step
 * bodies — so this is applied once, to every JSON response, by
 * middleware/mediaProtection.middleware.js rather than endpoint by endpoint.
 *
 * Matching is deliberately narrow: an object with `type: "VIDEO"` that also
 * carries a `videoUrl` key (a Content row, full or selected), or a step with
 * `type: "VIDEO"` whose `body` carries one. An upload response's
 * `{ type: "VIDEO", fileUrl }` has no videoUrl key and is left alone.
 */

const SOURCE_FIELDS = ["videoUrl", "fileUrl", "externalUrl"];
const MAX_DEPTH = 64;

const hasText = (value) => typeof value === "string" && value.trim().length > 0;

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isVideoRow = (value) => value.type === "VIDEO" && Object.prototype.hasOwnProperty.call(value, "videoUrl");

/** A copy of a VIDEO source holder with its sources removed and `mediaProtected` set. */
const withholdSources = (holder) => {
  const copy = { ...holder };
  const hadSource = SOURCE_FIELDS.some((field) => hasText(holder[field]));
  for (const field of SOURCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(copy, field)) copy[field] = null;
  }
  copy.mediaProtected = hadSource;
  return copy;
};

/**
 * Returns `value` with every VIDEO source withheld. Structure is copied only
 * along the paths that change; untouched subtrees are returned as-is.
 */
function withholdVideoSources(value, depth = 0) {
  if (depth > MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = withholdVideoSources(item, depth + 1);
      if (result !== item) changed = true;
      return result;
    });
    return changed ? next : value;
  }

  if (!isPlainObject(value)) return value;

  let current = value;
  if (isVideoRow(current)) current = withholdSources(current);

  let copied = current !== value;
  for (const [key, child] of Object.entries(current)) {
    if (child === null || typeof child !== "object") continue;

    let result;
    // A learning-sequence step: the source lives in its body, which has no
    // `type` of its own.
    if (key === "body" && current.type === "VIDEO" && isPlainObject(child) && "videoUrl" in child) {
      result = withholdSources(child);
    } else {
      result = withholdVideoSources(child, depth + 1);
    }

    if (result !== child) {
      if (!copied) {
        current = { ...current };
        copied = true;
      }
      current[key] = result;
    }
  }
  return current;
}

/** Roles that see raw video sources (they author and review content). */
const SEES_RAW_SOURCES = new Set(["INSTRUCTOR", "ADMIN"]);

const shouldWithholdFor = (user) => !SEES_RAW_SOURCES.has(user?.role);

module.exports = {
  withholdVideoSources,
  shouldWithholdFor,
};
