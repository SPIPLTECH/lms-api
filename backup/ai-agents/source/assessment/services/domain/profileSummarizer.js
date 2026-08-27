/**
 * Reduces a StudentProfile row to only the fields that plausibly help the
 * LLM tailor question phrasing/examples to this student's background.
 * Deliberately excludes contact/location PII (phone, city, country,
 * college name) that has no bearing on assessment content and shouldn't
 * leave this process in a third-party API call.
 *
 * @param {object} profile - a StudentProfile row
 * @returns {object}
 */
const summarizeProfile = (profile) => {
  const ageYears = profile.dateOfBirth
    ? Math.floor((Date.now() - new Date(profile.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  return {
    ageYears,
    highestQualification: profile.highestQualification || profile.education || null,
    currentQualification: profile.currentQualification || null,
    branchOrStream: profile.branchOrStream || null,
    employmentStatus: profile.employmentStatus || null,
    yearsOfExperience: profile.yearsOfExperience ?? null,
    currentJobRole: profile.currentJobRole || null,
    careerGoal: profile.careerGoalText || null,
    learningGoal: profile.learningGoals || null,
    preferredLearningStyle: profile.preferredLearningStyle || null,
    technicalSkills: profile.technicalSkills || [],
  };
};

module.exports = { summarizeProfile };
