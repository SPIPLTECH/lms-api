const fs = require("fs");
const path = require("path");

const { createPdfExtractor } = require("./pdf/pdfExtractor");
const { parseR2Url, signedR2Url } = require("../../utils/r2Storage");

// Same ceiling as the student upload route (lms_web_demo /api/upload).
const MAX_PDF_BYTES = 20 * 1024 * 1024;
// The student upload route writes every submission under this prefix
// (STUDENT_UPLOAD_PREFIX in lms_web_demo src/app/api/upload/route.js). With the
// server's R2 keys the evaluator could read any file in the bucket, so it reads
// only these: a submission cannot point it at instructor material.
const SUBMISSION_PREFIX = "assignment-submissions/";
const DOWNLOAD_TIMEOUT_MS = 30000;
const LOCAL_ATTACHMENTS_DIR = path.join(__dirname, "../../../uploads/attachments");

const extractor = createPdfExtractor({
    maxPages: Number(process.env.EVALUATION_PDF_MAX_PAGES || 30),
    ocrEnabled: (process.env.EVALUATION_OCR_ENABLED || "true").toLowerCase() !== "false",
    ocrMaxPages: Number(process.env.EVALUATION_OCR_MAX_PAGES || 10),
    // Tesseract downloads its English model here on first use (~10 MB).
    ocrCachePath: path.join(__dirname, "../../../.cache/tesseract"),
});

/**
 * Where a submission's PDF lives, or null if it is somewhere we must not
 * fetch from. Only two places are trusted: the student-submission folder of
 * our R2 bucket (where the student upload route stores files) and this API's
 * own uploads/attachments folder (older submissions). Anything else is never
 * downloaded, so a crafted fileUrl cannot make the server request arbitrary
 * addresses.
 */
function resolvePdfLocation(fileUrl) {
    if (!fileUrl || typeof fileUrl !== "string") return null;

    const r2Key = parseR2Url(fileUrl);
    if (r2Key) {
        return r2Key.startsWith(SUBMISSION_PREFIX) ? { kind: "r2", key: r2Key } : null;
    }

    let url;
    try {
        url = new URL(fileUrl, "http://local.invalid");
    } catch {
        return null;
    }

    const local = /^\/uploads\/attachments\/([\w.-]+)$/.exec(url.pathname);
    if (local) {
        const filePath = path.join(LOCAL_ATTACHMENTS_DIR, local[1]);
        if (path.dirname(filePath) !== LOCAL_ATTACHMENTS_DIR) return null;
        return { kind: "local", filePath };
    }

    return null;
}

/** Reads a response body, refusing anything larger than MAX_PDF_BYTES. */
async function readLimited(response) {
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_PDF_BYTES) throw new Error("the PDF is larger than 20 MB");
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
        total += chunk.length;
        if (total > MAX_PDF_BYTES) throw new Error("the PDF is larger than 20 MB");
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function downloadPdf(fileUrl, { fetchImpl = fetch } = {}) {
    const location = resolvePdfLocation(fileUrl);
    if (!location) throw new Error("the file is not stored in this LMS's file storage");

    if (location.kind === "local") {
        const stat = await fs.promises.stat(location.filePath).catch(() => null);
        if (!stat) throw new Error("the uploaded file is no longer on the server");
        if (stat.size > MAX_PDF_BYTES) throw new Error("the PDF is larger than 20 MB");
        return fs.promises.readFile(location.filePath);
    }

    const response = await fetchImpl(await signedR2Url(location.key), {
        redirect: "error",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`file storage answered ${response.status}`);
    return readLimited(response);
}

/**
 * Everything the student handed in, as text for the evaluator: the typed
 * answer and the text read from the PDF. Problems reading the PDF never stop
 * the evaluation; they become review reasons so the instructor checks it.
 */
async function collectSubmissionText(submission, options = {}) {
    const parts = [];
    const reviewReasons = [];
    const meta = { typed: Boolean(submission.textAnswer && submission.textAnswer.trim()), pdf: null };

    if (meta.typed) parts.push(submission.textAnswer.trim());

    if (submission.fileUrl) {
        meta.pdf = { fileName: submission.fileName || null };
        try {
            const buffer = await downloadPdf(submission.fileUrl, options);
            const read = await extractor.extract(buffer);
            meta.pdf = {
                fileName: submission.fileName || null,
                method: read.method,
                pageCount: read.pageCount,
                ocrPages: read.ocrPages,
                ocrConfidence: read.ocrConfidence,
                hasImages: read.hasImages,
            };
            if (read.text) parts.push(read.text);
            reviewReasons.push(...read.reviewReasons);
        } catch (error) {
            meta.pdf.error = error.message;
            reviewReasons.push(`The PDF could not be read (${error.message}). Mark it from the original file.`);
        }
    }

    return { text: parts.join("\n\n"), meta, reviewReasons };
}

module.exports = {
    collectSubmissionText,
    downloadPdf,
    resolvePdfLocation,
    MAX_PDF_BYTES,
};
