const test = require("node:test");
const assert = require("node:assert/strict");

const sequenceCache = require("../src/utils/sequenceCache");

/** Pure: utils/sequenceCache has no database access. */

test("a cached build is served until invalidated", async () => {
  const build = Promise.resolve({ sequence: "v1" });
  sequenceCache.set("s1", "c1", build, sequenceCache.generation("s1", "c1"));

  assert.equal(sequenceCache.get("s1", "c1"), build);
  assert.equal(sequenceCache.get("s1", "other-course"), null);

  sequenceCache.invalidate("s1", "c1");
  assert.equal(sequenceCache.get("s1", "c1"), null);
});

test("a build started before an invalidation is not cached", () => {
  const startedAt = sequenceCache.generation("s2", "c1");
  sequenceCache.invalidate("s2", "c1"); // a progress write lands mid-build

  sequenceCache.set("s2", "c1", Promise.resolve({ sequence: "stale" }), startedAt);
  assert.equal(sequenceCache.get("s2", "c1"), null);
});

test("a failed build is dropped, not served", async () => {
  const failing = Promise.reject(new Error("db down"));
  sequenceCache.set("s3", "c1", failing, sequenceCache.generation("s3", "c1"));
  await assert.rejects(failing);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sequenceCache.get("s3", "c1"), null);
});
