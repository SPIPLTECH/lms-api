'use strict';

// Where submission PDFs may be read from. No real network or database: R2
// settings are fake (signing a URL is local) and the download is a fake fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePdfLocation, downloadPdf, collectSubmissionText, MAX_PDF_BYTES } = require('../submissionText.service');
const { typedPdf } = require('./makePdf');

const R2_ENV = {
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_PRIVATE_BUCKET: 'lms-private',
};
const R2_HOST = `${R2_ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_BASE = `https://${R2_HOST}/${R2_ENV.R2_PRIVATE_BUCKET}`;
const SUBMISSION = `${R2_BASE}/assignment-submissions/a.pdf`;

function withR2Env(fn) {
  return async () => {
    const saved = Object.fromEntries(Object.keys(R2_ENV).map((k) => [k, process.env[k]]));
    Object.assign(process.env, R2_ENV);
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  };
}

function fakeFetch(body, { status = 200, headers = {} } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      body: (async function* chunks() { yield body; }()),
    };
  };
  return { impl, calls };
}

test('only our R2 submission folder and the LMS uploads folder are trusted locations', withR2Env(() => {
  assert.deepEqual(resolvePdfLocation(`${R2_BASE}/assignment-submissions/123-answer-x1.pdf`), { kind: 'r2', key: 'assignment-submissions/123-answer-x1.pdf' });
  assert.equal(resolvePdfLocation('http://localhost:5000/uploads/attachments/file-1.pdf').kind, 'local');
  assert.equal(resolvePdfLocation('/uploads/attachments/file-1.pdf').kind, 'local');
  for (const bad of [
    'https://169.254.169.254/latest/meta-data/x.pdf',
    `http://${R2_HOST}/${R2_ENV.R2_PRIVATE_BUCKET}/assignment-submissions/x.pdf`, // not https
    `https://evil.com/${R2_HOST}/${R2_ENV.R2_PRIVATE_BUCKET}/assignment-submissions/x.pdf`,
    `https://${R2_HOST}.evil.com/${R2_ENV.R2_PRIVATE_BUCKET}/assignment-submissions/x.pdf`,
    // Vercel Blob is no longer this LMS's storage.
    'https://abc.private.blob.vercel-storage.com/assignment-submissions/a.pdf',
    'file:///etc/passwd',
    '/uploads/attachments/../../.env',
    '/uploads/avatars/me.pdf',
    '',
    null,
  ]) {
    assert.equal(resolvePdfLocation(bad), null, String(bad));
  }
}));

test('only the student-submission folder of our bucket is read', withR2Env(async () => {
  for (const bad of [
    // Instructor material (content-uploads/) in the same bucket.
    `${R2_BASE}/content-uploads/answer-key.pdf`,
    `${R2_BASE}/x.pdf`,
    // Lookalike prefix, dot segments, a query, credentials or a port in the URL.
    `${R2_BASE}/assignment-submissions-evil/x.pdf`,
    `${R2_BASE}/assignment-submissions/%2e%2e/content-uploads/k.pdf`,
    `${R2_BASE}/assignment-submissions/x.pdf?x-id=GetObject`,
    `https://user:pw@${R2_HOST}/${R2_ENV.R2_PRIVATE_BUCKET}/assignment-submissions/x.pdf`,
    `https://${R2_HOST}:8443/${R2_ENV.R2_PRIVATE_BUCKET}/assignment-submissions/x.pdf`,
    // Another account or bucket.
    `https://ffffffffffffffffffffffffffffffff.r2.cloudflarestorage.com/${R2_ENV.R2_PRIVATE_BUCKET}/assignment-submissions/a.pdf`,
    `https://${R2_HOST}/other-bucket/assignment-submissions/a.pdf`,
  ]) {
    assert.notEqual(resolvePdfLocation(bad)?.kind, 'r2', bad);
  }
  const { impl, calls } = fakeFetch(Buffer.from('%PDF-'));
  await assert.rejects(
    downloadPdf(`${R2_BASE}/content-uploads/answer-key.pdf`, { fetchImpl: impl }),
    /not stored in this LMS's file storage/,
  );
  assert.equal(calls.length, 0, 'nothing may be fetched for instructor material');
}));

test('a submission is read through a signed URL; redirects are refused', withR2Env(async () => {
  const { impl, calls } = fakeFetch(await typedPdf([['Plants release oxygen.']]));
  const buf = await downloadPdf(SUBMISSION, { fetchImpl: impl });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const signed = new URL(calls[0].url);
  assert.equal(signed.hostname, R2_HOST);
  assert.equal(signed.pathname, `/${R2_ENV.R2_PRIVATE_BUCKET}/assignment-submissions/a.pdf`);
  assert.ok(signed.searchParams.get('X-Amz-Signature'), 'URL is signed');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers, undefined, 'no credentials are sent as headers');
}));

test('without R2 settings a submission link is not trusted', async () => {
  const { impl, calls } = fakeFetch(Buffer.from('%PDF-'));
  await assert.rejects(downloadPdf(SUBMISSION, { fetchImpl: impl }), /not stored in this LMS's file storage/);
  assert.equal(calls.length, 0);
});

test('oversized and failed downloads are refused', withR2Env(async () => {
  const declared = fakeFetch(Buffer.from('%PDF-'), { headers: { 'content-length': String(MAX_PDF_BYTES + 1) } });
  await assert.rejects(downloadPdf(SUBMISSION, { fetchImpl: declared.impl }), /larger than 20 MB/);
  const actual = fakeFetch(Buffer.alloc(MAX_PDF_BYTES + 10));
  await assert.rejects(downloadPdf(SUBMISSION, { fetchImpl: actual.impl }), /larger than 20 MB/);
  const missing = fakeFetch(Buffer.from(''), { status: 404 });
  await assert.rejects(downloadPdf(SUBMISSION, { fetchImpl: missing.impl }), /answered 404/);
}));

test('typed answer and PDF text are combined; an unreadable PDF becomes a review reason', withR2Env(async () => {
  const pdf = await typedPdf([['Carbon dioxide and water make glucose.']]);
  const ok = await collectSubmissionText(
    { textAnswer: 'Chlorophyll absorbs light.', fileUrl: SUBMISSION, fileName: 'a.pdf' },
    { fetchImpl: fakeFetch(pdf).impl },
  );
  assert.equal(ok.text, 'Chlorophyll absorbs light.\n\nCarbon dioxide and water make glucose.');
  assert.equal(ok.meta.pdf.method, 'TEXT');
  assert.deepEqual(ok.reviewReasons, []);

  const broken = await collectSubmissionText(
    { textAnswer: 'Typed part.', fileUrl: SUBMISSION },
    { fetchImpl: fakeFetch(Buffer.from(''), { status: 500 }).impl },
  );
  assert.equal(broken.text, 'Typed part.');
  assert.match(broken.reviewReasons[0], /could not be read/);
}));
