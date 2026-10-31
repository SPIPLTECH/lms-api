const crypto = require("crypto");

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

const COMMON_AFTER = [
  "A sustained phone or second person ends the exam. Other events are flagged for your instructor to review. A person makes the decision on any flag.",
  "Photos linked to an event are kept for 90 days or until the review closes, whichever is later. If nothing is flagged, your identity photo and one photo a minute are kept for 7 days. Other photos are deleted within an hour of the exam closing.",
  "Your course instructor and platform administrators can view these photos, and each view is logged. You can see your own photos.",
];

const WITH_IDENTITY = "Before the exam you take an identity photo. We make a face template from it and compare your face to it during the exam. The template is deleted when the attempt ends.";
const WITHOUT_IDENTITY = "Before the exam you take an identity photo, and we check that one face is visible. Your face is not compared to it during the exam.";

const build = (wordingVersion, identityLine) => {
  const text = [...COMMON_BEFORE, identityLine, ...COMMON_AFTER].join("\n\n");
  return { wordingVersion, text, wordingHash: crypto.createHash("sha256").update(text).digest("hex") };
};

const VERSIONS = {
  true: build("2026-10-31-draft-identity", WITH_IDENTITY),
  false: build("2026-10-31-draft-no-identity", WITHOUT_IDENTITY),
};

const consentWording = (identityMatching) => VERSIONS[Boolean(identityMatching)];

module.exports = { consentWording };
