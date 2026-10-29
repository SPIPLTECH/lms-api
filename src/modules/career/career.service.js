const prisma = require("../../config/database");
const roles = require("./career.roles");
const engine = require("./career.engine");
const learningHealth = require("../learning-health");

/**
 * Career Guidance agent — adaptive Phase 4.
 *
 * Maps what a learner has demonstrably learned (learner-model mastery, the
 * courses they completed, and — weighted lower — the skills they listed) onto
 * the original agent's role catalogue: readiness for the role they're aiming
 * at, their biggest skill gaps, and published courses that cover them.
 *
 * Computed on read (one round of queries); the only stored state is the role
 * the learner chose (CareerGoal).
 */

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const METHOD_NOTE =
  "Skills are measured from your quiz answers (concept mastery), the courses you've completed, " +
  "and — counted at half strength — the skills listed on your profile. Readiness also reflects " +
  "your recent learning activity and certificates.";

async function resolveOwnStudent(user) {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user?.id ?? "__none__" },
    select: { id: true, technicalSkills: true, careerGoalText: true },
  });
  if (!profile) throw httpError(404, "Student profile not found");
  return profile;
}

/** Everything buildCareerState needs, in one round of queries. */
async function loadCareerInputs(studentId) {
  const [goal, masteries, enrollments, certificateCount, healthStates, catalog] = await Promise.all([
    prisma.careerGoal.findUnique({ where: { studentId } }),
    prisma.conceptMastery.findMany({ where: { studentId }, select: { concept: true, masteryScore: true } }),
    prisma.enrollment.findMany({
      where: { studentId },
      select: { courseId: true, completed: true, course: { select: { title: true, category: true, tags: true } } },
    }),
    prisma.certificate.count({ where: { studentId } }),
    learningHealth.getStudentStates(studentId),
    prisma.course.findMany({ where: { status: "PUBLISHED" }, select: { id: true, title: true, category: true, tags: true } }),
  ]);
  return { goal, masteries, enrollments, certificateCount, healthStates, catalog };
}

function stateFor(profile, inputs) {
  return engine.buildCareerState({
    roles,
    evidence: {
      masteries: inputs.masteries,
      completedCourses: inputs.enrollments.filter((e) => e.completed).map((e) => e.course),
      technicalSkills: profile.technicalSkills ?? [],
    },
    goalRoleKey: inputs.goal?.roleKey ?? null,
    careerGoalText: profile.careerGoalText ?? null,
    certificateCount: inputs.certificateCount,
    healthStates: inputs.healthStates,
    catalog: inputs.catalog,
    enrolledCourseIds: new Set(inputs.enrollments.map((e) => e.courseId)),
  });
}

/* ------------------------------------------------------------------ */
/* Student API                                                         */
/* ------------------------------------------------------------------ */

const listRoles = () =>
  roles.map((r) => ({ key: r.key, name: r.name, category: r.category, description: r.description, skills: Object.keys(r.requiredSkills) }));

async function getMyCareer(user) {
  const profile = await resolveOwnStudent(user);
  const inputs = await loadCareerInputs(profile.id);
  return { ...stateFor(profile, inputs), method: METHOD_NOTE };
}

async function setMyGoal(user, roleKey) {
  if (!roles.some((r) => r.key === roleKey)) throw httpError(400, "Unknown career role");
  const profile = await resolveOwnStudent(user);
  await prisma.careerGoal.upsert({
    where: { studentId: profile.id },
    create: { studentId: profile.id, roleKey },
    update: { roleKey },
  });
  return getMyCareer(user);
}

/* ------------------------------------------------------------------ */
/* Cross-agent getter — never throws                                   */
/* ------------------------------------------------------------------ */

/** The learner's career state (original name). null when unavailable. */
async function getFullState(studentId) {
  try {
    const profile = await prisma.studentProfile.findUnique({
      where: { id: studentId },
      select: { id: true, technicalSkills: true, careerGoalText: true },
    });
    if (!profile) return null;
    return stateFor(profile, await loadCareerInputs(studentId));
  } catch (error) {
    console.warn("[career] getFullState failed", { studentId, error: error?.message });
    return null;
  }
}

/** Just the chosen goal and its readiness — cheap enough for the assistant. */
async function getGoalSummary(studentId) {
  const state = await getFullState(studentId);
  if (!state?.goal) return null;
  const { name, readinessLevel, gaps } = state.goal;
  return { role: name, readinessLevel, topGaps: gaps.slice(0, 2).map((g) => g.skill) };
}

module.exports = { listRoles, getMyCareer, setMyGoal, getFullState, getGoalSummary };
