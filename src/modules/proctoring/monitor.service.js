const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const { captureIntervalSeconds, proctoringSettings } = require("../../config/proctoring");
const { analyzeImage, withoutTemplate } = require("./ai/faceDetection.adapter");
const { noteAnalysisOutcome } = require("./ai/health");
const { analysisQueue, intervalFor } = require("./aiQueue");
const attempts = require("./attempt.service");
const evidence = require("./evidence.service");
const registry = require("./monitorRegistry");
const {
  AI_RULES,
  STUDENT_MESSAGES,
  activeRuns,
  correlationAlert,
  detectViolations,
  getTrustedEventSeverity,
  isCorrelationInput,
  isSuspicious,
  isWarningEligible,
  ruleMet,
} = require("./rules");

/**
 * The monitoring path. Built so exams cannot slow the LMS, which sits about 100 ms from its
 * database. A clean frame writes nothing and no AI work runs on the request path:
 *
 *   upload    token checked in memory, frame saved to disk, queued, response sent
 *   queue     AI call, then the rules over the attempt's in-memory window
 *   counters  flushed about once a minute, for all attempts in one statement
 *   kept      batched across attempts (evidence.service)
 *   flags and terminations  written at once, because they must survive a restart
 */

const FRAME_WINDOW = 40;
const DISK_MS = 70 * 1000;
const VIOLATION_RADIUS_MS = 60 * 1000;
const PERIODIC_EVERY_MS = 60 * 1000;
const LATE_MS = 20 * 1000;
const LATE_RUN_FLAG = 3;
const UNANALYSED_RUN_FLAG = 3;
const SAME_ACTION_MS = 3000;
const EVENT_BATCH_DELAY_MS = 1000;
const EVENT_BATCH_SIZE = 200;
const COUNTER_BATCH = 200;
const FACE_MIN_SCORE = 0.65;
const SENSITIVE_METADATA = ["clipboardContent", "copiedText", "pastedText"];

const pendingEvents = [];
let eventTimer = null;

/* ------------------------------ events ------------------------------ */

async function flushEvents() {
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents.splice(0, EVENT_BATCH_SIZE);
  try {
    await prisma.proctoringEvent.createMany({ data: batch, skipDuplicates: true });
  } catch (error) {
    pendingEvents.unshift(...batch);
    throw error;
  }
  if (pendingEvents.length > 0) await flushEvents();
}

function scheduleEventFlush() {
  if (eventTimer) return;
  eventTimer = setTimeout(() => {
    eventTimer = null;
    flushEvents().catch((error) => console.warn("[proctoring] could not write events; will retry:", error?.message));
  }, EVENT_BATCH_DELAY_MS);
  eventTimer.unref?.();
}

async function flushBuffers() {
  await flushEvents();
  await evidence.flush();
}

function pruneEvents(monitor, now, settings) {
  const cutoff = now.getTime() - settings.correlationWindowSeconds * 1000;
  monitor.events = monitor.events.filter((event) => event.serverTimestamp.getTime() >= cutoff);
}

function recordEvent(monitor, { eventType, metadata = {}, warningIssued = false, seq = null, clientTimestamp = null }, now = new Date()) {
  const event = {
    id: crypto.randomUUID(),
    attemptId: monitor.id,
    eventType,
    severity: getTrustedEventSeverity(eventType),
    warningIssued,
    seq,
    clientTimestamp,
    metadata,
    serverTimestamp: now,
  };
  monitor.events.push(event);
  pruneEvents(monitor, now, proctoringSettings());
  pendingEvents.push(event);
  scheduleEventFlush();
  return event;
}

/* ------------------------------ flags and endings ------------------------------ */

const framesWithin = (monitor, ids) => monitor.frames.filter((frame) => ids.includes(frame.id));

function keepAround(monitor, now) {
  for (const frame of monitor.frames) {
    if (Math.abs(now.getTime() - frame.receivedAt.getTime()) <= VIOLATION_RADIUS_MS) evidence.keepFrame(monitor, frame, frame.analysed === false ? "UNANALYSED" : "VIOLATION", now);
  }
  monitor.violationUntil = new Date(now.getTime() + VIOLATION_RADIUS_MS);
}

async function persistFlags(monitor) {
  try {
    await prisma.proctoredAttempt.update({ where: { id: monitor.id }, data: { isFlagged: true, flags: monitor.flags } });
    await evidence.holdAttemptEvidence(monitor.id);
    monitor.flagsDirty = false;
  } catch (error) {
    // The watchdog tries again: a flag must not be lost to a brief database failure.
    monitor.flagsDirty = true;
    console.warn("[proctoring] could not write a flag; will retry:", error?.message);
  }
}

/** Flags the attempt for review, once per reason. Never tells the student or ends the exam. */
async function raiseFlag(monitor, reason, details = {}) {
  if (monitor.flags.some((flag) => flag.reason === reason)) return;
  const now = new Date();
  monitor.flags.push({ reason, at: now.toISOString(), ...details });
  monitor.isFlagged = true;
  monitor.holdEvidence = true;
  keepAround(monitor, now);
  recordEvent(monitor, { eventType: "ATTEMPT_FLAGGED", metadata: { reason, ...details } }, now);
  await flushBuffers().catch(() => {});
  await persistFlags(monitor);
}

