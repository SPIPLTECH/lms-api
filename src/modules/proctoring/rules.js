/**
 * The monitoring rules as pure functions over an attempt's recent frames and events.
 * Ported from ProctorGuard (policy, temporal, correlation and auto-termination services),
 * with the database reads replaced by in-memory windows:
 * a sustained phone, a sustained second person, or reaching the warning limit (when
 * terminateOnWarningLimit is enabled, the default) ends an exam; every other rule flags for review.
 *
 * Results are signals for human review, never proof of misconduct.
 */

const DEFAULT_POLICY = { maxWarnings: 3, cooldownSeconds: 5, terminateOnWarningLimit: true };

/** Server-derived severity; whatever a client claims is ignored. */
function getTrustedEventSeverity(eventType) {
  switch (eventType) {
    case "AUTO_TERMINATION_ENFORCED":
      return "CRITICAL";
    case "FULLSCREEN_EXIT":
    case "CAMERA_DENIED":
    case "CAMERA_INTERRUPTED":
    case "SCREENSHOT_ATTEMPT":
    case "SCREEN_SHARE_ATTEMPT":
    case "IDENTITY_MISMATCH_DETECTED":
    case "ATTEMPT_FLAGGED":
      return "HIGH";
    case "TAB_HIDDEN":
    case "WINDOW_BLUR":
    case "DISCONNECT":
    case "MONITORING_GAP":
    case "FACE_NOT_DETECTED":
    case "MULTIPLE_FACES_DETECTED":
    case "PROHIBITED_OBJECT_DETECTED":
      return "MEDIUM";
    case "HEAD_POSE_AWAY":
    case "VOICE_ACTIVITY_DETECTED":
    case "COPY_ATTEMPT":
    case "PASTE_ATTEMPT":
    case "CUT_ATTEMPT":
    case "CONTEXT_MENU":
      return "LOW";
    default:
      return "INFO";
  }
}

const CATEGORY_OF = {
  TAB_HIDDEN: "tabSwitches",
  WINDOW_BLUR: "windowBlurs",
  FULLSCREEN_EXIT: "fullscreenExits",
  COPY_ATTEMPT: "clipboardActions",
  PASTE_ATTEMPT: "clipboardActions",
  CUT_ATTEMPT: "clipboardActions",
  CONTEXT_MENU: "clipboardActions",
  SCREENSHOT_ATTEMPT: "clipboardActions",
  SCREEN_SHARE_ATTEMPT: "clipboardActions",
  CAMERA_DENIED: "cameraLoss",
  CAMERA_INTERRUPTED: "cameraLoss",
  DISCONNECT: "connectionGaps",
  MONITORING_GAP: "connectionGaps",
  FACE_NOT_DETECTED: "faceAnalysis",
  MULTIPLE_FACES_DETECTED: "faceAnalysis",
  IDENTITY_MISMATCH_DETECTED: "faceAnalysis",
  HEAD_POSE_AWAY: "aiSignals",
  PROHIBITED_OBJECT_DETECTED: "aiSignals",
  VOICE_ACTIVITY_DETECTED: "aiSignals",
};

const isViolationEvent = (eventType) => Boolean(CATEGORY_OF[eventType]);

/** Browser and camera violations of at least medium severity warn. Connection gaps and AI signals here do not. */
function isWarningEligible(eventType) {
  const category = CATEGORY_OF[eventType];
  if (!category || ["connectionGaps", "faceAnalysis", "aiSignals"].includes(category)) return false;
  return ["MEDIUM", "HIGH", "CRITICAL"].includes(getTrustedEventSeverity(eventType));
}

