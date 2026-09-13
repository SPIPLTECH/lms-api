const prisma = require("../../config/database");

// Zone bands inside the shared per-scope `order` column. Normal items
// (Content, Module, Lesson, Topic) keep their existing small counters
// (1, 2, 3, ...) untouched. Quiz and Assignment each get their own band far
// above any realistic Normal-item count, so a plain `ORDER BY order ASC` (or
// `.sort((a,b) => a.order - b.order)`) always comes out
// Normal -> Quiz -> Assignment with no merge logic required anywhere.
const QUIZ_ORDER_BASE = 1_000_000;
const ASSIGNMENT_ORDER_BASE = 2_000_000;

/**
 * Next order for a Content row in a given parent scope. Content-only as of
 * the canonical-ordering change — Quiz used to share this counter so the two
 * could interleave, which is no longer the desired behavior (Quiz now has
 * its own banded counter via getNextQuizOrder). `field` is one of
 * courseId/moduleId/lessonId/topicId, already resolved by the caller.
 */
const getNextOrder = async (field, id) => {
  const maxContent = await prisma.content.findFirst({
    where: { [field]: id },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  return (maxContent?.order ?? 0) + 1;
};

/**
 * Next order for a Quiz row in a given parent scope — always lands in the
 * Quiz zone (QUIZ_ORDER_BASE+), regardless of how many Normal items share
 * the scope, so a Quiz can never be created inside the Normal zone's number
 * range.
 */
const getNextQuizOrder = async (field, id) => {
  const maxQuiz = await prisma.quiz.findFirst({
    where: { [field]: id, order: { not: null } },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const base = maxQuiz?.order ?? QUIZ_ORDER_BASE;
  return base + 1;
};

/**
 * Next order for an Assignment row in a given parent scope — always lands in
 * the Assignment zone (ASSIGNMENT_ORDER_BASE+), above every Quiz.
 */
const getNextAssignmentOrder = async (field, id) => {
  const maxAssignment = await prisma.assignment.findFirst({
    where: { [field]: id, order: { not: null } },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const base = maxAssignment?.order ?? ASSIGNMENT_ORDER_BASE;
  return base + 1;
};

module.exports = {
  QUIZ_ORDER_BASE,
  ASSIGNMENT_ORDER_BASE,
  getNextOrder,
  getNextQuizOrder,
  getNextAssignmentOrder,
};