/** Ends the exam. One go per attempt, and retried by the watchdog if the database fails. */
async function terminate(monitor, trigger) {
  if (monitor.ending || monitor.ended) return false;
  monitor.ending = true;
  const now = new Date();
  try {
    monitor.holdEvidence = true;
    for (const frame of framesWithin(monitor, trigger.evidenceFrameIds)) evidence.keepFrame(monitor, frame, "VIOLATION", now);
    keepAround(monitor, now);
    recordEvent(monitor, { eventType: "AUTO_TERMINATION_ENFORCED", metadata: { rule: trigger.rule, sourceEventId: trigger.sourceEventId, evidenceIds: trigger.evidenceFrameIds, ...trigger.metadata } }, now);
    await flushBuffers();
    await attempts.finalizeAttempt(monitor.id, { endReason: "TERMINATED", rule: trigger.rule, terminationReason: trigger.reason, terminatedAt: now });
    monitor.pendingTermination = null;
    return true;
  } catch (error) {
    monitor.pendingTermination = trigger;
    console.error("[proctoring] could not end an exam; will retry:", error?.message);
    return false;
  } finally {
    monitor.ending = false;
  }
}

/** The rules over the current window: correlation first, then what the events call for. */
async function evaluate(monitor, outcome = {}) {
  const settings = proctoringSettings();
  const now = new Date();
  pruneEvents(monitor, now, settings);

  const inputs = monitor.events.filter((event) => isCorrelationInput(event.eventType));
  const alert = correlationAlert(inputs, monitor.lastAlert, settings, now);
  if (alert) {
    const previous = monitor.lastAlert;
    monitor.lastAlert = { at: now, keys: alert.categories.map((category) => category.key), id: null };
    const event = recordEvent(
      monitor,
      {
        eventType: "AI_CORRELATED_ALERT",
        metadata: {
          source: "ai-correlation",
          priority: alert.priority,
          score: alert.score,
          categories: alert.categories,
          evidenceIds: alert.evidenceIds,
          windowSeconds: settings.correlationWindowSeconds,
          escalatesAlertId: previous?.id ?? null,
          note: "Several independent signals occurred close together. Review the evidence; this is not proof of misconduct.",
        },
      },
      now
    );
    monitor.lastAlert.id = event.id;
  }

  // Events are written once, as a run first crosses its threshold. Live figures replace
  // theirs, so "persists for N frames or seconds" can actually be reached.
  const runs = activeRuns(monitor.frames);
  const live = monitor.events.map((event) => {
    const episode = monitor.activeEpisodes?.get(event.eventType);
    const run = runs.find(
      (candidate) =>
        candidate.eventType === event.eventType &&
        (candidate.runStartFrameId === event.metadata?.runStartFrameId || episode?.emittedEventId === event.id)
    );
    return run ? { ...event, metadata: { ...event.metadata, ...run.details, consecutiveSnapshots: run.consecutiveSnapshots, sustainedSeconds: run.sustainedSeconds, evidenceIds: run.evidenceFrameIds } } : event;
  });

  const triggers = detectViolations(live, settings);
  const ending = triggers.find((trigger) => trigger.action === "TERMINATE");
  if (ending) {
    outcome.terminated = (await terminate(monitor, ending)) || outcome.terminated;
    return;
  }
  for (const trigger of triggers) {
    await raiseFlag(monitor, trigger.rule, { sourceEventId: trigger.sourceEventId, ...trigger.metadata });
  }
}

function issueWarning(monitor, now) {
  const maxWarnings = monitor.policy.maxWarnings;
  if (monitor.warningCount >= maxWarnings) return false;
  const cooldownMs = monitor.policy.cooldownSeconds * 1000;
  if (monitor.lastWarningAt && now.getTime() - monitor.lastWarningAt.getTime() < cooldownMs) return false;
  monitor.lastWarningAt = now;
  monitor.warningCount = Math.min(maxWarnings, monitor.warningCount + 1);
  monitor.countersDirty = true;
  return true;
}

function shouldTerminateOnWarningLimit(monitor, settings) {
  if (!settings.autoTerminate) return false;
  if (process.env.PROCTORING_TERMINATE_ON_WARNING_LIMIT !== undefined && process.env.PROCTORING_TERMINATE_ON_WARNING_LIMIT !== "") {
    return settings.terminateOnWarningLimit;
  }
  if (typeof monitor.policy?.terminateOnWarningLimit === "boolean") {
    return monitor.policy.terminateOnWarningLimit;
  }
  return settings.terminateOnWarningLimit;
}

function formatStudentWarning(baseMessage, count, max, willTerminate) {
  const clamped = Math.min(count, max);
  if (clamped >= max) {
    return willTerminate
      ? `Maximum proctoring warning limit reached (${max}/${max}): ${baseMessage} Your exam has been ended.`
      : `Warning threshold reached (${max}/${max}): ${baseMessage} Your attempt has been flagged for review.`;
  }
  if (willTerminate && max >= 2 && clamped === max - 1) {
    return `Proctoring Warning (${clamped}/${max} — Final Warning): ${baseMessage} One more warning will automatically end your exam.`;
  }
  return `Proctoring Warning (${clamped}/${max}): ${baseMessage}`;
}

function currentActiveConditions(monitor) {
  if (!monitor.frames.length || monitor.frames[0]?.analysed !== true) return null;
  return activeRuns(monitor.frames).map((run) => run.eventType);
}

/* ------------------------------ identity ------------------------------ */

const templateToBytes = (values) => {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
};

const bytesToTemplate = (bytes) => {
  const buffer = Buffer.from(bytes);
  const out = [];
  for (let offset = 0; offset + 4 <= buffer.length; offset += 4) out.push(buffer.readFloatLE(offset));
  return out;
};

