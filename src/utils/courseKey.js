const prisma = require("../config/database");

/**
 * Readable course keys for staff URLs: /instructor/courses/<key> instead of
 * /instructor/courses/<course id>.
 *
 * Built from the course title, so nothing new is stored. A key is unique
 * among the courses the user can open (an instructor's own, every course for
 * an admin): a title shared by two of them gets the end of each id appended.
 * The same set is used to hand keys out (courses' `urlKey`) and to resolve
 * them back (GET /courses/resolve/:key), so the two always agree.
 */

/** "CDAC C-CAT Course - Section A" -> "cdac-c-cat-course-section-a". */
function slugifyTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Map of course id -> key for `courses` ({ id, title }). */
function buildCourseKeys(courses) {
  const baseOf = new Map(courses.map((course) => [course.id, slugifyTitle(course.title)]));
  const uses = new Map();
  for (const base of baseOf.values()) if (base) uses.set(base, (uses.get(base) || 0) + 1);
  const keys = new Map();
  for (const [id, base] of baseOf) {
    keys.set(id, !base ? id : uses.get(base) > 1 ? `${base}-${id.slice(-6)}` : base);
  }
  return keys;
}

/** The courses a staff user's keys are drawn from, or null for other roles. */
function keyScope(role, userId) {
  if (role === "ADMIN") return {};
  if (role === "INSTRUCTOR" && userId) return { creatorId: userId };
  return null;
}

/** Course id -> key for this user's courses; an empty map for other roles. */
async function loadCourseKeys(role, userId) {
  const where = keyScope(role, userId);
  if (!where) return new Map();
  const courses = await prisma.course.findMany({ where, select: { id: true, title: true } });
  return buildCourseKeys(courses);
}

/** The id of the course `key` (a key, or an id) names for this user, or null. */
async function resolveCourseKey(key, role, userId) {
  if (!key) return null;
  const keys = await loadCourseKeys(role, userId);
  if (keys.has(key)) return key;
  for (const [id, courseKey] of keys) if (courseKey === key) return id;
  return null;
}

module.exports = { slugifyTitle, buildCourseKeys, loadCourseKeys, resolveCourseKey };
