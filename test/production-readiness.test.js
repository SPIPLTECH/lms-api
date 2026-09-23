const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// PHASE 11 — production-readiness guards.
//
// These pin decisions that are easy to undo by accident and expensive to
// notice: a database the tests are allowed to eat, an ordering that stops
// being a function of the data, a secret with a hardcoded fallback, a role
// list that quietly gains STUDENT.
//
// They are source-level assertions on purpose. The behaviours they protect
// have no runtime surface that a normal test could reach — you cannot write
// an integration test for "nobody added a default JWT secret".

const readSource = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

/** Source with comments removed, so a guard never fires on its own explanation. */
const readCode = (relative) =>
  readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// Test/database isolation
// ---------------------------------------------------------------------------

test("the test runner is detectable without a new dependency or launch flag", async () => {
  // NODE_TEST_CONTEXT is set by node's own runner. If this ever stops being
  // true, the isolation below silently stops applying — so it is asserted
  // from inside a test, where it must hold.
  assert.ok(process.env.NODE_TEST_CONTEXT, "node --test should mark its own context");
});

test("a test run redirects to TEST_DATABASE_URL when one is configured", async () => {
  const source = readCode("src/config/database.js");

  assert.match(source, /TEST_DATABASE_URL/, "the opt-in variable is read");
  assert.match(source, /datasources/, "and is applied as a datasource override");
  assert.match(source, /NODE_TEST_CONTEXT/, "gated on the test context, not on production");
});

test("running tests against the app database warns rather than failing silently", async () => {
  const source = readSource("src/config/database.js");
  assert.match(source, /console\.warn/, "the unsafe-but-permitted case is announced");
});

test("production behaviour is unchanged when no test URL is set", async () => {
  // The guard that matters: an app process must never be redirected. If
  // isTestRun is false, testUrl is null and PrismaClient is constructed
  // exactly as before.
  const source = readCode("src/config/database.js");
  assert.match(
    source,
    /const testUrl = isTestRun \? process\.env\.TEST_DATABASE_URL : null/,
    "the override is reachable only from a test context"
  );
});

// ---------------------------------------------------------------------------
// Deterministic ordering (the real risk behind the missing Quiz constraint)
// ---------------------------------------------------------------------------

