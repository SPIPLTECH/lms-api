const config = require("./career.config");

/**
 * Career Guidance engine — pure. A learner's evidence in; per-role skill
 * match, readiness, gaps and course suggestions out.
 *
 * Evidence, strongest first (each explained to the learner):
 *   - BKT concept mastery from learner-model (measured from their answers)
 *   - courses they have completed (title / category / tags)
 *   - skills they listed on their profile (self-reported, credited at half)
 * There is no canonical skill-ID taxonomy in this LMS, so a role's skill is
 * matched by its words appearing, in order, in the evidence text ("SQL"
 * matches "SQL Joins"; "Git" does not match "Digital").
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round = (value) => Math.round(value);

/** "Node.js" -> ["node", "js"]; "REST APIs" -> ["rest", "apis"]. */
const tokens = (text) => String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Do the skill's words appear, contiguously and in order, in the text? */
function matchesSkill(text, skill) {
  const haystack = tokens(text);
  const needle = tokens(skill);
  if (needle.length === 0 || haystack.length === 0) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  // "nodejs" written as one word on one side and two on the other.
  return haystack.join("") === needle.join("");
}

/**
 * @typedef {{masteries: {concept: string, masteryScore: number}[],
 *            completedCourses: {title: string, category?: string|null, tags?: string[]}[],
 *            technicalSkills: string[]}} Evidence
 */

/** Best proficiency (0-1) the evidence shows for one skill, and where from. */
function skillProficiency(skill, evidence) {
  let best = { proficiency: 0, source: null };
  const consider = (proficiency, source) => {
    if (proficiency > best.proficiency) best = { proficiency, source };
  };

  for (const m of evidence.masteries) {
    if (matchesSkill(m.concept, skill)) consider(clamp(m.masteryScore, 0, 1), "MASTERY");
  }
  for (const course of evidence.completedCourses) {
    const texts = [course.title, course.category, ...(course.tags ?? [])];
    if (texts.some((t) => matchesSkill(t, skill))) consider(config.COMPLETED_COURSE_PROFICIENCY, "COMPLETED_COURSE");
  }
  for (const listed of evidence.technicalSkills) {
    if (matchesSkill(listed, skill) || matchesSkill(skill, listed)) consider(config.SELF_REPORTED_PROFICIENCY, "SELF_REPORTED");
  }
  return best;
}

const severityFor = (gap) => {
  const s = config.GAP_SEVERITY;
  if (gap >= s.CRITICAL) return "CRITICAL";
  if (gap >= s.HIGH) return "HIGH";
  if (gap >= s.MEDIUM) return "MEDIUM";
  return "LOW";
};

/** Per-skill breakdown and weighted skill match (0-100) for one role. */
function evaluateRole(role, evidence) {
  const skills = Object.entries(role.requiredSkills).map(([skill, weight]) => {
    const { proficiency, source } = skillProficiency(skill, evidence);
    const gap = round(weight * (1 - proficiency));
    return { skill, weight, proficiency: Math.round(proficiency * 100) / 100, source, gap, severity: severityFor(gap) };
  });
  const totalWeight = skills.reduce((s, k) => s + k.weight, 0);
  const matched = skills.reduce((s, k) => s + k.weight * k.proficiency, 0);
  return {
    skills,
    skillMatchPercent: totalWeight ? round((matched / totalWeight) * 100) : 0,
    evidencedSkills: skills.filter((k) => k.proficiency > 0).length,
  };
}

const weightedAvailable = (terms) => {
  const usable = terms.filter((t) => t.available);
  const total = usable.reduce((s, t) => s + t.weight, 0);
  return total ? usable.reduce((s, t) => s + t.value * t.weight, 0) / total : 0;
};

/**
 * Original readiness blend. Terms with no data at all are dropped and the
 * rest renormalised (a learner with no Learning Health yet is not scored 0
 * for it).
 *
 * @param {{skillMatchPercent: number, masteryAvg: number|null, healthComposite: number|null,
 *          certificateCount: number, engagementAvg: number|null, evidencedSkills: number}} input
 */
function readiness({ skillMatchPercent, masteryAvg, healthComposite, certificateCount, engagementAvg, evidencedSkills }) {
  const w = config.READINESS_WEIGHTS;
  const score = round(
    clamp(
      weightedAvailable([
        { value: skillMatchPercent, weight: w.skillMatch, available: true },
        { value: (masteryAvg ?? 0) * 100, weight: w.mastery, available: masteryAvg !== null },
        { value: healthComposite ?? 0, weight: w.learningHealth, available: healthComposite !== null },
        { value: (Math.min(certificateCount, config.CREDENTIAL_CAP) / config.CREDENTIAL_CAP) * 100, weight: w.credentials, available: true },
        { value: engagementAvg ?? 0, weight: w.activity, available: engagementAvg !== null },
      ]),
      0,
      100
    )
  );
  const level = score >= config.READY_AT ? "READY" : score >= config.APPROACHING_AT ? "APPROACHING" : "BUILDING";
  const confidence =
    evidencedSkills >= config.CONFIDENCE_HIGH_AT ? "HIGH" : evidencedSkills >= config.CONFIDENCE_MEDIUM_AT ? "MEDIUM" : "LOW";
  return { score, level, confidence };
}

