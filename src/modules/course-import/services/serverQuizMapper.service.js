/**
 * Server-side port of the Composer's mappers/quizMapper.js, applied at
 * import time so a detected quiz block becomes a real backend-gradable
 * Question exactly the way it would if an instructor authored it by hand
 * in the Composer and saved it (see ContentBlockCard.handleSave).
 */

const isBackendGradable = (block) => {
  if (!block) return false;
  switch (block.answerType) {
    case "chooseOne":
    case "chooseMultiple":
      return true;
    case "fill-in-the-blanks":
      return (block.correctAnswer || []).length === 1;
    default:
      return false;
  }
};

// An option may be a plain string or an { optionText, explanation, ... }
// object; the answer key is always the option's text, which is what the
// scorer compares a submitted answer against.
const optionTextAt = (options, index) => {
  const opt = options[index];
  return opt && typeof opt === "object" ? String(opt.optionText ?? opt.text ?? "") : opt;
};

const mapAnswerToBackendQuestion = (block) => {
  if (!isBackendGradable(block)) return null;

  const options = block.options || [];
  const correctAnswer = block.correctAnswer || [];

  switch (block.answerType) {
    case "chooseOne":
      return { questionType: "MCQ", correctAnswer: optionTextAt(options, correctAnswer[0]) };
    case "chooseMultiple":
      return { questionType: "MULTIPLE_CORRECT", correctAnswer: correctAnswer.map((i) => optionTextAt(options, i)) };
    case "fill-in-the-blanks":
      return { questionType: "FILL_BLANK", correctAnswer: correctAnswer[0] };
    default:
      return null;
  }
};

const buildQuestionPayload = (block, { courseId, moduleId, quizId }) => {
  const mapped = mapAnswerToBackendQuestion(block);
  if (!mapped) return null;

  return {
    quizId,
    courseId,
    moduleId,
    question: block.question || "",
    questionType: mapped.questionType,
    options: block.options || [],
    correctAnswer: mapped.correctAnswer,
    explanation: block.explanation || "",
    marks: block.points || 1,
    order: 1,
  };
};

const buildQuizPayload = (block, { courseId, lessonTitle }) => ({
  title: `${lessonTitle} — Quiz`,
  courseId,
  passingScore: 60,
  isPublished: false,
  status: "DRAFT",
});

module.exports = { isBackendGradable, buildQuestionPayload, buildQuizPayload };
