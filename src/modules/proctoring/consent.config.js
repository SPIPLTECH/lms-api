const crypto = require("crypto");

const { proctoringSettings } = require("../../config/proctoring");

/**
 * The consent wording a student accepts before a proctored exam. DRAFT: it needs
 * legal sign-off before go-live. Changing any text means a new version, because each
 * consent record stores the version and a hash of what was shown.
 */

const COMMON_BEFORE = [
  "This exam is proctored.",
  "Your camera takes a photo about every few seconds. The photos are checked automatically for things such as a phone or another person in view.",
  "Your microphone, if you allow it, only measures whether someone is speaking. No sound is recorded or uploaded.",
  "The exam also notes when you leave fullscreen or switch to another window.",
];

const commonAfter = (cleanDays, violationDays) => [
  "A sustained phone or second person ends the exam. Other events are flagged for your instructor to review. A person makes the decision on any flag.",
  `Photos linked to an event are kept for ${violationDays} days or until the review closes, whichever is later. If nothing is flagged, your identity photo and one photo a minute are kept for ${cleanDays} days. Other photos are deleted within an hour of the exam closing.`,
  "Your course instructor and platform administrators can view these photos, and each view is logged. You can see your own photos.",
];

const WITH_IDENTITY = "Before the exam you take an identity photo. We make a face template from it and compare your face to it during the exam. The template is deleted when the attempt ends.";
const WITHOUT_IDENTITY = "Before the exam you take an identity photo, and we check that one face is visible. Your face is not compared to it during the exam.";

const build = (wordingVersion, identityLine, cleanDays, violationDays) => {
  const text = [...COMMON_BEFORE, identityLine, ...commonAfter(cleanDays, violationDays)].join("\n\n");
  return { wordingVersion, text, wordingHash: crypto.createHash("sha256").update(text).digest("hex") };
};

const VERSIONS = {
  true: { name: "2026-10-31-draft-identity", line: WITH_IDENTITY },
  false: { name: "2026-10-31-draft-no-identity", line: WITHOUT_IDENTITY },
};

/** The notice has to state the retention in force, and different words are a different version. */
const consentWording = (identityMatching) => {
  const { name, line } = VERSIONS[Boolean(identityMatching)];
  const { cleanRetentionDays: clean, violationRetentionDays: violation } = proctoringSettings();
  const standard = clean === 7 && violation === 90;
  return build(standard ? name : `${name}-kept-${clean}-${violation}`, line, clean, violation);
};

module.exports = { consentWording };