/** Learning Health summarised across courses (null when there is none). */
function healthSummary(states) {
  if (!states.length) return { healthComposite: null, engagementAvg: null };
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const engagementAvg = mean(states.map((s) => s.engagementScore));
  const healthComposite = mean(states.map((s) => (s.engagementScore + (s.performanceScore ?? s.engagementScore)) / 2));
  return { healthComposite, engagementAvg };
}

/** The role a learner is aiming for: an explicit goal, else their profile text. */
function resolveGoal(roles, { goalRoleKey, careerGoalText }) {
  if (goalRoleKey) {
    const role = roles.find((r) => r.key === goalRoleKey);
    if (role) return { role, source: "GOAL" };
  }
  if (careerGoalText) {
    const role = roles.find((r) => matchesSkill(careerGoalText, r.name));
    if (role) return { role, source: "PROFILE_TEXT" };
  }
  return null;
}

/** Published, not-yet-enrolled courses whose title/category/tags cover a gap. */
function suggestCourses(gaps, courses, enrolledCourseIds) {
  return gaps.map((gap) => ({
    ...gap,
    courses: courses
      .filter((c) => !enrolledCourseIds.has(c.id))
      .filter((c) => [c.title, c.category, ...(c.tags ?? [])].some((t) => matchesSkill(t, gap.skill)))
      .slice(0, config.COURSES_PER_GAP)
      .map((c) => ({ id: c.id, title: c.title })),
  }));
}

/**
 * Everything the learner sees.
 * @param {{roles: object[], evidence: Evidence, goalRoleKey: string|null, careerGoalText: string|null,
 *          certificateCount: number, healthStates: object[], catalog: object[], enrolledCourseIds: Set<string>}} input
 */
function buildCareerState({ roles, evidence, goalRoleKey, careerGoalText, certificateCount, healthStates, catalog, enrolledCourseIds }) {
  const masteryAvg = evidence.masteries.length
    ? evidence.masteries.reduce((s, m) => s + clamp(m.masteryScore, 0, 1), 0) / evidence.masteries.length
    : null;
  const { healthComposite, engagementAvg } = healthSummary(healthStates);

  const assess = (role) => {
    const evaluation = evaluateRole(role, evidence);
    return {
      roleKey: role.key,
      name: role.name,
      category: role.category,
      skillMatchPercent: evaluation.skillMatchPercent,
      evaluation,
      readiness: readiness({
        skillMatchPercent: evaluation.skillMatchPercent,
        masteryAvg,
        healthComposite,
        certificateCount,
        engagementAvg,
        evidencedSkills: evaluation.evidencedSkills,
      }),
    };
  };

  const assessed = roles.map(assess);
  const topMatches = [...assessed]
    .sort((a, b) => b.skillMatchPercent - a.skillMatchPercent || a.name.localeCompare(b.name))
    .slice(0, config.TOP_MATCHES)
    .map(({ roleKey, name, category, skillMatchPercent, readiness: r }) => ({ roleKey, name, category, skillMatchPercent, readinessLevel: r.level }));

  const goal = resolveGoal(roles, { goalRoleKey, careerGoalText });
  let target = null;
  if (goal) {
    const a = assessed.find((x) => x.roleKey === goal.role.key);
    const gaps = a.evaluation.skills
      .filter((k) => k.gap > 0)
      .sort((x, y) => y.gap - x.gap)
      .slice(0, config.MAX_GAPS)
      .map(({ skill, weight, proficiency, gap, severity }) => ({ skill, weight, proficiency, gap, severity }));
    target = {
      roleKey: a.roleKey,
      name: a.name,
      category: a.category,
      description: goal.role.description,
      source: goal.source,
      readinessScore: a.readiness.score,
      readinessLevel: a.readiness.level,
      confidence: a.readiness.confidence,
      skillMatchPercent: a.skillMatchPercent,
      skills: a.evaluation.skills.map(({ skill, weight, proficiency, source }) => ({ skill, weight, proficiency, source })),
      gaps: suggestCourses(gaps, catalog, enrolledCourseIds),
    };
  }

  return { goal: target, topMatches };
}

module.exports = { matchesSkill, skillProficiency, evaluateRole, readiness, healthSummary, resolveGoal, suggestCourses, buildCareerState };
