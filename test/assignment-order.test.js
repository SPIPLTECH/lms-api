const test = require("node:test");
const assert = require("node:assert");

const { getNextAssignmentOrder, ASSIGNMENT_ORDER_BASE } = require("../src/modules/contents/contentOrder.util");
const assignmentService = require("../src/modules/assignments/assignment.service");
const prisma = require("../src/config/database");

test("createAssignment — order is always server-computed inside the Assignment zone", async (t) => {
  const originalAssignmentFindFirst = prisma.assignment.findFirst;
  const originalAssignmentCreate = prisma.assignment.create;

  t.after(() => {
    prisma.assignment.findFirst = originalAssignmentFindFirst;
    prisma.assignment.create = originalAssignmentCreate;
  });

  await t.test("first assignment in an empty scope", async () => {
    prisma.assignment.findFirst = async () => null;
    let capturedData;
    prisma.assignment.create = async ({ data }) => {
      capturedData = data;
      return { id: "new-assignment-id", ...data };
    };

    await assignmentService.createAssignment({
      title: "Essay",
      dueDate: "2026-10-01T00:00:00.000Z",
      courseId: "c1",
    });

    assert.strictEqual(capturedData.order, ASSIGNMENT_ORDER_BASE + 1);
  });

  await t.test("appends after existing assignments in the same scope", async () => {
    prisma.assignment.findFirst = async ({ where }) => {
      assert.deepStrictEqual(where, { moduleId: "m1", order: { not: null } });
      return { order: ASSIGNMENT_ORDER_BASE + 3 };
    };
    let capturedData;
    prisma.assignment.create = async ({ data }) => {
      capturedData = data;
      return { id: "new-assignment-id", ...data };
    };

    await assignmentService.createAssignment({
      title: "Lab Report",
      dueDate: "2026-10-01T00:00:00.000Z",
      moduleId: "m1",
    });

    assert.strictEqual(capturedData.order, ASSIGNMENT_ORDER_BASE + 4);
  });
});

test("reorderAssignments — two-phase batch update avoids swap collisions", async (t) => {
  const originalAssignmentUpdate = prisma.assignment.update;
  const originalTransaction = prisma.$transaction;

  t.after(() => {
    prisma.assignment.update = originalAssignmentUpdate;
    prisma.$transaction = originalTransaction;
  });

  await t.test("issues 4 updates (2 offset placeholders, 2 final) inside one transaction", async () => {
    const calls = [];
    prisma.assignment.update = async ({ where, data }) => {
      calls.push({ where, data });
      return { id: where.id, ...data };
    };

    let capturedTransactionArg;
    prisma.$transaction = async (arg) => {
      capturedTransactionArg = arg;
      return Promise.all(arg);
    };

    await assignmentService.reorderAssignments([
      { id: "a", order: ASSIGNMENT_ORDER_BASE + 5 },
      { id: "b", order: ASSIGNMENT_ORDER_BASE + 3 },
    ]);

    assert.ok(Array.isArray(capturedTransactionArg));
    assert.strictEqual(calls.length, 4);
    assert.ok(calls[0].data.order < 0);
    assert.ok(calls[1].data.order < 0);
    assert.notStrictEqual(calls[0].data.order, calls[1].data.order);
    assert.deepStrictEqual(calls[2], { where: { id: "a" }, data: { order: ASSIGNMENT_ORDER_BASE + 5 } });
    assert.deepStrictEqual(calls[3], { where: { id: "b" }, data: { order: ASSIGNMENT_ORDER_BASE + 3 } });
  });
});