function cosineSimilarity(a, b) {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

async function loadBaseline(monitor) {
  if (monitor.baseline !== undefined) return monitor.baseline;
  const row = await prisma.proctoringIdentityBaseline.findUnique({ where: { attemptId: monitor.id }, select: { embedding: true, modelSha256: true } });
  monitor.baseline = row ? { vector: bytesToTemplate(row.embedding), modelSha256: row.modelSha256 } : null;
  return monitor.baseline;
}

/** Compares a frame's face with the baseline. Returns a result safe to store: never the template. */
async function resolveIdentity(monitor, raw) {
  const stored = withoutTemplate(raw);
  if (raw.status !== "OK" || !stored.identity || stored.identity.status !== "COMPUTED" || !raw.embedding) return stored;
  const model = stored.identity.model;
  try {
    const baseline = await loadBaseline(monitor);
    if (!baseline || (model && baseline.modelSha256 !== model.sha256)) {
      stored.identity = { status: "NO_BASELINE", model };
      return stored;
    }
    const similarity = Math.round(cosineSimilarity(baseline.vector, raw.embedding) * 1000) / 1000;
    const threshold = proctoringSettings().identityMatchThreshold;
    stored.identity = { status: similarity >= threshold ? "MATCH" : "MISMATCH", similarity, threshold, model };
    return stored;
  } catch (error) {
    console.error("[proctoring] identity check failed safely:", error?.message);
    stored.identity = { status: "FAILED", model };
    return stored;
  }
}

const FACE_CHECK_MESSAGES = {
  NO_FACE: "We could not see your face. Check your camera and lighting, then try again.",
  MULTIPLE_FACES: "We can see more than one face. Make sure you are alone in view, then try again.",
  LOW_SCORE: "We could not see your face clearly. Face the camera in good light, then try again.",
  NOT_ANALYSED: "We could not check your photo just now. Please try again in a moment. No attempt has been used.",
};

function faceCheck(result) {
  if (result.status !== "OK") return { identityCheck: "NOT_ANALYSED", message: FACE_CHECK_MESSAGES.NOT_ANALYSED, notes: "Identity photo could not be analysed." };
  if (result.classification === "NO_FACE") return { identityCheck: "FACE_CHECK_FAILED", message: FACE_CHECK_MESSAGES.NO_FACE, notes: "No face detected in the identity photo." };
  if (result.classification === "MULTIPLE_FACES") return { identityCheck: "FACE_CHECK_FAILED", message: FACE_CHECK_MESSAGES.MULTIPLE_FACES, notes: `More than one face (${result.facesDetected}) detected in the identity photo.` };
  const score = result.faces?.[0]?.score ?? 0;
  if (score < FACE_MIN_SCORE) return { identityCheck: "FACE_CHECK_FAILED", message: FACE_CHECK_MESSAGES.LOW_SCORE, notes: `One face, with low confidence (${Math.round(score * 100)}%).` };
  return { identityCheck: "FACE_CHECK_PASSED", message: null, notes: `One face detected (${Math.round(score * 100)}% confidence).` };
}

/** Queue job: the photo before the exam. This is the only path that writes the baseline. */
async function analyseIdentityPhoto(monitor, frame) {
  const raw = await analyzeImage(frame.path, frame.mimeType, { identity: monitor.identityMatching });
  noteAnalysisOutcome(raw);
  const stored = withoutTemplate(raw);
  let check = faceCheck(stored);
  // A check that cannot make the template cannot monitor identity: it does not pass.
  if (check.identityCheck === "FACE_CHECK_PASSED" && monitor.identityMatching && !raw.embedding) check = faceCheck({ status: "UNAVAILABLE" });
  frame.result = stored;

  const passed = check.identityCheck === "FACE_CHECK_PASSED";
  const failed = check.identityCheck === "FACE_CHECK_FAILED";
  monitor.identityCheck = check.identityCheck;
  monitor.identityFailures += failed ? 1 : 0;
  monitor.cameraSeenAt = monitor.cameraSeenAt ?? frame.receivedAt;

  if (passed && monitor.identityMatching) {
    const model = stored.identity.model ?? { name: "unknown", sha256: "unknown" };
    const data = { embedding: templateToBytes(raw.embedding), modelName: model.name, modelSha256: model.sha256, capturedAt: frame.receivedAt };
    await prisma.proctoringIdentityBaseline.upsert({ where: { attemptId: monitor.id }, create: { attemptId: monitor.id, ...data }, update: data });
    monitor.baseline = { vector: raw.embedding, modelSha256: model.sha256 };
  }
  await prisma.proctoredAttempt.update({
    where: { id: monitor.id, status: "PREPARING" },
    data: { identityCheck: check.identityCheck, identityNotes: check.notes, identityFailures: monitor.identityFailures, cameraSeenAt: monitor.cameraSeenAt },
  });

  if (passed) {
    // A retake replaces the earlier photo.
    const earlier = await prisma.proctoringEvidence.findMany({ where: { attemptId: monitor.id, category: "IDENTITY" } });
    await Promise.all(earlier.map((row) => evidence.deleteEvidence(row)));
    evidence.keepFrame(monitor, frame, "IDENTITY");
  } else {
    await evidence.removeFile(frame.path);
  }
  return { identityCheck: check.identityCheck, message: check.message };
}

/** Queue job: the check on another device. It can never replace the baseline. */
async function analyseIdentityRecheck(monitor, frame) {
  const raw = await analyzeImage(frame.path, frame.mimeType, { identity: monitor.identityMatching });
  noteAnalysisOutcome(raw);
  const result = await resolveIdentity(monitor, raw);
  frame.result = result;
  evidence.keepFrame(monitor, frame, "IDENTITY");

  const clear = async () => {
    monitor.identityRecheckPending = false;
    await prisma.proctoredAttempt.update({ where: { id: monitor.id }, data: { identityRecheckPending: false } });
    return { identityRecheckRequired: false, message: null };
  };

  // An outage must never strand the student: the exam opens, and it is flagged for review.
  if (result.status !== "OK") {
    await raiseFlag(monitor, "IDENTITY_RECHECK_UNVERIFIED", { errorCode: result.errorCode });
    return clear();
  }
  if (result.classification !== "ONE_FACE" || (result.faces?.[0]?.score ?? 0) < FACE_MIN_SCORE) {
    return { identityRecheckRequired: true, message: faceCheck(result).message ?? FACE_CHECK_MESSAGES.LOW_SCORE };
  }
  if (!monitor.identityMatching || result.identity?.status === "MATCH") return clear();
  if (result.identity?.status === "MISMATCH") {
    monitor.identityFailures += 1;
    await raiseFlag(monitor, "IDENTITY_RECHECK_FAILED", { similarity: result.identity.similarity, threshold: result.identity.threshold });
    return { identityRecheckRequired: true, message: "Your photo does not appear to match the one you took before the exam. Please try again in good light." };
  }
  await raiseFlag(monitor, "IDENTITY_RECHECK_UNVERIFIED", { identityStatus: result.identity?.status });
  return clear();
}

/* ------------------------------ exam frames ------------------------------ */

function pruneFrames(monitor, now) {
  while (monitor.frames.length > FRAME_WINDOW) {
    const dropped = monitor.frames.pop();
    if (!dropped.kept) evidence.removeFile(dropped.path);
  }
  for (const frame of monitor.frames) {
    if (frame.path && !frame.kept && now.getTime() - frame.receivedAt.getTime() > DISK_MS) {
      evidence.removeFile(frame.path);
      frame.path = null;
    }
  }
}

function noteUnanalysed(monitor, frame, result, now) {
  frame.result = result;
  frame.analysed = false;
  monitor.framesSkipped += 1;
  monitor.countersDirty = true;
  monitor.unanalysedRun += 1;
  monitor.frames.unshift(frame);
  evidence.keepFrame(monitor, frame, "UNANALYSED", now);
}

async function applyRules(monitor, frame, outcome, settings) {
  const now = new Date();
  for (const [eventType, episode] of [...monitor.activeEpisodes.entries()]) {
    const rule = AI_RULES.find((candidate) => candidate.eventType === eventType);
    const matched = Boolean(rule && frame.result?.status === "OK" && rule.matches(frame.result));
    if (matched) {
      episode.cleanAnalysedStreak = 0;
      episode.lastMatchedAt = frame.receivedAt;
    } else {
      episode.cleanAnalysedStreak += 1;
      const sinceMatchSeconds = (frame.receivedAt.getTime() - episode.lastMatchedAt.getTime()) / 1000;
      if (episode.cleanAnalysedStreak >= settings.episodeClearFrames || sinceMatchSeconds >= settings.episodeClearSeconds) {
        monitor.activeEpisodes.delete(eventType);
      }
    }
  }

  const maxWarnings = monitor.policy.maxWarnings;
  const willTerminateOnLimit = shouldTerminateOnWarningLimit(monitor, settings);
  let latestTriggerEvent = null;
  let latestEvidenceIds = [];

  for (const run of activeRuns(monitor.frames)) {
    const rule = AI_RULES.find((candidate) => candidate.eventType === run.eventType);
    if (!ruleMet(rule, run, settings)) continue;

    for (const kept of framesWithin(monitor, run.evidenceFrameIds)) evidence.keepFrame(monitor, kept, "VIOLATION", now);

    const existingEpisode = monitor.activeEpisodes.get(rule.eventType);
    if (existingEpisode) {
      existingEpisode.lastMatchedAt = frame.receivedAt;
      existingEpisode.cleanAnalysedStreak = 0;
      continue;
    }
    if (monitor.emittedRuns.get(rule.eventType) === run.runStartFrameId) continue;
    monitor.emittedRuns.set(rule.eventType, run.runStartFrameId);

    const atWarningLimitBefore = monitor.warningCount >= maxWarnings;
    const warningIssued = settings.studentWarnings && issueWarning(monitor, now);
    const event = recordEvent(
      monitor,
      {
        eventType: rule.eventType,
        warningIssued,
        metadata: {
          source: rule.source,
          runStartFrameId: run.runStartFrameId,
          consecutiveSnapshots: run.consecutiveSnapshots,
          threshold: rule.threshold(settings, run.details),
          sustainedSeconds: run.sustainedSeconds,
          evidenceIds: run.evidenceFrameIds,
          ...run.details,
          ...(atWarningLimitBefore ? { postWarningLimit: true } : {}),
          studentMessage: STUDENT_MESSAGES[rule.eventType],
          note: "Automated signal for human review; not proof of misconduct.",
        },
      },
      now
    );
    monitor.activeEpisodes.set(rule.eventType, {
      eventType: rule.eventType,
      openedAt: now,
      lastMatchedAt: frame.receivedAt,
      cleanAnalysedStreak: 0,
      emittedEventId: event.id,
    });
    latestTriggerEvent = event;
    latestEvidenceIds = run.evidenceFrameIds;
    if (warningIssued) {
      outcome.warnings.push({
        eventType: rule.eventType,
        message: STUDENT_MESSAGES[rule.eventType],
        currentWarnings: Math.min(monitor.warningCount, maxWarnings),
        maxWarnings,
        willTerminate: willTerminateOnLimit,
      });
    }
  }

  await evaluate(monitor, outcome);

  if (monitor.warningCount >= maxWarnings) {
    await raiseFlag(monitor, "WARNING_LIMIT_REACHED", { warnings: monitor.warningCount, maxWarnings });
    if (!outcome.terminated && willTerminateOnLimit) {
      outcome.terminated =
        (await terminate(monitor, {
          rule: "WARNING_LIMIT_REACHED",
          reason: `Maximum proctoring warning limit reached (${maxWarnings}/${maxWarnings}). Your exam has been ended.`,
          sourceEventId: latestTriggerEvent?.id ?? null,
          evidenceFrameIds: latestEvidenceIds,
          metadata: { warnings: monitor.warningCount, maxWarnings },
        })) || outcome.terminated;
    }
  }

  if (!outcome.terminated && isSuspicious(frame.result) && settings.recheckSeconds > 0) {
    outcome.recheckInMs = settings.recheckSeconds * 1000;
  }
}

/** Queue job: one exam frame. */
async function analyseExamFrame(monitor, frame) {
  const outcome = { warnings: [], terminated: false, recheckInMs: null };
  const settings = proctoringSettings();
  // In flight when the student submitted. A clean attempt keeps no extra frames for this.
  if (monitor.ended) {
    await evidence.removeFile(frame.path);
    return outcome;
  }

  const raw = await analyzeImage(frame.path, frame.mimeType, { identity: monitor.identityMatching });
  noteAnalysisOutcome(raw);
  if (monitor.ended) {
    await evidence.removeFile(frame.path);
    return outcome;
  }
  const now = new Date();

  if (raw.status !== "OK") {
    noteUnanalysed(monitor, frame, withoutTemplate(raw), now);
    if (monitor.unanalysedRun >= UNANALYSED_RUN_FLAG) await raiseFlag(monitor, "AI_UNAVAILABLE", { errorCode: raw.errorCode });
    pruneFrames(monitor, now);
    return outcome;
  }

  frame.result = await resolveIdentity(monitor, raw);
  frame.analysed = true;
  monitor.unanalysedRun = 0;
  monitor.framesAnalysed += 1;
  monitor.countersDirty = true;
  monitor.frames.unshift(frame);

  if (monitor.violationUntil && now <= monitor.violationUntil) {
    evidence.keepFrame(monitor, frame, "VIOLATION", now);
  } else if (!monitor.lastKeptPeriodicAt || now.getTime() - monitor.lastKeptPeriodicAt.getTime() >= PERIODIC_EVERY_MS) {
    monitor.lastKeptPeriodicAt = now;
    evidence.keepFrame(monitor, frame, "PERIODIC", now);
  }

  await applyRules(monitor, frame, outcome, settings);
  pruneFrames(monitor, new Date());
  return outcome;
}

const nextInterval = () => intervalFor(captureIntervalSeconds(), analysisQueue.metrics());

function studentNotice(outcome) {
  if (!outcome) return null;
  const last = outcome.warnings[outcome.warnings.length - 1];
  if (!last && !outcome.terminated && !outcome.recheckInMs) return null;
  return {
    warningIssued: Boolean(last),
    eventType: last?.eventType ?? null,
    message: last ? formatStudentWarning(last.message, last.currentWarnings, last.maxWarnings, last.willTerminate) : null,
    currentWarnings: last?.currentWarnings ?? null,
    maxWarnings: last?.maxWarnings ?? null,
    terminated: outcome.terminated,
    recheckInMs: outcome.terminated ? null : outcome.recheckInMs,
  };
}

const wait = (promise, ms) => {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/** Decides whether a frame is arriving well after the student's camera took it, allowing for a wrong client clock. */
function isLate(monitor, clientCapturedAt, receivedAt) {
  if (!clientCapturedAt) return false;
  const offset = receivedAt.getTime() - clientCapturedAt.getTime();
  monitor.minClockOffsetMs = monitor.minClockOffsetMs === null ? offset : Math.min(monitor.minClockOffsetMs, offset);
  return offset - monitor.minClockOffsetMs > LATE_MS;
}

/**
 * POST /monitor/snapshots: the file is already on disk. Times come from the server. The
 * browser's claim is kept only as a claim, so a frame can never be backdated into or out of a run.
 */
async function ingestFrame(monitor, file, { type = "PERIODIC_SNAPSHOT", frameId, clientCapturedAt } = {}, { wait: waitForResult = true } = {}) {
  const receivedAt = new Date();
  const settings = proctoringSettings();
  const refuse = async (status, message, code) => {
    await evidence.removeFile(file.path);
    throw new ApiError(status, message, code);
  };

  const id = frameId || crypto.randomUUID();
  if (monitor.seenFrames.has(id)) {
    await evidence.removeFile(file.path);
    return { frameId: id, duplicate: true, nextIntervalSeconds: nextInterval() };
  }

  const claimed = clientCapturedAt ? new Date(clientCapturedAt) : null;
  const frame = {
    id,
    type,
    path: file.path,
    mimeType: file.mimetype,
    size: file.size,
    receivedAt,
    clientCapturedAt: claimed && !Number.isNaN(claimed.getTime()) ? claimed : null,
    late: false,
    result: null,
    analysed: null,
    kept: false,
  };

  if (type === "PRE_EXAM_IDENTITY") {
    if (monitor.status !== "PREPARING") await refuse(409, "The identity photo cannot be changed once the exam has started.", "IDENTITY_LOCKED");
    return runIdentityJob(monitor, frame, analyseIdentityPhoto, settings, () => ({ identityCheck: "NOT_ANALYSED", message: FACE_CHECK_MESSAGES.NOT_ANALYSED }));
  }
  if (type === "IDENTITY_RECHECK") {
    if (monitor.status !== "IN_PROGRESS" || !monitor.identityRecheckPending) await refuse(409, "No identity check is needed right now.", "IDENTITY_RECHECK_NOT_PENDING");
    return runIdentityJob(monitor, frame, analyseIdentityRecheck, settings, () => ({ identityRecheckRequired: true, message: FACE_CHECK_MESSAGES.NOT_ANALYSED }));
  }

  if (monitor.status !== "IN_PROGRESS") await refuse(409, "Monitoring is not running for this attempt.", "MONITORING_NOT_ACTIVE");
  if (monitor.identityRecheckPending) await refuse(409, "Repeat the identity check to continue on this device.", "IDENTITY_RECHECK_REQUIRED");

  monitor.seenFrames.add(id);
  if (monitor.seenFrames.size > FRAME_WINDOW * 5) monitor.seenFrames.delete(monitor.seenFrames.values().next().value);
  if (monitor.lastSnapshotAt) {
    const gapSeconds = Math.round((receivedAt.getTime() - monitor.lastSnapshotAt.getTime()) / 1000);
    monitor.longestGapSeconds = Math.max(monitor.longestGapSeconds ?? 0, gapSeconds);
  }
  monitor.lastSnapshotAt = receivedAt;
  monitor.gapOpen = false;
  monitor.framesReceived += 1;
  monitor.countersDirty = true;

  const base = { frameId: id, nextIntervalSeconds: nextInterval() };

  frame.late = isLate(monitor, frame.clientCapturedAt, receivedAt);
  if (frame.late) {
    // Not analysed and outside the rules, but kept. Delayed on purpose or not, a person can look.
    noteUnanalysed(monitor, frame, { status: "SKIPPED", errorCode: "LATE", facesDetected: null, note: "Arrived late; not analysed." }, receivedAt);
    monitor.unanalysedRun = Math.max(0, monitor.unanalysedRun - 1);
    monitor.lateRun += 1;
    if (monitor.lateRun >= LATE_RUN_FLAG) await raiseFlag(monitor, "FRAMES_ARRIVING_LATE", { frames: monitor.lateRun });
    pruneFrames(monitor, receivedAt);
    return base;
  }
  monitor.lateRun = 0;

  let settled = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const queued = analysisQueue.enqueue({
    attemptId: monitor.id,
    run: () => analyseExamFrame(monitor, frame),
    onDone: (outcome) => {
      resolveDone(outcome);
      // Nobody is waiting any more: the next heartbeat or upload carries it.
      if (settled) {
        const notice = studentNotice(outcome);
        if (notice) monitor.notices.push(notice);
      }
    },
  });
  if (!queued) {
    noteUnanalysed(monitor, frame, { status: "SKIPPED", errorCode: "QUEUE_FULL", facesDetected: null, note: "The analysis queue was full; frame kept for manual review." }, receivedAt);
    if (monitor.unanalysedRun >= UNANALYSED_RUN_FLAG) await raiseFlag(monitor, "AI_UNAVAILABLE", { errorCode: "QUEUE_FULL" });
    return base;
  }

  const outcome = waitForResult && settings.uploadWaitMs > 0 ? await wait(done, settings.uploadWaitMs) : undefined;
  settled = true;
  const notice = studentNotice(outcome) ?? monitor.notices.shift() ?? null;
  const activeConditions = currentActiveConditions(monitor);
  return {
    ...base,
    ...(activeConditions !== null ? { activeConditions } : {}),
    ...(notice ? { proctoring: notice } : {}),
  };
}

async function runIdentityJob(monitor, frame, job, settings, unavailable) {
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const queued = analysisQueue.enqueue({ attemptId: monitor.id, priority: true, run: () => job(monitor, frame), onDone: (outcome) => resolveDone(outcome) });
  if (!queued) {
    await evidence.removeFile(frame.path);
    return { frameId: frame.id, ...unavailable(), nextIntervalSeconds: nextInterval() };
  }
  const outcome = await wait(done, settings.identityWaitMs);
  return { frameId: frame.id, ...(outcome ?? unavailable()), nextIntervalSeconds: nextInterval() };
}

/* ------------------------------ client events ------------------------------ */

const isSameActionKey = (eventType) => (eventType === "TAB_HIDDEN" || eventType === "WINDOW_BLUR" ? "FOCUS" : eventType);

function warningMessage(eventType, count, max, willTerminate) {
  const base = `Unallowed activity detected (${eventType.replace(/_/g, " ")}). Please return to the exam.`;
  return formatStudentWarning(base, count, max, willTerminate);
}

/** POST /monitor/events: what the browser saw. Severity and AI signals belong to the server. */
async function ingestEvent(monitor, input) {
  if (monitor.status !== "IN_PROGRESS") throw new ApiError(409, "Monitoring is not running for this attempt.", "MONITORING_NOT_ACTIVE");

  const now = new Date();
  const settings = proctoringSettings();
  const maxWarnings = monitor.policy.maxWarnings;
  const willTerminateOnLimit = shouldTerminateOnWarningLimit(monitor, settings);
  const snapshot = (extra = {}) => ({
    warningIssued: false,
    currentWarnings: Math.min(monitor.warningCount, maxWarnings),
    maxWarnings,
    terminated: false,
    ...extra,
  });
  const duplicate = () => ({ deduplicated: true, policyResult: snapshot(), nextIntervalSeconds: nextInterval() });

  if (input.seq !== undefined) {
    if (monitor.seenSeq.has(input.seq)) return duplicate();
    monitor.seenSeq.add(input.seq);
  }
  const key = isSameActionKey(input.eventType);
  const windowMs = input.eventType === "VOICE_ACTIVITY_DETECTED" ? Math.max(SAME_ACTION_MS, settings.voiceCooldownSeconds * 1000) : SAME_ACTION_MS;
  const last = monitor.lastSameActionAt[key];
  if (last && now.getTime() - last.getTime() < windowMs) return duplicate();
  monitor.lastSameActionAt[key] = now;

  if (input.eventType === "MICROPHONE_UNAVAILABLE" && monitor.microphoneStatus !== "REFUSED") {
    monitor.microphoneStatus = "REFUSED";
    await prisma.proctoredAttempt.update({ where: { id: monitor.id }, data: { microphoneStatus: "REFUSED" } }).catch(() => {});
  }

  const metadata = { ...(input.metadata || {}) };
  for (const name of SENSITIVE_METADATA) delete metadata[name];

  const eligible = isWarningEligible(input.eventType);
  const atWarningLimitBefore = monitor.warningCount >= maxWarnings;
  const warningIssued = eligible && issueWarning(monitor, now);
  const recorded = recordEvent(
    monitor,
    {
      eventType: input.eventType,
      warningIssued,
      seq: input.seq ?? null,
      clientTimestamp: input.clientTimestamp ? new Date(input.clientTimestamp) : null,
      metadata: atWarningLimitBefore && eligible ? { ...metadata, postWarningLimit: true } : metadata,
    },
    now
  );

  if (input.eventType === "CAMERA_INTERRUPTED" || input.eventType === "CAMERA_DENIED") await raiseFlag(monitor, "CAMERA_LOST", { eventType: input.eventType });

  const outcome = { terminated: false };
  if (isCorrelationInput(input.eventType)) await evaluate(monitor, outcome);

  if (monitor.warningCount >= maxWarnings) {
    await raiseFlag(monitor, "WARNING_LIMIT_REACHED", { warnings: monitor.warningCount, maxWarnings });
    if (!outcome.terminated && willTerminateOnLimit) {
      outcome.terminated =
        (await terminate(monitor, {
          rule: "WARNING_LIMIT_REACHED",
          reason: `Maximum proctoring warning limit reached (${maxWarnings}/${maxWarnings}). Your exam has been ended.`,
          sourceEventId: recorded.id,
          evidenceFrameIds: [],
          metadata: { warnings: monitor.warningCount, maxWarnings, triggerEventType: input.eventType },
        })) || outcome.terminated;
    }
  }

  const clampedWarnings = Math.min(monitor.warningCount, maxWarnings);
  return {
    deduplicated: false,
    policyResult: snapshot({
      warningIssued,
      terminated: outcome.terminated,
      ...(warningIssued
        ? {
            eventType: input.eventType,
            message: warningMessage(input.eventType, clampedWarnings, maxWarnings, willTerminateOnLimit),
          }
        : {}),
    }),
    nextIntervalSeconds: nextInterval(),
  };
}

/* ------------------------------ heartbeat and context ------------------------------ */

/** POST /monitor/heartbeat: in memory, unless the microphone state changed. */
async function heartbeat(monitor, { microphoneStatus } = {}) {
  const now = new Date();
  monitor.lastHeartbeatAt = now;
  monitor.countersDirty = true;
  if (microphoneStatus && microphoneStatus !== monitor.microphoneStatus) {
    monitor.microphoneStatus = microphoneStatus;
    await prisma.proctoredAttempt.update({ where: { id: monitor.id }, data: { microphoneStatus } });
  }
  const notice = monitor.notices.shift() ?? null;
  const activeConditions = currentActiveConditions(monitor);
  return {
    status: monitor.status,
    serverNow: now,
    deadlineAt: monitor.deadlineAt,
    identityRecheckRequired: monitor.identityRecheckPending,
    nextIntervalSeconds: nextInterval(),
    ...(activeConditions !== null ? { activeConditions } : {}),
    ...(notice ? { proctoring: notice } : {}),
  };
}

/** GET /monitor/context */
const context = (monitor) => ({
  attemptId: monitor.id,
  status: monitor.status,
  serverNow: new Date(),
  deadlineAt: monitor.deadlineAt,
  identityCheck: monitor.identityCheck,
  identityMatching: monitor.identityMatching,
  identityRecheckRequired: monitor.identityRecheckPending,
  cameraReady: Boolean(monitor.cameraSeenAt),
  microphoneStatus: monitor.microphoneStatus,
  captureIntervalSeconds: nextInterval(),
  warningCount: Math.min(monitor.warningCount, monitor.policy.maxWarnings),
  maxWarnings: monitor.policy.maxWarnings,
});

/* ------------------------------ background work ------------------------------ */

/** Writes the counters of every attempt that changed, in one statement per 200 attempts. */
async function flushCounters(only = null) {
  const dirty = (only ?? registry.all()).filter((monitor) => monitor.countersDirty);
  for (let i = 0; i < dirty.length; i += COUNTER_BATCH) {
    const batch = dirty.slice(i, i + COUNTER_BATCH);
    const iso = (date) => (date ? date.toISOString() : null);
    await prisma.$executeRaw`
      UPDATE "ProctoredAttempt" AS a SET
        "framesReceived" = v.received,
        "framesAnalysed" = v.analysed,
        "framesSkipped" = v.skipped,
        "warningCount" = v.warnings,
        "longestGapSeconds" = v.gap,
        "lastHeartbeatAt" = v.heartbeat::timestamptz AT TIME ZONE 'UTC',
        "lastSnapshotAt" = v.snapshot::timestamptz AT TIME ZONE 'UTC'
      FROM unnest(
        ${batch.map((monitor) => monitor.id)}::text[],
        ${batch.map((monitor) => monitor.framesReceived)}::int[],
        ${batch.map((monitor) => monitor.framesAnalysed)}::int[],
        ${batch.map((monitor) => monitor.framesSkipped)}::int[],
        ${batch.map((monitor) => monitor.warningCount)}::int[],
        ${batch.map((monitor) => monitor.longestGapSeconds ?? null)}::int[],
        ${batch.map((monitor) => iso(monitor.lastHeartbeatAt))}::text[],
        ${batch.map((monitor) => iso(monitor.lastSnapshotAt))}::text[]
      ) AS v(id, received, analysed, skipped, warnings, gap, heartbeat, snapshot)
      WHERE a."id" = v.id`;
    for (const monitor of batch) monitor.countersDirty = false;
  }
}

/** Notices what no request will: stopped uploads, and any write that must be retried. */
async function watchdogTick(now = new Date()) {
  const settings = proctoringSettings();
  for (const monitor of registry.all()) {
    if (monitor.ended || monitor.status !== "IN_PROGRESS") continue;
    pruneFrames(monitor, now);
    if (monitor.pendingTermination && !monitor.ending) await terminate(monitor, monitor.pendingTermination);
    if (monitor.ended) continue;
    if (monitor.flagsDirty) await persistFlags(monitor);

    const graceOver = !monitor.gapGraceUntil || now.getTime() - monitor.gapGraceUntil.getTime() >= settings.uploadGapSeconds * 1000;
    const since = monitor.lastSnapshotAt ?? monitor.startedAt ?? null;
    if (!since || monitor.gapOpen || monitor.identityRecheckPending || !graceOver) continue;
    const gapSeconds = Math.round((now.getTime() - since.getTime()) / 1000);
    if (gapSeconds < settings.uploadGapSeconds) continue;
    monitor.gapOpen = true;
    monitor.longestGapSeconds = Math.max(monitor.longestGapSeconds ?? 0, gapSeconds);
    monitor.countersDirty = true;
    recordEvent(monitor, { eventType: "MONITORING_GAP", metadata: { gapSeconds, since: since.toISOString() } }, now);
    // Possibly the student's network, or our own outage: a person decides, nothing ends.
    await raiseFlag(monitor, "UPLOADS_STOPPED", { gapSeconds });
  }
  // Closed attempts stay a short while to answer late requests cheaply, then go.
  for (const monitor of registry.all()) {
    if (monitor.ended && monitor.endedSeenAt && now.getTime() - monitor.endedSeenAt.getTime() > 10 * 60 * 1000) registry.remove(monitor.id);
    else if (monitor.ended && !monitor.endedSeenAt) monitor.endedSeenAt = now;
  }
}

/**
 * After a restart: running attempts get their monitors back, so a student who never returns
 * is still noticed, and frames left on disk are kept as unanalysed evidence. Frame runs
 * start again, which errs toward not ending an exam.
 */
async function recoverAfterRestart() {
  await flushBuffers();
  const monitors = await registry.loadAllInProgress();
  const running = registry.all().filter((monitor) => monitor.status === "IN_PROGRESS");
  const waiting = await prisma.proctoringEvidence.findMany({
    where: { attemptId: { in: running.map((monitor) => monitor.id) }, tempPath: { not: null } },
    select: { tempPath: true },
  });
  const known = new Set(waiting.map((row) => path.resolve(row.tempPath)));
  const live = new Set(running.flatMap((monitor) => monitor.frames.map((frame) => frame.path && path.resolve(frame.path))));
  let frames = 0;
  for (const monitor of running) {
    const dir = evidence.attemptTempDir(monitor.id);
    const names = await fs.promises.readdir(dir).catch(() => []);
    for (const name of names) {
      const file = path.join(dir, name);
      if (known.has(path.resolve(file)) || live.has(path.resolve(file))) continue;
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat?.isFile()) continue;
      const now = new Date();
      evidence.keepFrame(monitor, { id: crypto.randomUUID(), type: "PERIODIC_SNAPSHOT", path: file, mimeType: "image/jpeg", size: stat.size, receivedAt: stat.mtime, result: { status: "SKIPPED", errorCode: "RESTART", facesDetected: null, note: "Left on disk by a restart; not analysed." }, analysed: false, kept: false }, "UNANALYSED", now);
      frames += 1;
    }
  }
  await evidence.retryUnstored();
  return { monitors, frames };
}

registry.onEnded(async (monitor) => {
  // Everything still only in memory is written before it goes.
  await flushBuffers().catch((error) => console.warn("[proctoring] could not write events at close; will retry:", error?.message));
  await flushCounters([monitor]).catch((error) => console.warn("[proctoring] could not write counters at close:", error?.message));
  monitor.endedSeenAt = new Date();
  for (const frame of monitor.frames) {
    if (frame.path && !frame.kept) {
      await evidence.removeFile(frame.path);
      frame.path = null;
    }
  }
});

module.exports = {
  context,
  flushBuffers,
  flushCounters,
  heartbeat,
  ingestEvent,
  ingestFrame,
  recoverAfterRestart,
  watchdogTick,
};
