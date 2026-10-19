// Evaluator accounts: 48-hour access, mandatory verified external feedback,
// C-CAT auto-enrollment. Prisma, mail and the feedback site are faked, so
// this runs without any database or network.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const jwt = require("jsonwebtoken");
const axios = require("axios");

process.env.JWT_ACCESS_SECRET = "evaluator-test-secret";

const HOUR = 60 * 60 * 1000;

// ---------------------------------------------------------------- fakes
const db = {
  users: new Map(), // id -> { id, email, password, role, studentProfile }
  access: new Map(), // userId -> EvaluatorAccess row
  courses: new Map(), // id -> { id, status }
  enrollments: [], // { studentId, courseId }
};
let idSeq = 0;
const nextId = (prefix) => `${prefix}_${++idSeq}`;

const fakePrisma = {
  user: {
    findUnique: async ({ where }) => {
      if (where.id) return db.users.get(where.id) || null;
      return [...db.users.values()].find((u) => u.email === where.email) || null;
    },
    create: async ({ data }) => {
      if ([...db.users.values()].some((u) => u.email === data.email)) {
        const error = new Error("Unique constraint failed");
        error.code = "P2002";
        error.meta = { target: ["email"] };
        throw error;
      }
      const id = nextId("user");
      const studentProfile = { id: nextId("sp"), ...data.studentProfile.create };
      db.users.set(id, { id, email: data.email, password: data.password, role: data.role, name: data.name, studentProfile });
      db.access.set(id, { id: nextId("ea"), userId: id, feedbackCompletedAt: null, feedbackSubmissionId: null, ...data.evaluatorAccess.create });
      return { id, email: data.email, studentProfile: { id: studentProfile.id } };
    },
  },
  studentProfile: {
    findUnique: async ({ where }) => {
      const user = [...db.users.values()].find((u) => u.studentProfile?.id === where.id);
      return user ? { id: where.id, userId: user.id } : null;
    },
  },
  evaluatorAccess: {
    findUnique: async ({ where }) => {
      const row = db.access.get(where.userId);
      return row ? { ...row } : null;
    },
    updateMany: async ({ where, data }) => {
      const row = db.access.get(where.userId);
      if (!row || (where.feedbackCompletedAt === null && row.feedbackCompletedAt)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  },
  course: {
    findMany: async ({ where }) =>
      where.id.in.map((id) => db.courses.get(id)).filter((c) => c && c.status === where.status).map(({ id }) => ({ id })),
  },
  enrollment: {
    createMany: async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const row of data) {
        const dup = db.enrollments.some((e) => e.studentId === row.studentId && e.courseId === row.courseId);
        if (dup && skipDuplicates) continue;
        db.enrollments.push(row);
        count++;
      }
      return { count };
    },
    count: async ({ where }) =>
      db.enrollments.filter((e) => e.studentId === where.studentId && where.courseId.in.includes(e.courseId)).length,
  },
  // All-or-nothing, like a real transaction.
  $transaction: async (fn) => {
    const snapshot = {
      users: new Map(db.users),
      access: new Map(db.access),
      enrollments: [...db.enrollments],
    };
    try {
      return await fn(fakePrisma);
    } catch (error) {
      Object.assign(db, snapshot);
      throw error;
    }
  },
};

