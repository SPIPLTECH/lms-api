const test = require("node:test");
const assert = require("node:assert/strict");

const { uploadToBlob } = require("./blobStorage");

const file = { buffer: Buffer.from("hello"), originalname: "my notes (v2).pdf", mimetype: "application/pdf" };

function withToken(fn) {
  return async () => {
    const saved = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = saved;
    }
  };
}

test("stores the file under the prefix with a safe name, public first", withToken(async () => {
  const calls = [];
  const putFn = async (pathname, body, options) => {
    calls.push({ pathname, body, options });
    return { url: `https://x.public.blob.vercel-storage.com/${pathname}` };
  };

  const result = await uploadToBlob(file, "attachments", { putFn });

  assert.equal(calls.length, 1);
  assert.match(calls[0].pathname, /^attachments\/\d+-my_notes__v2_.pdf$/);
  assert.equal(calls[0].body, file.buffer);
  assert.equal(calls[0].options.access, "public");
  assert.equal(calls[0].options.token, "test-token");
  assert.equal(calls[0].options.contentType, "application/pdf");
  assert.equal(calls[0].options.addRandomSuffix, true);
  assert.match(result.url, /^https:\/\/x\.public\.blob\.vercel-storage\.com\/attachments\//);
}));

test("falls back to private when the store rejects public access", withToken(async () => {
  const accesses = [];
  const putFn = async (pathname, body, options) => {
    accesses.push(options.access);
    if (options.access === "public") throw new Error("Cannot use public access on a private store");
    return { url: "https://x.private.blob.vercel-storage.com/avatars/a.png" };
  };

  const result = await uploadToBlob(file, "avatars", { putFn });

  assert.deepEqual(accesses, ["public", "private"]);
  assert.equal(result.url, "https://x.private.blob.vercel-storage.com/avatars/a.png");
}));

test("does not retry on unrelated errors", withToken(async () => {
  let calls = 0;
  const putFn = async () => {
    calls += 1;
    throw new Error("network down");
  };

  await assert.rejects(uploadToBlob(file, "attachments", { putFn }), /network down/);
  assert.equal(calls, 1);
}));

test("refuses with a 500 when no Blob token is configured", async () => {
  const saved = { a: process.env.BLOB_READ_WRITE_TOKEN, b: process.env.VERCEL_BLOB_READ_WRITE_TOKEN };
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.VERCEL_BLOB_READ_WRITE_TOKEN;
  try {
    await assert.rejects(uploadToBlob(file, "attachments", { putFn: async () => ({}) }), (error) => {
      assert.equal(error.statusCode, 500);
      return true;
    });
  } finally {
    if (saved.a !== undefined) process.env.BLOB_READ_WRITE_TOKEN = saved.a;
    if (saved.b !== undefined) process.env.VERCEL_BLOB_READ_WRITE_TOKEN = saved.b;
  }
});
