'use strict';

// Where submission PDFs may be read from. No real network or database: the
// Vercel Blob download is replaced by a fake fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePdfLocation, downloadPdf, collectSubmissionText, MAX_PDF_BYTES } = require('../submissionText.service');
const { typedPdf } = require('./makePdf');

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

test('only Vercel Blob and the LMS uploads folder are trusted locations', () => {
  assert.equal(resolvePdfLocation('https://abc123.public.blob.vercel-storage.com/assignment-submissions/123-answer-x1.pdf').kind, 'blob');
  assert.equal(resolvePdfLocation('https://abc123.private.blob.vercel-storage.com/assignment-submissions/a.pdf').isPrivate, true);
  assert.equal(resolvePdfLocation('http://localhost:5000/uploads/attachments/file-1.pdf').kind, 'local');
  assert.equal(resolvePdfLocation('/uploads/attachments/file-1.pdf').kind, 'local');
  for (const bad of [
    'https://169.254.169.254/latest/meta-data/x.pdf',
    'http://abc.public.blob.vercel-storage.com/x.pdf', // not https
    'https://evil.com/abc.public.blob.vercel-storage.com/x.pdf',
    'https://abc.public.blob.vercel-storage.com.evil.com/x.pdf',
    'file:///etc/passwd',
    '/uploads/attachments/../../.env',
    '/uploads/avatars/me.pdf',
    '',
    null,
  ]) {
    assert.equal(resolvePdfLocation(bad), null, String(bad));
  }
});

test('the server token is used only for the student-submission folder of the Blob store', async () => {
  for (const bad of [
    // Instructor material (content-uploads/) in the same store.
    'https://abc.private.blob.vercel-storage.com/content-uploads/answer-key.pdf',
    'https://abc.private.blob.vercel-storage.com/x.pdf',
    // Lookalike prefix, dot segments, credentials or a port in the URL.
    'https://abc.private.blob.vercel-storage.com/assignment-submissions-evil/x.pdf',
    'https://abc.private.blob.vercel-storage.com/assignment-submissions/../content-uploads/k.pdf',
    'https://user:pw@abc.private.blob.vercel-storage.com/assignment-submissions/x.pdf',
    'https://abc.private.blob.vercel-storage.com:8443/assignment-submissions/x.pdf',
  ]) {
    assert.equal(resolvePdfLocation(bad), null, bad);
  }
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  try {
    const { impl, calls } = fakeFetch(Buffer.from('%PDF-'));
    await assert.rejects(
      downloadPdf('https://abc.private.blob.vercel-storage.com/content-uploads/answer-key.pdf', { fetchImpl: impl }),
      /not stored in this LMS's file storage/,
    );
    assert.equal(calls.length, 0, 'nothing may be fetched, so the token is never sent');
  } finally {
    if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
});

test('public blob is downloaded without credentials; redirects are refused', async () => {
  const pdf = await typedPdf([['Plants release oxygen.']]);
  const { impl, calls } = fakeFetch(pdf);
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const buf = await downloadPdf('https://abc.public.blob.vercel-storage.com/assignment-submissions/a.pdf', { fetchImpl: impl });
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[0].init.headers.Authorization, undefined);
  } finally {
    if (saved !== undefined) process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
});

test('private blob needs the server token, and sends it', async () => {
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await assert.rejects(downloadPdf('https://abc.private.blob.vercel-storage.com/assignment-submissions/a.pdf', { fetchImpl: fakeFetch(Buffer.from('x')).impl }), /BLOB_READ_WRITE_TOKEN is not set/);
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
    const { impl, calls } = fakeFetch(await typedPdf([['x']]));
    await downloadPdf('https://abc.private.blob.vercel-storage.com/assignment-submissions/a.pdf', { fetchImpl: impl });
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token');
  } finally {
    if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
});

test('oversized and failed downloads are refused', async () => {
  const declared = fakeFetch(Buffer.from('%PDF-'), { headers: { 'content-length': String(MAX_PDF_BYTES + 1) } });
  await assert.rejects(downloadPdf('https://abc.public.blob.vercel-storage.com/assignment-submissions/a.pdf', { fetchImpl: declared.impl }), /larger than 20 MB/);
  const actual = fakeFetch(Buffer.alloc(MAX_PDF_BYTES + 10));
  await assert.rejects(downloadPdf('https://abc.public.blob.vercel-storage.com/assignment-submissions/a.pdf', { fetchImpl: actual.impl }), /larger than 20 MB/);
  const missing = fakeFetch(Buffer.from(''), { status: 404 });
  await assert.rejects(downloadPdf('https://abc.public.blob.vercel-storage.com/assignment-submissions/a.pdf', { fetchImpl: missing.impl }), /answered 404/);
});

test('typed answer and PDF text are combined; an unreadable PDF becomes a review reason', async () => {
  const pdf = await typedPdf([['Carbon dioxide and water make glucose.']]);
  const ok = await collectSubmissionText(
    { textAnswer: 'Chlorophyll absorbs light.', fileUrl: 'https://abc.public.blob.vercel-storage.com/assignment-submissions/a.pdf', fileName: 'a.pdf' },
    { fetchImpl: fakeFetch(pdf).impl },
  );
  assert.equal(ok.text, 'Chlorophyll absorbs light.\n\nCarbon dioxide and water make glucose.');
  assert.equal(ok.meta.pdf.method, 'TEXT');
  assert.deepEqual(ok.reviewReasons, []);

  const broken = await collectSubmissionText(
    { textAnswer: 'Typed part.', fileUrl: 'https://abc.public.blob.vercel-storage.com/assignment-submissions/a.pdf' },
    { fetchImpl: fakeFetch(Buffer.from(''), { status: 500 }).impl },
  );
  assert.equal(broken.text, 'Typed part.');
  assert.match(broken.reviewReasons[0], /could not be read/);
});