const sentMail = [];
const stub = (relative, exports) => {
  const resolved = path.resolve(__dirname, relative);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stub("../src/config/database.js", fakePrisma);
stub("../src/utils/mail.js", { sendEmail: async (to, subject, html) => sentMail.push({ to, subject, html }) });

const {
  EVALUATOR_ACCESS_MS,
  expiryFor,
  evaluatorState,
  isAlwaysAllowedPath,
  isEvaluatorStudent,
} = require("../src/utils/evaluatorAccess");
const { buildLearningSequence } = require("../src/utils/learningSequence");
const { passwordFingerprint } = require("../src/utils/sessionVersion");
const { verifyToken, optionalToken } = require("../src/middleware/auth.middleware");
const evaluatorService = require("../src/modules/evaluators/evaluator.service");
const feedbackSite = require("../src/modules/evaluators/feedbackSite.client");
const { registerEvaluatorSchema } = require("../src/modules/evaluators/evaluator.validation");

const SECTION_A = "course_section_a";
const SECTION_B = "course_section_b";
const configure = () => {
  process.env.EVALUATOR_REGISTRATION_ENABLED = "true";
  process.env.EVALUATOR_COURSE_IDS = `${SECTION_A}, ${SECTION_B}`;
  process.env.EVALUATOR_FEEDBACK_URL = "https://feedback.example.com/";
  process.env.EVALUATOR_FEEDBACK_ADMIN_USERNAME = "admin";
  process.env.EVALUATOR_FEEDBACK_ADMIN_PASSWORD = "secret";
  delete process.env.EVALUATOR_FEEDBACK_API_URL;
};
const publishCourses = () => {
  db.courses.set(SECTION_A, { id: SECTION_A, status: "PUBLISHED" });
  db.courses.set(SECTION_B, { id: SECTION_B, status: "PUBLISHED" });
};

// A user with (optionally) an evaluator row, plus a valid access token.
const makeUser = ({ startsAt, feedbackCompletedAt = null, evaluator = true } = {}) => {
  const id = nextId("user");
  const password = `hash-${id}`;
  const studentProfile = { id: nextId("sp") };
  db.users.set(id, { id, email: `${id}@example.com`, password, role: "STUDENT", studentProfile });
  if (evaluator) {
    const start = startsAt ?? new Date();
    db.access.set(id, { id: nextId("ea"), userId: id, startsAt: start, expiresAt: expiryFor(start), feedbackCompletedAt });
  }
  const token = jwt.sign({ id, email: `${id}@example.com`, role: "STUDENT", pv: passwordFingerprint(password) }, process.env.JWT_ACCESS_SECRET);
  return { id, token, studentProfileId: studentProfile.id };
};

const runVerify = async (middleware, token, originalUrl) => {
  const req = { headers: { authorization: `Bearer ${token}` }, originalUrl, path: originalUrl.split("?")[0] };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
};

// ---------------------------------------------------------- access rules
test("expiry is exactly 48 hours after the start", () => {
  const start = new Date("2026-10-19T10:00:00.000Z");
  assert.equal(EVALUATOR_ACCESS_MS, 48 * HOUR);
  assert.equal(expiryFor(start).toISOString(), "2026-10-21T10:00:00.000Z");
});

test("the four evaluator cases, with the deadline itself counting as expired", () => {
  const start = new Date("2026-10-19T10:00:00.000Z");
  const expiresAt = expiryFor(start);
  const open = { startsAt: start, expiresAt, feedbackCompletedAt: null };
  const done = { ...open, feedbackCompletedAt: new Date("2026-10-19T12:00:00.000Z") };
  const justBefore = expiresAt.getTime() - 1;
  const atDeadline = expiresAt.getTime();

  assert.deepEqual(evaluatorState(open, justBefore), { state: "FEEDBACK_REQUIRED", feedbackCompleted: false });
  assert.deepEqual(evaluatorState(done, justBefore), { state: "ACTIVE", feedbackCompleted: true });
  assert.deepEqual(evaluatorState(open, atDeadline), { state: "EXPIRED", feedbackCompleted: false });
  assert.deepEqual(evaluatorState(done, atDeadline), { state: "EXPIRED", feedbackCompleted: true });
});

test("only sign-in/out and the evaluator endpoints stay reachable while blocked", () => {
  assert.equal(isAlwaysAllowedPath("/auth/profile"), true);
  assert.equal(isAlwaysAllowedPath("/auth/logout"), true);
  assert.equal(isAlwaysAllowedPath("/evaluators/me/status?x=1"), true);
  assert.equal(isAlwaysAllowedPath("/enrollments/my"), false);
  assert.equal(isAlwaysAllowedPath("/courses/abc"), false);
  assert.equal(isAlwaysAllowedPath("/contents/abc?next=/auth/"), false);
});

// ------------------------------------------------------- API enforcement
test("feedback incomplete, period active: learning APIs refused, status and auth allowed", async () => {
  const { token } = makeUser();

  const blocked = await runVerify(verifyToken, token, "/enrollments/my");
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 403);
  assert.equal(blocked.res.body.code, "EVALUATOR_FEEDBACK_REQUIRED");

  for (const url of ["/auth/profile", "/evaluators/me/status", "/auth/logout"]) {
    const allowed = await runVerify(verifyToken, token, url);
    assert.equal(allowed.nextCalled, true, url);
  }
});

