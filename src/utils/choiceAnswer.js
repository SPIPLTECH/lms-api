// How a picked option is compared with the answer key, for every question
// answered by choosing an option. The student's answer is an option's own
// text, so the comparison is exact, case included ("int float" and
// "int Float" are different answers), with one allowance for a plain
// one-line option: repeated spaces count as one, and only when that cannot
// make two of the question's options the same answer.
//
// An option holding code (inline `code`, a ``` block, or more than one
// line) gets no allowance: its spacing, indentation and line breaks are the
// answer ("    print(i)" inside the loop or outside it).
//
// lms_web_demo/src/lib/quizAnswers.js applies this same rule on the
// student's screen. The two must stay identical, or the review page would
// call a scored answer wrong.

/** An option's text as compared: only the ends trimmed and line breaks unified. */
const exactChoiceText = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

const isCodeChoice = (value) => /`|\n/.test(exactChoiceText(value));

const looseChoiceText = (value) => exactChoiceText(value).replace(/\s+/g, " ");

/** Question.options as display texts: plain strings, objects, or a JSON string of either. */
const choiceOptionTexts = (options) => {
  let list = options;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map((opt) =>
    opt && typeof opt === "object" ? String(opt.optionText ?? opt.text ?? "") : String(opt ?? "")
  );
};

/**
 * Whether `selected` is the answer `correct` names. `options` (the
 * question's own) are what keep the loose match from confusing two options;
 * without them it is allowed, as before.
 */
const choiceMatches = (selected, correct, options) => {
  const picked = exactChoiceText(selected);
  const key = exactChoiceText(correct);
  if (!picked || !key) return false;
  if (picked === key) return true;
  if (isCodeChoice(picked) || isCodeChoice(key)) return false;

  const loose = looseChoiceText(key);
  if (looseChoiceText(picked) !== loose) return false;
  return choiceOptionTexts(options).filter((text) => looseChoiceText(text) === loose).length <= 1;
};

/**
 * The index of the option an answer's text names, or -1: the option with
 * exactly that text; failing that, the one option it matches with repeated
 * spaces ignored; failing that (unless `ignoreCase` is off), the one it
 * matches with case ignored too. Never a guess between two options.
 */
const findChoiceIndex = (answer, optionTexts, { ignoreCase = true } = {}) => {
  const texts = optionTexts.map(exactChoiceText);
  const exact = exactChoiceText(answer);
  const found = texts.indexOf(exact);
  if (found >= 0) return found;

  const onlyOne = (same) => {
    const hits = texts.reduce((acc, text, i) => (same(text) ? [...acc, i] : acc), []);
    return hits.length === 1 ? hits[0] : -1;
  };
  const loose = looseChoiceText(exact);
  const byLoose = onlyOne((text) => looseChoiceText(text) === loose);
  if (byLoose >= 0 || !ignoreCase) return byLoose;
  return onlyOne((text) => looseChoiceText(text).toLowerCase() === loose.toLowerCase());
};

module.exports = {
  exactChoiceText,
  isCodeChoice,
  choiceOptionTexts,
  choiceMatches,
  findChoiceIndex,
};
