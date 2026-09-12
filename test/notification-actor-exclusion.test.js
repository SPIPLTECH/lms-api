const test = require("node:test");
const assert = require("node:assert");

const notificationService = require("../src/modules/notifications/notification.service");
const prisma = require("../src/config/database");

test("createNotification suppresses self-notification when actorId equals userId", async () => {
  const actorId = "user_instructor_123";
  const userId = "user_instructor_123";

  const result = await notificationService.createNotification(userId, {
    title: "Lesson Published 📚",
    message: "You published a lesson",
    type: "LESSON_PUBLISHED",
    actorId
  });

  assert.strictEqual(result, null, "Notification should be null when actorId === userId");
});

test("createNotification allows notification when actorId is different from userId", async () => {
  const originals = {
    findFirst: prisma.notification.findFirst,
    create: prisma.notification.create
  };

  let createdData = null;
  prisma.notification.findFirst = async () => null;
  prisma.notification.create = async ({ data }) => {
    createdData = data;
    return { id: "notif_1", ...data };
  };

  try {
    const actorId = "user_instructor_123";
    const userId = "user_student_456";

    const result = await notificationService.createNotification(userId, {
      title: "New Quiz Available 📝",
      message: "Check out the new quiz",
      type: "QUIZ_PUBLISHED",
      actorId
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(createdData.userId, "user_student_456");
  } finally {
    prisma.notification.findFirst = originals.findFirst;
    prisma.notification.create = originals.create;
  }
});

test("notifyEnrolledStudents excludes actorId from recipient list", async () => {
  const originals = {
    findMany: prisma.enrollment.findMany,
    create: prisma.notification.create,
    findFirst: prisma.notification.findFirst
  };

  const deliveredUserIds = [];
  prisma.enrollment.findMany = async () => [
    { student: { userId: "user_instructor_123" } }, // Enrolled instructor
    { student: { userId: "user_student_1" } },
    { student: { userId: "user_student_2" } }
  ];

  prisma.notification.findFirst = async () => null;
  prisma.notification.create = async ({ data }) => {
    deliveredUserIds.push(data.userId);
    return { id: `notif_${data.userId}`, ...data };
  };

  try {
    await notificationService.notifyEnrolledStudents(
      "course_1",
      {
        title: "Announcement",
        message: "Hello class!",
        actorId: "user_instructor_123"
      },
      null,
      null,
      "user_instructor_123"
    );

    assert.deepStrictEqual(
      deliveredUserIds,
      ["user_student_1", "user_student_2"],
      "Instructor (actorId) should be excluded from receiving the notification"
    );
  } finally {
    prisma.enrollment.findMany = originals.findMany;
    prisma.notification.create = originals.create;
    prisma.notification.findFirst = originals.findFirst;
  }
});