test("feedback verified, period active: full access", async () => {
  const { token } = makeUser({ feedbackCompletedAt: new Date() });
  const result = await runVerify(verifyToken, token, "/enrollments/my");
  assert.equal(result.nextCalled, true);
});

test("period over: refused with or without feedback, even with a still-valid token", async () => {
  const start = new Date(Date.now() - 48 * HOUR - 1000);
  for (const feedbackCompletedAt of [null, new Date(start.getTime() + HOUR)]) {
    const { token } = makeUser({ startsAt: start, feedbackCompletedAt });
    const result = await runVerify(verifyToken, token, "/courses/c1/modules");
    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 403);
    assert.equal(result.res.body.code, "EVALUATOR_ACCESS_EXPIRED");
    assert.equal(result.res.body.data.feedbackCompleted, Boolean(feedbackCompletedAt));
  }
});

test("a blocked evaluator browses public endpoints only as a guest", async () => {
  const { token } = makeUser();
  const result = await runVerify(optionalToken, token, "/courses/c1");
  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.user, { role: "GUEST" });
});

test("ordinary students are untouched", async () => {
  const { id, token } = makeUser({ evaluator: false });
  const result = await runVerify(verifyToken, token, "/enrollments/my");
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.user.id, id);
});

test("expiry takes effect at the deadline even while the row is cached", async () => {
  // Started 48h minus 80ms ago: active now, expired 80ms from now.
  const { token } = makeUser({ startsAt: new Date(Date.now() - 48 * HOUR + 80), feedbackCompletedAt: new Date() });
  assert.equal((await runVerify(verifyToken, token, "/enrollments/my")).nextCalled, true); // row now cached
  await new Promise((resolve) => setTimeout(resolve, 120));
  const after = await runVerify(verifyToken, token, "/enrollments/my");
  assert.equal(after.res.body.code, "EVALUATOR_ACCESS_EXPIRED");
});

// ---------------------------------------------------------- registration
test("registration input cannot choose a role or evaluator fields", () => {
  const { value, error } = registerEvaluatorSchema.validate(
    {
      name: "Eva Tester",
      email: "eva@example.com",
      password: "longenough1",
      role: "ADMIN",
      expiresAt: "2099-01-01",
      feedbackCompletedAt: "2026-01-01",
    },
    { stripUnknown: true }
  );
  assert.equal(error, undefined);
  assert.deepEqual(Object.keys(value).sort(), ["email", "name", "password"]);
});

test("registration creates a STUDENT evaluator enrolled in both courses with a 48h expiry", async () => {
  configure();
  publishCourses();
  const before = Date.now();
  const result = await evaluatorService.registerEvaluator({ name: "Eva", email: "eva1@example.com", password: "longenough1" });
  const after = Date.now();

  const user = [...db.users.values()].find((u) => u.email === "eva1@example.com");
  assert.equal(user.role, "STUDENT");
  assert.notEqual(user.password, "longenough1", "password is hashed");

  const access = db.access.get(user.id);
  assert.ok(access.startsAt.getTime() >= before && access.startsAt.getTime() <= after);
  assert.equal(access.expiresAt.getTime() - access.startsAt.getTime(), 48 * HOUR);
  assert.equal(access.feedbackCompletedAt, null, "feedback starts incomplete");
  assert.equal(result.expiresAt.getTime(), access.expiresAt.getTime());

  const courses = db.enrollments.filter((e) => e.studentId === user.studentProfile.id).map((e) => e.courseId).sort();
  assert.deepEqual(courses, [SECTION_A, SECTION_B]);
  assert.equal(result.emailSent, true);
  assert.equal(sentMail.at(-1).to, "eva1@example.com");
});

test("registering the same email again is refused, so the period cannot restart", async () => {
  configure();
  publishCourses();
  await assert.rejects(
    evaluatorService.registerEvaluator({ name: "Eva", email: "eva1@example.com", password: "longenough1" }),
    (error) => error.code === "P2002"
  );
});

test("a missing or unpublished course fails registration and creates nothing", async () => {
  configure();
  publishCourses();
  db.courses.get(SECTION_B).status = "DRAFT";
  const usersBefore = db.users.size;
  const enrollmentsBefore = db.enrollments.length;

  await assert.rejects(
    evaluatorService.registerEvaluator({ name: "Eve", email: "eve@example.com", password: "longenough1" }),
    (error) => error.statusCode === 503 && error.code === "EVALUATOR_COURSES_UNAVAILABLE"
  );
  assert.equal(db.users.size, usersBefore);
  assert.equal(db.enrollments.length, enrollmentsBefore);
  publishCourses();
});

