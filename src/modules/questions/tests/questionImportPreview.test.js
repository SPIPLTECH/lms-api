const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { normalizeQuestion } = require("../../../utils/helpers/question.helper");
const { previewFile, PREVIEW_MAX_QUESTIONS } = require("../question.import.service");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "question-preview-"));
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// Mirrors what multer's disk storage hands the controller.
const upload = (name, content) => {
  const filePath = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(filePath, content);
  return { path: filePath, originalname: name, size: Buffer.byteLength(content) };
};

// A one-page PDF with the given lines of text (none for a "scanned" page).
const makePdf = (lines) => {
  const text = lines.map((l, i) => `BT /F1 11 Tf 40 ${780 - i * 16} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  return `${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
};

test("answer keys written as letters, numbers or option text resolve to the option", () => {
  const options = ["Venus", "Mars", "Jupiter", "Saturn"];
  for (const answer of ["b", "B", "(b)", "b)", "B.", "Option B", "option 2", "2", "mars", "  MARS "]) {
    assert.equal(normalizeQuestion({ question: "Red planet?", options, correctAnswer: answer }).correctAnswer, "Mars", answer);
  }
});

test("an option's own text wins over reading it as an option number", () => {
  const q = normalizeQuestion({ question: "1 + 2?", options: ["3", "4", "5"], correctAnswer: "3" });
  assert.equal(q.correctAnswer, "3");
});

test("several answers separated by semicolons; an option containing a comma stays one answer", () => {
  const multi = normalizeQuestion({ question: "Primes?", options: ["2", "4", "5", "9"], correctAnswer: "A;C" });
  assert.deepEqual(multi.correctAnswer, ["2", "5"]);
  assert.equal(multi.questionType, "MULTIPLE_CORRECT");

  const single = normalizeQuestion({ question: "Capital?", options: ["Paris, France", "Rome, Italy"], correctAnswer: "paris, france" });
  assert.equal(single.correctAnswer, "Paris, France");
});

test("CSV preview: ready rows, flagged rows, composer types, nothing written", async () => {
  const csv = [
    "question,optionA,optionB,optionC,optionD,correctAnswer,marks,difficulty,explanation",
    '"Red planet?",Venus,Mars,Jupiter,Saturn,b,2,EASY,"Iron oxide"',
    '"Pick the primes",2,4,5,9,"A;C",1,MEDIUM,',
    '"True or false: the sun is a star",True,False,,,True,1,EASY,',
    '"No answer given",One,Two,,,,1,EASY,',
    '"Answer not an option",One,Two,,,Three,1,EASY,',
    '"Describe recursion",,,,,"A function calling itself",5,HARD,',
  ].join("\n");
  const file = upload("questions.csv", csv);

  const { questions, summary } = await previewFile(file);

  assert.equal(fs.existsSync(file.path), false, "temp file is removed");
  assert.deepEqual(summary, { total: 6, ready: 3, withProblems: 3 });

  const [mars, primes, trueFalse, noAnswer, notAnOption, written] = questions;
  assert.deepEqual(
    { type: mars.questionType, answer: mars.correctAnswer, marks: mars.marks, problems: mars.problems },
    { type: "MCQ_SINGLE", answer: "Mars", marks: 2, problems: [] }
  );
  assert.deepEqual([primes.questionType, primes.correctAnswer], ["MCQ_MULTI", ["2", "5"]]);
  assert.deepEqual([trueFalse.questionType, trueFalse.options, trueFalse.correctAnswer], ["MCQ_SINGLE", ["True", "False"], "True"]);
  assert.match(noAnswer.problems.join(" "), /Correct answer is required/);
  assert.match(notAnOption.problems.join(" "), /does not exist in options/);
  assert.match(written.problems.join(" "), /can't be imported here yet/);
  assert.equal(notAnOption.row, 5);
});

test("PDF question paper: numbered questions, lettered options, Answer line", async () => {
  const pdf = makePdf([
    "1. Which hook manages state in React?",
    "A) useEffect",
    "B) useState",
    "C) useMemo",
    "Answer: B",
    "2. JSX stands for?",
    "A) Java Syntax",
    "B) JavaScript XML",
    "Answer: JavaScript XML",
  ]);
  const { questions, summary } = await previewFile(upload("paper.pdf", pdf));
  assert.equal(summary.ready, 2, JSON.stringify(questions));
  assert.deepEqual(questions.map((q) => q.correctAnswer), ["useState", "JavaScript XML"]);
});

test("a PDF with no readable text explains why instead of importing nothing", async () => {
  await assert.rejects(previewFile(upload("scan.pdf", makePdf([]))), (err) => {
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /scanned/);
    return true;
  });
});

test("files over the question limit are refused with the count", async () => {
  const rows = ["question,optionA,optionB,correctAnswer"];
  for (let i = 0; i <= PREVIEW_MAX_QUESTIONS; i += 1) rows.push(`"Q${i}",Yes,No,Yes`);
  await assert.rejects(previewFile(upload("big.csv", rows.join("\n"))), /201 questions/);
});

test("files over 5 MB are refused before parsing", async () => {
  const file = upload("huge.csv", "question,optionA,optionB,correctAnswer\n");
  file.size = 6 * 1024 * 1024;
  await assert.rejects(previewFile(file), /larger than 5 MB/);
  assert.equal(fs.existsSync(file.path), false);
});

test("JSON preview: Arrange Tokens and Match Pairs arrive whole and ready", async () => {
  const json = JSON.stringify([
    { question: "Order the tokens", type: "ARRANGE_TOKENS", options: ["print", "(", "x", ")"], marks: 2 },
    { question: "Match capitals", type: "MATCH_PAIRS", options: { left: ["India", "Japan"], right: ["New Delhi", "Tokyo"] }, marks: 3, difficulty: "EASY" },
    { question: "One token", type: "ARRANGE_TOKENS", options: ["only"] },
    { question: "One pair", type: "MATCH_PAIRS", options: { left: ["a"], right: ["b"] } },
    { question: "Repeated left", type: "MATCH_PAIRS", options: { left: ["a", "a"], right: ["b", "c"] } },
    { question: "Pairs as a list", type: "MATCH_PAIRS", options: ["a => 1", "b -> 2"] },
    { question: "Wrong order key", type: "ARRANGE_TOKENS", options: ["a", "b"], correctAnswer: ["a", "z"] },
  ]);

  const { questions, summary } = await previewFile(upload("mixed.json", json));
  const [tokens, pairs, oneToken, onePair, repeated, listed, wrongKey] = questions;

  assert.deepEqual(summary, { total: 7, ready: 3, withProblems: 4 });
  assert.deepEqual(
    [tokens.questionType, tokens.options, tokens.correctAnswer, tokens.marks, tokens.problems],
    ["ARRANGE_TOKENS", ["print", "(", "x", ")"], ["print", "(", "x", ")"], 2, []]
  );
  assert.deepEqual(
    [pairs.questionType, pairs.options, pairs.correctAnswer, pairs.marks, pairs.problems],
    ["MATCH_PAIRS", { left: ["India", "Japan"], right: ["New Delhi", "Tokyo"] }, { India: "New Delhi", Japan: "Tokyo" }, 3, []]
  );
  assert.match(oneToken.problems.join(" "), /at least 2 tokens/);
  assert.match(onePair.problems.join(" "), /at least 2 complete pairs/);
  assert.match(repeated.problems.join(" "), /must be different/);
  assert.deepEqual([listed.options, listed.correctAnswer, listed.problems], [{ left: ["a", "b"], right: ["1", "2"] }, { a: "1", b: "2" }, []]);
  assert.match(wrongKey.problems.join(" "), /each token exactly once/);
});

test("CSV preview: a type column brings Arrange Tokens and Match Pairs in from option columns", async () => {
  const csv = [
    "question,type,option1,option2,option3,marks",
    '"Order steps",ARRANGE_TOKENS,"DNS, then TCP",Request,Response,2',
    '"Match codes",match pairs,200 => OK,404 => Not Found,,2',
    '"Plain choice",,One,Two,,1',
  ].join("\n");

  const { questions } = await previewFile(upload("mixed.csv", csv));
  const [tokens, pairs, plain] = questions;

  assert.deepEqual([tokens.questionType, tokens.options, tokens.problems], ["ARRANGE_TOKENS", ["DNS, then TCP", "Request", "Response"], []]);
  assert.deepEqual([pairs.questionType, pairs.correctAnswer, pairs.problems], ["MATCH_PAIRS", { 200: "OK", 404: "Not Found" }, []]);
  assert.equal(plain.questionType, "MCQ_SINGLE");
});

test("saving keeps the types and shapes: normalizing twice changes nothing, and a saved key survives", () => {
  const saved = { question: "Q", questionType: "MATCH_PAIRS", options: { left: ["a", "b"], right: ["2", "1"] }, correctAnswer: { a: "1", b: "2" } };
  const once = normalizeQuestion(saved);
  assert.deepEqual([once.questionType, once.options, once.correctAnswer], ["MATCH_PAIRS", saved.options, saved.correctAnswer]);
  assert.deepEqual(normalizeQuestion(once).correctAnswer, saved.correctAnswer);

  const tokens = normalizeQuestion({ question: "T", questionType: "ARRANGE_TOKENS", options: ["b", "a"], correctAnswer: ["a", "b"] });
  assert.deepEqual([tokens.questionType, tokens.options, tokens.correctAnswer], ["ARRANGE_TOKENS", ["b", "a"], ["a", "b"]]);
});

test("the bulk save route accepts Match Pairs' columns", () => {
  const { bulkCreateQuestionsSchema } = require("../question.validation");
  const { error } = bulkCreateQuestionsSchema.validate({
    questions: [{ question: "Q", questionType: "MATCH_PAIRS", options: { left: ["a", "b"], right: ["1", "2"] }, correctAnswer: { a: "1", b: "2" } }],
  });
  assert.equal(error, undefined);
});
