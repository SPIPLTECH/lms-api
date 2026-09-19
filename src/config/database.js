const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const { PrismaClient } = require("@prisma/client");

/**
 * Which database this process talks to.
 *
 * Normally: DATABASE_URL, via schema.prisma. Unchanged, and the only path
 * production ever takes.
 *
 * Under tests: TEST_DATABASE_URL, when it is set. The test suite writes and
 * deletes real rows, and it has historically run against whatever
 * DATABASE_URL pointed at — which on this project is the demo database. That
 * is how a seeded quiz went missing once already.
 *
 * Deliberately OPT-IN. If TEST_DATABASE_URL is absent the behaviour is
 * exactly what it was before, because silently redirecting to some other
 * database would be a worse surprise than the one being fixed. What the
 * absence does earn is a loud warning, once, so that "the tests just ate my
 * demo data" is never again a thing someone has to work out afterwards.
 */
// NODE_TEST_CONTEXT is set by the node test runner itself, so this holds for
// `npm test` and for a developer running one file directly, with no new
// dependency and no change to how tests are launched.
const isTestRun =
  Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === "test";

const testUrl = isTestRun ? process.env.TEST_DATABASE_URL : null;

if (isTestRun && !testUrl) {
  console.warn(
    "\n\x1b[33m⚠  Tests are running against DATABASE_URL — the same database the app uses.\n" +
      "   Suites that create and delete real rows can therefore mutate demo data.\n" +
      "   Set TEST_DATABASE_URL to point them somewhere disposable.\x1b[0m\n"
  );
}

const prisma = new PrismaClient(
  testUrl ? { datasources: { db: { url: testUrl } } } : undefined
);

// MOCK Progress to return empty data so backend logic doesn't crash
prisma.progress = new Proxy({}, {
  get(target, prop) {
    if (prop === 'count') return async () => 0;
    if (prop === 'findMany') return async () => [];
    if (prop === 'findUnique') return async () => null;
    if (prop === 'groupBy') return async () => [];
    if (prop === 'upsert') return async () => ({});
    if (prop === 'create') return async () => ({});
    if (prop === 'deleteMany') return async () => ({ count: 0 });
    return async () => null;
  }
});

module.exports = prisma;