test("registration is closed unless explicitly enabled and configured", async () => {
  configure();
  process.env.EVALUATOR_REGISTRATION_ENABLED = "false";
  await assert.rejects(
    evaluatorService.registerEvaluator({ name: "X", email: "x@example.com", password: "longenough1" }),
    (error) => error.statusCode === 404
  );
  assert.equal(evaluatorService.registrationInfo().open, false);

  configure();
  delete process.env.EVALUATOR_FEEDBACK_URL;
  await assert.rejects(
    evaluatorService.registerEvaluator({ name: "X", email: "x@example.com", password: "longenough1" }),
    (error) => error.statusCode === 503
  );
  configure();
  assert.equal(evaluatorService.registrationInfo().open, true);
});

// -------------------------------------------------- feedback verification
const withFeedbackSite = async (submissions, fn) => {
  const original = { post: axios.post, get: axios.get };
  const calls = { login: 0, list: 0 };
  axios.post = async (url) => {
    assert.match(url, /\/api\/admin\/login$/);
    calls.login++;
    return { data: { token: `token-${calls.login}` } };
  };
  axios.get = async (url, options) => {
    assert.match(url, /\/api\/admin\/submissions$/);
    calls.list++;
    return { data: { items: submissions(options.params.search), total: 0, page: 1, pages: 1 } };
  };
  try {
    return await fn(calls);
  } finally {
    Object.assign(axios, original);
  }
};

test("the feedback site match needs the same email inside the access period", async () => {
  configure();
  const from = new Date("2026-10-19T10:00:00.000Z");
  const to = expiryFor(from);
  const items = [
    { id: "too-early", student: { email: "eva@example.com" }, submittedAt: "2026-10-19T09:59:59.000Z" },
    { id: "other-person", student: { email: "someone@example.com" }, submittedAt: "2026-10-19T11:00:00.000Z" },
    { id: "too-late", student: { email: "eva@example.com" }, submittedAt: "2026-10-21T10:00:01.000Z" },
    { id: "second", student: { email: "EVA@example.com " }, submittedAt: "2026-10-20T09:00:00.000Z" },
    { id: "first", student: { email: "eva@example.com" }, submittedAt: "2026-10-19T11:00:00.000Z" },
  ];
  await withFeedbackSite(() => items, async () => {
    const match = await feedbackSite.findSubmission({ email: "eva@example.com", from, to });
    assert.equal(match.id, "first");
    assert.equal(await feedbackSite.findSubmission({ email: "nobody@example.com", from, to }), null);
  });
});

test("no submission found: nothing is recorded", async () => {
  configure();
  const { id } = makeUser();
  await withFeedbackSite(() => [], async () => {
    const result = await evaluatorService.checkFeedback(id);
    assert.equal(result.found, false);
    assert.equal(result.state, "FEEDBACK_REQUIRED");
  });
  assert.equal(db.access.get(id).feedbackCompletedAt, null);
});

test("a verified submission unlocks access without extending it, and repeat checks are idempotent", async () => {
  configure();
  const { id, token } = makeUser();
  const email = db.users.get(id).email;
  const original = { ...db.access.get(id) };
  const submittedAt = new Date(original.startsAt.getTime() + HOUR).toISOString();

  await withFeedbackSite(() => [{ id: "sub-1", student: { email }, submittedAt }], async (calls) => {
    const result = await evaluatorService.checkFeedback(id);
    assert.equal(result.found, true);
    assert.equal(result.state, "ACTIVE");

    const row = db.access.get(id);
    assert.equal(row.feedbackSubmissionId, "sub-1");
    assert.equal(row.feedbackVerifiedBy, "FEEDBACK_SITE");
    assert.equal(row.feedbackCompletedAt.toISOString(), submittedAt);
    assert.equal(row.expiresAt.getTime(), original.expiresAt.getTime(), "period not extended");
    assert.equal(row.startsAt.getTime(), original.startsAt.getTime(), "period not restarted");

    const listCalls = calls.list;
    const again = await evaluatorService.checkFeedback(id);
    assert.equal(again.found, true);
    assert.equal(calls.list, listCalls, "already verified: the site is not asked again");
  });

  const access = await runVerify(verifyToken, token, "/enrollments/my");
  assert.equal(access.nextCalled, true, "the middleware sees the new status at once");
});