test("every ordered relation in the roll-up has a total sort", async () => {
  // Content has @@unique([scope, order]); Quiz and Assignment do not, and
  // duplicate quiz orders have existed here before. Without a tiebreak the
  // hierarchy — and so the learning path built from it — would depend on
  // Postgres row order, which Phase 10 requires it not to.
  const source = readCode("src/utils/progressRollup.js");

  const bare = source.match(/orderBy:\s*\{\s*order:\s*['"]asc['"]\s*\}/g) || [];
  assert.deepStrictEqual(bare, [], "an `order`-only sort is not total for Quiz or Assignment");

  const total = source.match(/orderBy:\s*\[\s*\{\s*order:\s*['"]asc['"]\s*\}\s*,\s*\{\s*createdAt/g) || [];
  assert.ok(total.length >= 11, `expected every ordered relation to be tiebroken, found ${total.length}`);
});

test("the ordering fix kept the common per-parent sequence", async () => {
  // Quiz/Assignment zone bands were replaced by one sequence per parent,
  // shared by Content, Quizzes, Assignments and child containers.
  const source = readCode("src/modules/contents/contentOrder.util.js");
  assert.match(source, /claimSequenceOrder/, "the common sequence is still where it was");
  assert.doesNotMatch(source, /QUIZ_ORDER_BASE|ASSIGNMENT_ORDER_BASE/);
});

// ---------------------------------------------------------------------------
// Secrets and configuration
// ---------------------------------------------------------------------------

test("no JWT secret has a hardcoded fallback", async () => {
  for (const file of ["src/middleware/auth.middleware.js", "src/modules/auth/auth.service.js"]) {
    const source = readCode(file);
    // `process.env.A || process.env.B` is fine; `|| "some-literal"` is not.
    const literalFallback = source.match(/JWT_[A-Z_]*SECRET\s*\|\|\s*["'`]/g) || [];
    assert.deepStrictEqual(literalFallback, [], `${file} must not default a signing secret`);
  }
});

test("CORS can be locked to an allowlist from the environment", async () => {
  const source = readCode("src/app.js");
  assert.match(source, /CORS_ALLOWED_ORIGINS/, "an allowlist is configurable");
  // The allowlist decision moved into src/config/allowedOrigins.js so the
  // Express and Socket.io layers share one policy. What this still guards is
  // that app.js hands `origin` to that policy rather than leaving CORS open
  // when an allowlist IS configured. The policy's own behaviour — which
  // origins it accepts, including LAN ones — is covered by
  // test/allowed-origins.test.js.
  assert.match(source, /origin: corsOriginDelegate/, "and is applied when present");
});

test("no credential is committed in source", async () => {
  const files = ["src/app.js", "src/config/database.js", "src/middleware/auth.middleware.js"];
  for (const file of files) {
    const source = readCode(file);
    assert.ok(!/postgres(ql)?:\/\/[^\s"']+/.test(source), `${file} must not embed a connection string`);
  }
});

// ---------------------------------------------------------------------------
// Authorization surface
// ---------------------------------------------------------------------------

test("no instructor analytics route is reachable by a student", async () => {
  const source = readSource("src/modules/learner-model/learnerModel.routes.js");

  // Each instructor route and the role list guarding it.
  const instructorRoutes = ["instructor-insights", "instructor-learners", "instructor-learner"];
  for (const route of instructorRoutes) {
    const index = source.indexOf(`"/${route}"`);
    assert.ok(index > -1, `${route} should be routed`);
    const block = source.slice(index, index + 260);
    assert.match(block, /checkRole\(\["INSTRUCTOR", "ADMIN"\]\)/, `${route} must exclude STUDENT`);
  }
});

test("every learner-model route requires a verified token", async () => {
  const source = readSource("src/modules/learner-model/learnerModel.routes.js");
  const routes = source.match(/router\.(get|post)\(\s*["'][^"']+["'][\s\S]*?\);/g) || [];

  assert.ok(routes.length >= 8, `expected the full router, found ${routes.length} routes`);
  for (const route of routes) {
    assert.match(route, /verifyToken/, `an unauthenticated route exists: ${route.slice(0, 60)}`);
    assert.match(route, /checkRole/, `a route without a role gate exists: ${route.slice(0, 60)}`);
  }
});

// ---------------------------------------------------------------------------
// Adaptive architecture, still intact
// ---------------------------------------------------------------------------

test("the deterministic decision path still contains no model call", async () => {
  const decisionModules = [
    "src/modules/learner-model/decision.service.js",
    "src/modules/learner-model/nextAction.service.js",
    "src/modules/learner-model/recommendation.service.js",
    "src/modules/learner-model/retention.service.js",
    "src/modules/learner-model/bkt.service.js",
    "src/modules/learner-model/instructorInsights.service.js",
    "src/utils/learningPath.js",
    "src/utils/attemptAllowance.js",
    "src/utils/progressRollup.js"
  ];

  for (const file of decisionModules) {
    const source = readCode(file);
    assert.ok(!/require\(["'].*llm/i.test(source), `${file} must not import an LLM client`);
    assert.ok(!/llmService|ollama|gemini|anthropic/i.test(source), `${file} must not reference a model`);
  }
});

test("attempt allowance still has exactly one definition", async () => {
  // Two copies of this rule is how a student gets told "1 of 1 attempts used"
  // under a working retry button.
  const shared = readCode("src/utils/attemptAllowance.js");
  assert.match(shared, /const effectiveMaxAttempts/, "the one definition lives here");

  for (const file of [
    "src/modules/quizzes/quiz.service.js",
    "src/modules/learner-model/nextAction.service.js",
    "src/modules/learner-model/instructorInsights.service.js"
  ]) {
    const source = readCode(file);
    assert.ok(
      !/const effectiveMaxAttempts\s*=/.test(source),
      `${file} redefines the allowance rule instead of importing it`
    );
    assert.match(source, /effectiveMaxAttempts/, `${file} should use the shared rule`);
  }
});

// ---------------------------------------------------------------------------
// Calibration — reported honestly, never fabricated
// ---------------------------------------------------------------------------

test("calibration is still unavailable, and the schema still has no confidence field", async () => {
  const schema = readSource("prisma/schema.prisma");
  const questionAttempt = schema.slice(
    schema.indexOf("model QuestionAttempt "),
    schema.indexOf("model QuestionAttempt ") + 2000
  );

  assert.ok(
    !/\bconfidence\b/.test(questionAttempt),
    "no confidence column exists, so calibration must keep reporting UNAVAILABLE"
  );

  const config = readSource("src/modules/learner-model/retention.config.js");
  assert.match(config, /CALIBRATION_CAPTURE_NOTE/, "the capture requirement stays documented");
});