const RISK_WEIGHTS = { fullscreenExits: 25, cameraLoss: 20, tabSwitches: 15, windowBlurs: 10, clipboardActions: 5, connectionGaps: 0, faceAnalysis: 0, aiSignals: 0 };
const RISK_LABELS = {
  fullscreenExits: "Fullscreen exits",
  cameraLoss: "Camera denied/interrupted",
  tabSwitches: "Tab switches",
  windowBlurs: "Window focus lost",
  clipboardActions: "Clipboard / capture attempts",
  connectionGaps: "Connection gaps (context only, not scored)",
  faceAnalysis: "AI face analysis (context only, not scored)",
  aiSignals: "AI signals (context only, not scored)",
};
const WARNING_LIMIT_ESCALATION = 20;

/** Explainable, deterministic risk score for the review screen. A review aid, not proof. */
function calculateRisk(events, warningCount, policy = DEFAULT_POLICY) {
  const counts = Object.fromEntries(Object.keys(RISK_WEIGHTS).map((key) => [key, 0]));
  for (const event of events) {
    const category = CATEGORY_OF[event.eventType];
    if (category) counts[category] += 1;
  }
  const breakdown = Object.keys(counts).map((key) => ({ key, label: RISK_LABELS[key], count: counts[key], weight: RISK_WEIGHTS[key], points: counts[key] * RISK_WEIGHTS[key] }));
  const escalationPoints = warningCount >= policy.maxWarnings ? WARNING_LIMIT_ESCALATION : 0;
  const score = Math.min(100, breakdown.reduce((sum, item) => sum + item.points, 0) + escalationPoints);
  const level = score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";
  const scored = breakdown.filter((item) => item.points > 0).map((item) => `${item.count} × ${item.label.toLowerCase()} (${item.points} pts)`);
  const summary =
    score === 0
      ? "No scored browser or camera events."
      : `Risk score ${score}/100 (${level}): ${scored.join(", ")}${escalationPoints ? `, +${escalationPoints} for reaching the warning limit` : ""}. Review aid only; not proof of misconduct.`;
  return { score, level, breakdown, escalationPoints, summary };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Plain words for students: no scores, no model details. */
const STUDENT_MESSAGES = {
  FACE_NOT_DETECTED: "Your face is not visible to the camera. Stay in front of your webcam.",
  MULTIPLE_FACES_DETECTED: "Another person was detected in your camera view. Only you may be present during the exam.",
  HEAD_POSE_AWAY: "You appear to be looking away from the screen. Please keep your attention focused forward on the exam.",
  PROHIBITED_OBJECT_DETECTED: "A mobile phone or other prohibited object was detected. Put it away now.",
  IDENTITY_MISMATCH_DETECTED: "The person in front of the camera does not appear to match your pre-exam identity photo. Only the registered candidate may take this exam.",
};

/**
 * A rule's event is raised when the latest frames in a row all match. A single frame
 * is rarely enough, and any frame that was not analysed breaks the run, so an outage can
 * never build toward a signal.
 */
const AI_RULES = [
  {
    eventType: "FACE_NOT_DETECTED",
    source: "ai-face-detection",
    threshold: (settings) => settings.faceAbsentConsecutive,
    minSustainedSeconds: (settings) => settings.faceAbsentSustainedSeconds ?? 0,
    matches: (result) => result.classification === "NO_FACE",
    describe: () => ({ signalConfidence: null }),
  },
  {
    eventType: "MULTIPLE_FACES_DETECTED",
    source: "ai-face-detection",
    threshold: (settings) => settings.faceMultipleConsecutive,
    minSustainedSeconds: () => 0,
    matches: (result) => result.classification === "MULTIPLE_FACES",
    describe: (run) => ({
      maxFaces: Math.max(...run.map((result) => result.facesDetected ?? 0)),
      // The weakest second face in the run: a low value means a less certain extra person.
      signalConfidence: round2(Math.min(...run.map((result) => [...(result.faces ?? [])].sort((a, b) => b.score - a.score)[1]?.score ?? 0))),
    }),
  },
  {
    eventType: "HEAD_POSE_AWAY",
    source: "ai-head-pose",
    threshold: (settings) => settings.headPoseConsecutive,
    minSustainedSeconds: (settings) => settings.headPoseSustainedSeconds ?? 0,
    matches: (result) => result.classification === "ONE_FACE" && result.headPose?.orientation === "AWAY",
    describe: (run) => {
      const yaws = run.map((result) => Math.abs(result.headPose?.yawDeg ?? 0));
      const threshold = run[0].headPose?.yawThresholdDeg ?? 35;
      return { direction: run[0].headPose?.direction ?? "UNKNOWN", signalConfidence: round2(Math.min(1, Math.min(...yaws) / Math.max(1, 2 * threshold))) };
    },
  },
  {
    eventType: "PROHIBITED_OBJECT_DETECTED",
    source: "ai-object-detection",
    threshold: (settings, details) => {
      const confidence = details?.signalConfidence ?? 0;
      const minWarn = settings.objectWarnMinConfidence ?? 0.6;
      return confidence >= minWarn ? settings.objectConsecutive : Math.max(2, settings.objectConsecutive);
    },
    minSustainedSeconds: () => 0,
    matches: (result) => result.objects?.status === "OK" && result.objects.items.length > 0,
    describe: (run) => {
      const items = run.flatMap((result) => result.objects?.items ?? []);
      return { labels: [...new Set(items.map((item) => item.label))], signalConfidence: round2(Math.max(...items.map((item) => item.score))) };
    },
  },
  {
    eventType: "IDENTITY_MISMATCH_DETECTED",
    source: "ai-identity",
    threshold: (settings) => settings.identityMismatchConsecutive,
    minSustainedSeconds: () => 0,
    matches: (result) => result.classification === "ONE_FACE" && result.identity?.status === "MISMATCH",
    describe: (run) => {
      const best = Math.max(...run.map((result) => result.identity?.similarity ?? 0));
      const threshold = run[0].identity?.threshold ?? 0.363;
      return { maxSimilarity: round2(best), matchThreshold: threshold, signalConfidence: round2(Math.min(1, Math.max(0, 1 - best / threshold))) };
    },
  },
];

/** Whether an active run satisfies both the consecutive-frame count and minimum sustained duration. */
function ruleMet(rule, run, settings) {
  const neededFrames = rule.threshold(settings, run.details);
  const neededSeconds = rule.minSustainedSeconds ? rule.minSustainedSeconds(settings) : 0;
  return run.consecutiveSnapshots >= neededFrames && run.sustainedSeconds >= neededSeconds;
}

/** The latest frame matches a rule, so a quick re-check is worthwhile. */
const isSuspicious = (result) => result?.status === "OK" && AI_RULES.some((rule) => rule.matches(result));

/** The run still in progress for each rule. `recent` is newest first. */
function activeRuns(recent) {
  const runs = [];
  for (const rule of AI_RULES) {
    let length = 0;
    while (length < recent.length && recent[length].result?.status === "OK" && rule.matches(recent[length].result)) length += 1;
    if (length === 0) continue;
    const frames = recent.slice(0, length);
    runs.push({
      eventType: rule.eventType,
      runStartFrameId: frames[length - 1].id,
      consecutiveSnapshots: length,
      sustainedSeconds: Math.round((frames[0].receivedAt.getTime() - frames[length - 1].receivedAt.getTime()) / 1000),
      evidenceFrameIds: frames.slice(0, 20).map((frame) => frame.id),
      details: rule.describe(frames.map((frame) => frame.result)),
    });
  }
  return runs;
}

const CORRELATION = {
  FACE_NOT_DETECTED: { key: "face_absent", label: "No face in camera", weight: 2, ai: true },
  MULTIPLE_FACES_DETECTED: { key: "multiple_faces", label: "More than one face", weight: 3, ai: true },
  IDENTITY_MISMATCH_DETECTED: { key: "identity_mismatch", label: "Face does not match identity photo", weight: 3, ai: true },
  HEAD_POSE_AWAY: { key: "head_away", label: "Head turned away", weight: 1, ai: true },
  PROHIBITED_OBJECT_DETECTED: { key: "object", label: "Phone / prohibited object", weight: 3, ai: true },
  VOICE_ACTIVITY_DETECTED: { key: "voice", label: "Speech detected", weight: 2, ai: true },
  TAB_HIDDEN: { key: "focus_loss", label: "Left the exam tab/window", weight: 1, ai: false },
  WINDOW_BLUR: { key: "focus_loss", label: "Left the exam tab/window", weight: 1, ai: false },
  FULLSCREEN_EXIT: { key: "fullscreen_exit", label: "Exited fullscreen", weight: 1, ai: false },
  COPY_ATTEMPT: { key: "clipboard", label: "Clipboard use", weight: 1, ai: false },
  PASTE_ATTEMPT: { key: "clipboard", label: "Clipboard use", weight: 1, ai: false },
  CUT_ATTEMPT: { key: "clipboard", label: "Clipboard use", weight: 1, ai: false },
  CAMERA_DENIED: { key: "camera_loss", label: "Camera lost/denied", weight: 2, ai: false },
  CAMERA_INTERRUPTED: { key: "camera_loss", label: "Camera lost/denied", weight: 2, ai: false },
  SCREENSHOT_ATTEMPT: { key: "capture_attempt", label: "Screen capture attempt", weight: 2, ai: false },
  SCREEN_SHARE_ATTEMPT: { key: "capture_attempt", label: "Screen capture attempt", weight: 2, ai: false },
};

const isCorrelationInput = (eventType) => eventType in CORRELATION;

const priorityOf = (score) => (score >= 7 ? "CRITICAL" : score >= 5 ? "HIGH" : score >= 3 ? "MEDIUM" : "LOW");

/** Independent signals add up. Repeats of one signal count once, so one noisy signal cannot raise an alert. */
function summarise(events) {
  const byKey = new Map();
  const evidence = [];
  for (const event of events) {
    const category = CORRELATION[event.eventType];
    if (!category) continue;
    const entry = byKey.get(category.key) ?? { ...category, count: 0, eventIds: [], signalConfidence: null };
    entry.count += 1;
    entry.eventIds.push(event.id);
    const confidence = typeof event.metadata?.signalConfidence === "number" ? event.metadata.signalConfidence : null;
    if (confidence !== null) entry.signalConfidence = Math.max(entry.signalConfidence ?? 0, confidence);
    byKey.set(category.key, entry);
    for (const id of event.metadata?.evidenceIds ?? []) if (!evidence.includes(id)) evidence.push(id);
  }
  const categories = [...byKey.values()].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  const score = categories.reduce((sum, category) => sum + category.weight, 0);
  return { categories, score, priority: priorityOf(score), evidenceIds: evidence.slice(0, 20) };
}

/** Whether a set of window events warrants a new alert, given the last one raised. */
function correlationAlert(events, lastAlert, settings, now) {
  const summary = summarise(events);
  if (summary.categories.length < settings.correlationMinSignals || !summary.categories.some((category) => category.ai)) return null;
  if (lastAlert && now.getTime() - lastAlert.at.getTime() < settings.alertDedupSeconds * 1000) {
    if (summary.categories.every((category) => lastAlert.keys.includes(category.key))) return null;
  }
  return summary;
}

/**
 * What the current events call for, as a list of { rule, action, reason, ... }. `reason`
 * is shown to students and never carries a score. Confidence stays in `metadata` for staff.
 */
function detectViolations(events, settings) {
  const newestFirst = [...events].sort((a, b) => b.serverTimestamp.getTime() - a.serverTimestamp.getTime());
  const find = (type) => newestFirst.find((event) => event.eventType === type);
  const lasted = (meta) => typeof meta.sustainedSeconds !== "number" || meta.sustainedSeconds >= settings.persistSeconds;
  const others = (self, types) => newestFirst.some((event) => event.id !== self.id && types.includes(event.eventType));
  const action = (rule) => (settings.autoTerminate && settings.terminatingRules.includes(rule) ? "TERMINATE" : "FLAG");
  const triggers = [];
  const add = (rule, reason, source, metadata, fixedAction) =>
    triggers.push({ rule, action: fixedAction ?? action(rule), reason, sourceEventId: source.id, evidenceFrameIds: source.metadata?.evidenceIds ?? [], metadata });

  const object = find("PROHIBITED_OBJECT_DETECTED");
  if (object) {
    const meta = object.metadata ?? {};
    const confidence = meta.signalConfidence ?? 0;
    const consecutive = meta.consecutiveSnapshots ?? 1;
    if (confidence >= settings.objectMinConfidence && consecutive >= 2 && lasted(meta)) {
      add("CONFIRMED_PROHIBITED_OBJECT", "A mobile phone or other prohibited item stayed in view during the exam.", object, { labels: meta.labels, confidence, consecutive, sustainedSeconds: meta.sustainedSeconds });
    } else if (confidence >= settings.minConfidence) {
      add("SINGLE_HIGH_CONFIDENCE_OBJECT", "A mobile phone or other prohibited item was seen during the exam.", object, { labels: meta.labels, confidence, consecutive }, "FLAG");
    }
  }

  const faces = find("MULTIPLE_FACES_DETECTED");
  if (faces) {
    const meta = faces.metadata ?? {};
    const confidence = meta.signalConfidence ?? 0;
    const consecutive = meta.consecutiveSnapshots ?? 1;
    if (confidence >= settings.minConfidence && consecutive >= 2 && lasted(meta)) {
      add("PERSISTENT_MULTIPLE_FACES", "Another person stayed in view of the camera during the exam.", faces, { maxFaces: meta.maxFaces, confidence, consecutive, sustainedSeconds: meta.sustainedSeconds });
    }
  }

  const identity = find("IDENTITY_MISMATCH_DETECTED");
  if (identity) {
    const meta = identity.metadata ?? {};
    const consecutive = meta.consecutiveSnapshots ?? 1;
    if (consecutive >= settings.identityFlagConsecutive && lasted(meta)) {
      add("PERSISTENT_IDENTITY_MISMATCH", "The person on camera did not match the identity photo.", identity, { consecutive, maxSimilarity: meta.maxSimilarity, matchThreshold: meta.matchThreshold, confidence: meta.signalConfidence });
    }
  }

  const absence = find("FACE_NOT_DETECTED");
  if (absence) {
    const meta = absence.metadata ?? {};
    const consecutive = meta.consecutiveSnapshots ?? 1;
    const seconds = meta.sustainedSeconds ?? 0;
    if (consecutive >= 3 && (seconds >= 60 || others(absence, ["TAB_HIDDEN", "WINDOW_BLUR", "FULLSCREEN_EXIT", "DISCONNECT"]))) {
      add("PERSISTENT_ABSENCE", "You were away from the camera during the exam.", absence, { consecutive, sustainedSeconds: seconds });
    }
  }

  const alert = find("AI_CORRELATED_ALERT");
  if (alert) {
    const meta = alert.metadata ?? {};
    const strongAi = (meta.categories ?? []).some((category) => category.ai && (category.signalConfidence === null || category.signalConfidence >= settings.minConfidence));
    if (meta.priority === "CRITICAL" && meta.score >= 7 && strongAi) {
      add("CORRELATED_CRITICAL_VIOLATION", "Several monitoring signals occurred together during the exam.", alert, { score: meta.score, categories: (meta.categories ?? []).map((category) => category.key) });
    }
  }

  return triggers;
}

module.exports = {
  AI_RULES,
  DEFAULT_POLICY,
  STUDENT_MESSAGES,
  activeRuns,
  calculateRisk,
  correlationAlert,
  detectViolations,
  getTrustedEventSeverity,
  isCorrelationInput,
  isSuspicious,
  isViolationEvent,
  isWarningEligible,
  priorityOf,
  ruleMet,
  summarise,
};