test("after the deadline the feedback site is not consulted", async () => {
  configure();
  const { id } = makeUser({ startsAt: new Date(Date.now() - 49 * HOUR) });
  await withFeedbackSite(() => { throw new Error("must not be called"); }, async (calls) => {
    const result = await evaluatorService.checkFeedback(id);
    assert.equal(result.state, "EXPIRED");
    assert.equal(result.found, false);
    assert.equal(calls.list, 0);
  });
});

test("an unreachable or unconfigured feedback site is a 503, never a completion", async () => {
  configure();
  const { id } = makeUser();
  const original = axios.post;
  axios.post = async () => { const e = new Error("timeout"); e.code = "ECONNABORTED"; throw e; };
  try {
    await assert.rejects(evaluatorService.checkFeedback(id), (error) => error.statusCode === 503);
  } finally {
    axios.post = original;
  }
  delete process.env.EVALUATOR_FEEDBACK_ADMIN_PASSWORD;
  await assert.rejects(evaluatorService.checkFeedback(id), (error) => error.code === "FEEDBACK_SITE_UNAVAILABLE");
  assert.equal(db.access.get(id).feedbackCompletedAt, null);
});

test("admin confirmation records who confirmed it", async () => {
  configure();
  const { id } = makeUser();
  const result = await evaluatorService.adminConfirmFeedback(db.users.get(id).email, "admin_1");
  assert.equal(result.state, "ACTIVE");
  assert.equal(db.access.get(id).feedbackVerifiedBy, "ADMIN:admin_1");
});

test("non-evaluators get a 404 from the evaluator endpoints and null in their profile", async () => {
  const { id } = makeUser({ evaluator: false });
  await assert.rejects(evaluatorService.getStatus(id), (error) => error.statusCode === 404);
  assert.equal(await evaluatorService.evaluatorSummaryForUser(id), null);
});

// ------------------------------------------------ open course for evaluators
const sequenceFixture = () => {
  const item = (contentId, order, title, completed = false) => ({ contentId, kind: "CONTENT", type: "VIDEO", order, title, completed, visited: false });
  return {
    id: "C",
    title: "C-CAT",
    items: [item("v1", 1, "First video", true), item("v2", 2, "Second video"), item("v3", 3, "Third video")],
    modules: [{ id: "m1", title: "Module", order: 4, items: [item("v4", 1, "Module video")], lessons: [] }],
  };
};
const bodiesFor = (ids) => new Map(ids.map((id) => [id, { id, videoUrl: `https://video.example.com/${id}` }]));

test("students: steps after the first incomplete one stay locked and carry no material", () => {
  const { steps, tree } = buildLearningSequence(sequenceFixture(), { bodies: bodiesFor(["v1", "v2", "v3", "v4"]) });
  assert.deepEqual(steps.map((s) => s.locked), [false, false, true, true]);
  assert.equal(steps[2].body, null);
  assert.equal(tree.entries.find((e) => e.type === "container").node.locked, true);
});

test("evaluators (unlockAll): every step and container open with its material, progress unchanged", () => {
  const { steps, tree, currentIndex } = buildLearningSequence(sequenceFixture(), {
    bodies: bodiesFor(["v1", "v2", "v3", "v4"]),
    unlockAll: true,
  });
  assert.deepEqual(steps.map((s) => s.locked), [false, false, false, false]);
  assert.deepEqual(steps.map((s) => s.blockedByIndex), [null, null, null, null]);
  assert.ok(steps.every((s) => s.body?.videoUrl), "material is sent for every step");
  assert.equal(tree.entries.find((e) => e.type === "container").node.locked, false);
  assert.deepEqual(steps.map((s) => s.completed), [true, false, false, false], "completion still tracked");
  assert.equal(currentIndex, 1, "the next thing to do is still the first incomplete step");
});

test("isEvaluatorStudent: true for an evaluator's student profile, false for everyone else", async () => {
  const evaluator = makeUser();
  const student = makeUser({ evaluator: false });
  assert.equal(await isEvaluatorStudent(evaluator.studentProfileId), true);
  assert.equal(await isEvaluatorStudent(student.studentProfileId), false);
  assert.equal(await isEvaluatorStudent("no-such-profile"), false);
  assert.equal(await isEvaluatorStudent(null), false);
});
