const test = require("node:test");
const assert = require("node:assert");

const assignmentService = require("../src/modules/assignments/assignment.service");
const contentService = require("../src/modules/contents/content.service");
const { gradeSubmissionSchema } = require("../src/modules/assignments/assignment.validation");
const prisma = require("../src/config/database");

// Both submission kinds (Assignment rows and lesson-composer Content
// assignments) grade the same way: scoped to their parent, status -> Graded.
const cases = [
  {
    name: "gradeContentSubmission",
    delegate: () => prisma.contentSubmission,
    parentField: "contentId",
    grade: (...args) => contentService.gradeContentSubmission(...args),
  },
  {
    name: "gradeAssignmentSubmission",
    delegate: () => prisma.assignmentSubmission,
    parentField: "assignmentId",
    grade: (...args) => assignmentService.gradeAssignmentSubmission(...args),
  },
];

for (const c of cases) {
  test(c.name, async (t) => {
    const delegate = c.delegate();
    const originals = { findFirst: delegate.findFirst, update: delegate.update };
    t.after(() => {
      delegate.findFirst = originals.findFirst;
      delegate.update = originals.update;
    });

    let findArgs;
    let updates;
    t.beforeEach(() => {
      findArgs = null;
      updates = [];
      delegate.update = async (args) => {
        updates.push(args);
        return { id: args.where.id, ...args.data };
      };
    });

    await t.test("saves grade and feedback and marks it Graded", async () => {
      delegate.findFirst = async (args) => {
        findArgs = args;
        return { id: "sub1" };
      };

      const result = await c.grade("parent1", "sub1", { grade: "A", feedback: "Nice work" });

      assert.deepStrictEqual(findArgs.where, { id: "sub1", [c.parentField]: "parent1" });
      assert.deepStrictEqual(updates[0].data, { grade: "A", feedback: "Nice work", status: "Graded" });
      assert.strictEqual(result.status, "Graded");
    });

    await t.test("empty feedback is stored as null", async () => {
      delegate.findFirst = async () => ({ id: "sub1" });

      await c.grade("parent1", "sub1", { grade: "B", feedback: "" });
      assert.strictEqual(updates[0].data.feedback, null);
    });

    await t.test("404s for a submission outside this parent, writing nothing", async () => {
      delegate.findFirst = async () => null;

      await assert.rejects(c.grade("parent1", "other", { grade: "A" }), (err) => err.statusCode === 404);
      assert.strictEqual(updates.length, 0);
    });
  });
}

test("gradeSubmissionSchema", () => {
  assert.ok(gradeSubmissionSchema.validate({ grade: "8/10", feedback: "" }).error === undefined);
  assert.ok(gradeSubmissionSchema.validate({ feedback: "no grade" }).error);
  assert.ok(gradeSubmissionSchema.validate({ grade: "   " }).error);
  assert.ok(gradeSubmissionSchema.validate({ grade: "x".repeat(21) }).error);
});
