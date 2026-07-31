const assert = require("assert");
const QuestionUploadParser = require("../src/modules/questions/services/QuestionUploadParser");

async function runQuestionRepoTests() {
  console.log("🚀 Running Question Repository & Bulk Upload Tests...\n");

  // Test 1: QuestionUploadParser JSON validation
  console.log("Test 1: Bulk JSON Question Parsing & Validation...");
  const jsonContent = JSON.stringify([
    {
      title: "Python List Comprehension",
      question: "What is the output of [x*2 for x in range(3)]?",
      type: "MCQ_SINGLE",
      subject: "Python",
      topic: "Lists",
      difficulty: "EASY",
      marks: 2,
      options: [
        { optionText: "[0, 2, 4]", isCorrect: true },
        { optionText: "[0, 1, 2]", isCorrect: false },
        { optionText: "[2, 4, 6]", isCorrect: false }
      ],
      correctAnswer: "[0, 2, 4]"
    },
    {
      title: "Duplicate Test Question",
      question: "What is the output of [x*2 for x in range(3)]?", // Duplicate
      type: "MCQ_SINGLE",
      marks: 1
    },
    {
      title: "Invalid Marks Question",
      question: "How does async await work?",
      type: "SHORT_ANSWER",
      marks: -5 // Invalid marks
    }
  ]);

  const buffer = Buffer.from(jsonContent, "utf-8");
  const report = await QuestionUploadParser.parseAndValidate(buffer, "questions.json", "test-instructor-1");

  assert.strictEqual(report.total, 3, "Should process 3 rows");
  assert.strictEqual(report.successCount, 1, "Should have 1 successful question");
  assert.strictEqual(report.failedCount, 2, "Should have 2 failed questions");
  assert.strictEqual(report.duplicateCount, 1, "Should detect 1 duplicate");
  assert.strictEqual(report.errors.length, 2, "Should record 2 validation errors");

  console.log("  ✓ JSON Bulk Upload Parser & Validation passed! Errors recorded:\n", report.errors.map(e => `    - [${e.code}] ${e.message}`));

  console.log("\n🎉 ALL QUESTION REPOSITORY TESTS PASSED SUCCESSFULLY!");
}

runQuestionRepoTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
