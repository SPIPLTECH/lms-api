'use strict';

// R2 URL recognition and signing, with fake settings. Signing is local, so
// nothing reaches the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const { uploadFile, parseR2Url, signedR2Url, r2ObjectUrl } = require('./r2Storage');
const { classifySource } = require('../modules/playback/playbackMedia');

const R2_ENV = {
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_PRIVATE_BUCKET: 'lms-private',
};
const HOST = `${R2_ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

async function withR2Env(fn) {
  const saved = Object.fromEntries(Object.keys(R2_ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, R2_ENV);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('stored URLs round-trip, including names with spaces', () => withR2Env(() => {
  const key = 'Screen Recording 2026-08-13 115645-abc.mp4';
  const url = r2ObjectUrl(key);
  assert.equal(url, `https://${HOST}/lms-private/Screen%20Recording%202026-08-13%20115645-abc.mp4`);
  assert.equal(parseR2Url(url), key);
  assert.equal(parseR2Url(`https://${HOST}/lms-private/content-uploads/a.pdf`), 'content-uploads/a.pdf');
}));

test('only our own host and private bucket are accepted', () => withR2Env(() => {
  for (const bad of [
    `http://${HOST}/lms-private/a.pdf`,
    `https://ffffffffffffffffffffffffffffffff.r2.cloudflarestorage.com/lms-private/a.pdf`,
    `https://evil.example/${HOST}/lms-private/a.pdf`,
    `https://${HOST}/other-bucket/a.pdf`,
    `https://${HOST}/lms-private/`,
    `https://${HOST}/lms-private/../other-bucket/b.pdf`,
    `https://${HOST}/lms-private/%2e%2e/other-bucket/b.pdf`,
    `https://${HOST}/lms-private/a.pdf?x-id=GetObject`,
    `https://user:pw@${HOST}/lms-private/a.pdf`,
    `https://${HOST}:8443/lms-private/a.pdf`,
    'https://abc.private.blob.vercel-storage.com/a.pdf',
    '/uploads/a.pdf',
    null,
  ]) {
    assert.equal(parseR2Url(bad), null, String(bad));
  }
}));

test('without R2 settings nothing is recognised', () => {
  assert.equal(parseR2Url(`https://${HOST}/lms-private/a.pdf`), null);
});

test('signed URLs point at the object and expire', () => withR2Env(async () => {
  const signed = new URL(await signedR2Url('content-uploads/a b.pdf'));
  assert.equal(signed.hostname, HOST);
  assert.equal(signed.pathname, '/lms-private/content-uploads/a%20b.pdf');
  assert.equal(signed.searchParams.get('X-Amz-Expires'), '300');
  assert.ok(signed.searchParams.get('X-Amz-Signature'));
}));

test('playback treats an R2 video as protected storage', () => withR2Env(() => {
  const url = `https://${HOST}/lms-private/content-uploads/lesson.mp4`;
  assert.deepEqual(classifySource(url), { kind: 'blob', url, isPrivate: true, r2Key: 'content-uploads/lesson.mp4' });
  assert.equal(classifySource(`https://${HOST}/other-bucket/lesson.mp4`).kind, 'external');
}));

test('uploads go to the private bucket under the prefix, with a safe unique name', () => withR2Env(async () => {
  const sent = [];
  const file = { buffer: Buffer.from('hello'), originalname: 'my notes (v2).pdf', mimetype: 'application/pdf' };
  const result = await uploadFile(file, 'attachments', { sendFn: async (command) => sent.push(command.input) });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].Bucket, 'lms-private');
  assert.match(sent[0].Key, /^attachments\/\d+-my_notes__v2_-[0-9a-f]{24}\.pdf$/);
  assert.equal(sent[0].Body, file.buffer);
  assert.equal(sent[0].ContentType, 'application/pdf');
  assert.equal(result.pathname, sent[0].Key);
  assert.equal(parseR2Url(result.url), sent[0].Key);
}));

test('uploads fail clearly without R2 settings', async () => {
  await assert.rejects(
    uploadFile({ buffer: Buffer.from('x'), originalname: 'a.png', mimetype: 'image/png' }, 'avatars', { sendFn: async () => {} }),
    /R2_\* settings are missing/,
  );
});
