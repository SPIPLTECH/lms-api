const fs = require("fs");
const Joi = require("joi");

const { proctoringSettings } = require("../../../config/proctoring");

/**
 * Calls the Python AI through AI_SERVICE_URL, so it can move to its own server later with
 * no code change. Ported from ProctorGuard's HTTP adapter. It never throws: any failure
 * becomes an UNAVAILABLE or ERROR result, so uploads and exams continue. The face template
 * comes back in `embedding` for the caller to use and must never be stored or returned.
 * Use withoutTemplate. Results are review aids, not proof.
 */

const PROVIDER = "lms-proctoring-ai";

const isAiConfigured = (env = process.env) => Boolean(env.AI_SERVICE_URL && env.AI_SERVICE_TOKEN);

const withoutTemplate = ({ embedding, ...rest }) => rest;

function headPoseDirection(pose, settings) {
  if (!pose.reliable) return "UNKNOWN";
  const yawAway = Math.abs(pose.yawDeg) > settings.headPoseYawDeg;
  const pitchAway = settings.headPosePitchDeg > 0 && Math.abs(pose.pitchDeg) > settings.headPosePitchDeg;
  if (!yawAway && !pitchAway) return "FORWARD";
  const yawRatio = Math.abs(pose.yawDeg) / Math.max(1, settings.headPoseYawDeg);
  const pitchRatio = settings.headPosePitchDeg > 0 ? Math.abs(pose.pitchDeg) / settings.headPosePitchDeg : 0;
  if (yawRatio >= pitchRatio) return pose.yawDeg > 0 ? "LEFT" : "RIGHT";
  return pose.pitchDeg > 0 ? "DOWN" : "UP";
}

function headPoseOrientation(pose, settings) {
  if (!pose.reliable) return "UNKNOWN";
  if (Math.abs(pose.yawDeg) > settings.headPoseYawDeg) return "AWAY";
  if (settings.headPosePitchDeg > 0 && Math.abs(pose.pitchDeg) > settings.headPosePitchDeg) return "AWAY";
  return "FORWARD";
}

const box = Joi.object({ x: Joi.number().required(), y: Joi.number().required(), width: Joi.number().required(), height: Joi.number().required() });
const modelInfo = Joi.object({ name: Joi.string().max(100).required(), version: Joi.string().max(50).required(), sha256: Joi.string().max(64).required(), scoreThreshold: Joi.number().required() });
const headPose = Joi.object({
  yawDeg: Joi.number().min(-90).max(90).required(),
  pitchDeg: Joi.number().min(-90).max(90).required(),
  rollDeg: Joi.number().min(-180).max(180).required(),
  reliable: Joi.boolean().required(),
});

/** The AI service's v1 /analyze response. Anything else is treated as an error. */
const analyzeResponse = Joi.object({
  apiVersion: Joi.string().valid("v1").required(),
  status: Joi.string().valid("OK").required(),
  faces: Joi.object({
    count: Joi.number().integer().min(0).max(100).required(),
    classification: Joi.string().valid("NO_FACE", "ONE_FACE", "MULTIPLE_FACES").required(),
    items: Joi.array().items(Joi.object({ score: Joi.number().min(0).max(1).required(), box: box.required(), headPose: headPose.allow(null) })).max(100).required(),
    inferenceMs: Joi.number().min(0).required(),
    model: modelInfo.required(),
  }).required(),
  objects: Joi.object({
    status: Joi.string().valid("OK", "DISABLED", "UNAVAILABLE").required(),
    labels: Joi.array().items(Joi.string().max(40)).max(10).default([]),
    items: Joi.array().items(Joi.object({ label: Joi.string().max(40).required(), score: Joi.number().min(0).max(1).required(), box: box.required() })).max(100).default([]),
    inferenceMs: Joi.number().min(0).default(0),
    model: modelInfo.allow(null),
  }).required(),
  identity: Joi.object({
    status: Joi.string().valid("OK", "NOT_ONE_FACE", "DISABLED", "UNAVAILABLE", "FAILED").required(),
    embedding: Joi.array().items(Joi.number().min(-1.0001).max(1.0001)).min(32).max(1024).allow(null),
    inferenceMs: Joi.number().min(0).default(0),
    model: modelInfo.allow(null),
  }),
  totalMs: Joi.number().min(0).required(),
});

const failure = (status, errorCode, note) => ({ status, facesDetected: null, provider: PROVIDER, errorCode, note });

async function analyzeImage(filePath, mimeType, { identity = false, env = process.env } = {}) {
  if (!isAiConfigured(env)) return failure("UNAVAILABLE", "NOT_CONFIGURED", "Analysis is not configured; frame kept for manual review.");
  const settings = proctoringSettings(env);

  let body;
  try {
    body = await fs.promises.readFile(filePath);
  } catch {
    return failure("ERROR", "FILE_UNREADABLE", "Frame could not be read for analysis.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.aiTimeoutMs);
  let response;
  try {
    const url = new URL("/v1/analyze", env.AI_SERVICE_URL);
    if (!settings.objectDetection) url.searchParams.set("objects", "false");
    if (identity) url.searchParams.set("identity", "true");
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.AI_SERVICE_TOKEN}`, "Content-Type": mimeType },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return failure("UNAVAILABLE", timedOut ? "TIMEOUT" : "SERVICE_UNREACHABLE", timedOut ? "Analysis timed out; frame kept for manual review." : "Analysis service unreachable; frame kept for manual review.");
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.code;
    const errorCode = typeof code === "string" && /^[A-Z_]{1,40}$/.test(code) ? code : `HTTP_${response.status}`;
    // 503 is a model not loaded or a busy service, which passes. Anything else is a request or configuration error.
    return response.status === 503
      ? failure("UNAVAILABLE", errorCode, "Analysis temporarily unavailable; frame kept for manual review.")
      : failure("ERROR", errorCode, "Analysis rejected the frame; frame kept for manual review.");
  }

  const { value: result, error } = analyzeResponse.validate(payload, { allowUnknown: true, convert: false });
  const featureMissing = !error && result.identity?.status === "OK" && !result.identity.embedding;
  if (error || result.faces.items.length !== result.faces.count || featureMissing) {
    return failure("ERROR", "INVALID_RESPONSE", "Analysis returned an invalid response; frame kept for manual review.");
  }

  const pose = result.faces.count === 1 ? result.faces.items[0].headPose ?? null : null;
  return {
    status: "OK",
    facesDetected: result.faces.count,
    classification: result.faces.classification,
    faces: result.faces.items.map((face) => ({ score: face.score, box: face.box, headPose: face.headPose ?? null })),
    model: result.faces.model,
    inferenceMs: result.totalMs,
    headPose: pose
      ? {
          ...pose,
          orientation: headPoseOrientation(pose, settings),
          direction: headPoseDirection(pose, settings),
          yawThresholdDeg: settings.headPoseYawDeg,
          pitchThresholdDeg: settings.headPosePitchDeg,
        }
      : null,
    objects: { status: result.objects.status, labels: result.objects.labels, items: result.objects.items, model: result.objects.model ?? null, inferenceMs: result.objects.inferenceMs },
    ...(result.identity
      ? {
          identity: { status: result.identity.status === "OK" ? "COMPUTED" : result.identity.status, model: result.identity.model ?? null },
          ...(result.identity.status === "OK" && result.identity.embedding ? { embedding: result.identity.embedding } : {}),
        }
      : {}),
    provider: PROVIDER,
    note: "Automated analysis (face count, approximate head pose, objects). A review aid only: it can miss or misread faces and objects.",
  };
}

module.exports = { analyzeImage, isAiConfigured, withoutTemplate };
