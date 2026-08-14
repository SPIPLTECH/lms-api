const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const crypto = require("crypto");

const app = require("../src/app");
const prisma = require("../src/config/database");
const { mintAccessToken } = require("./helpers/authToken");
const razorpayService = require("../src/modules/payments/razorpay.service");

test("Razorpay Payment Integration — Backend Phase 1", async (t) => {
  let studentUser;
  let otherStudentUser;
  let studentToken;
  let otherStudentToken;
  let course;
  let freeCourse;
  let instructor;

  // Setup database fixtures
  t.before(async () => {
    const timestamp = Date.now();

    // Create Instructor
    instructor = await prisma.user.create({
      data: {
        name: `Test Instructor ${timestamp}`,
        email: `instructor_${timestamp}@test.com`,
        password: "hashedpassword123",
        role: "INSTRUCTOR",
      },
    });

    // Create Paid Course with Store price = 4999 (₹4999).
    // Kept as DRAFT (not PUBLISHED): payment-order creation never checks
    // course status, and DRAFT keeps this fixture invisible to the student
    // catalog/recommendations if a crashed/interrupted run skips the
    // t.after() cleanup below.
    course = await prisma.course.create({
      data: {
        title: `Paid Course ${timestamp}`,
        description: "Paid course for testing",
        creatorId: instructor.id,
        status: "DRAFT",
        store: {
          create: {
            price: 4999,
            discountPrice: 4499, // ₹4499 discounted price
            currency: "INR",
            isFree: false,
          },
        },
      },
      include: { store: true },
    });

    // Create Course with price 0 (invalid price). Kept as DRAFT — see note above.
    freeCourse = await prisma.course.create({
      data: {
        title: `Zero Price Course ${timestamp}`,
        description: "Course with zero price",
        creatorId: instructor.id,
        status: "DRAFT",
        store: {
          create: {
            price: 0,
            currency: "INR",
            isFree: true,
          },
        },
      },
    });

    // Create Student 1
    studentUser = await prisma.user.create({
      data: {
        name: `Test Student 1 ${timestamp}`,
        email: `student1_${timestamp}@test.com`,
        password: "hashedpassword123",
        role: "STUDENT",
        studentProfile: {
          create: {},
        },
      },
    });
    studentToken = mintAccessToken(studentUser);

    // Create Student 2
    otherStudentUser = await prisma.user.create({
      data: {
        name: `Test Student 2 ${timestamp}`,
        email: `student2_${timestamp}@test.com`,
        password: "hashedpassword123",
        role: "STUDENT",
        studentProfile: {
          create: {},
        },
      },
    });
    otherStudentToken = mintAccessToken(otherStudentUser);
  });

  // Mock Razorpay API call to prevent live external network calls
  t.mock.method(razorpayService, "createRazorpayOrder", async ({ amount, currency, receipt }) => {
    return {
      id: `order_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      entity: "order",
      amount,
      currency,
      receipt,
      status: "created",
    };
  });

  // Cleanup after tests. Each fixture is torn down independently (rather than
  // one straight-line await chain) so a failure deleting one fixture can't
  // leave the rest — including the courses — stranded in the database.
  t.after(async () => {
    if (course) {
      await prisma.paymentOrder.deleteMany({ where: { courseId: course.id } }).catch(() => {});
      await prisma.enrollment.deleteMany({ where: { courseId: course.id } }).catch(() => {});
      await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
    }
    if (freeCourse) {
      await prisma.course.delete({ where: { id: freeCourse.id } }).catch(() => {});
    }
    if (studentUser) {
      await prisma.user.delete({ where: { id: studentUser.id } }).catch(() => {});
    }
    if (otherStudentUser) {
      await prisma.user.delete({ where: { id: otherStudentUser.id } }).catch(() => {});
    }
    if (instructor) {
      await prisma.user.delete({ where: { id: instructor.id } }).catch(() => {});
    }
  });

  await t.test("1. Unauthenticated POST /payments/orders should be rejected", async () => {
    const res = await request(app)
      .post("/payments/orders")
      .send({ courseId: course.id });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  await t.test("2. Invalid courseId should return 404", async () => {
    const res = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ courseId: "non_existent_course_id_123" });

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Course not found");
  });

  await t.test("3. Course with invalid/zero price should return 400", async () => {
    const res = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ courseId: freeCourse.id });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Invalid course price");
  });

  await t.test("4. Authenticated user with valid paid course -> order created with server-determined price", async () => {
    const res = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({
        courseId: course.id,
        // Attempt fake price manipulation from frontend
        amount: 1,
        price: 1,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.orderId);
    // Effective price is discountPrice = 4499 -> subunits 449900
    assert.equal(res.body.data.amount, 449900);
    assert.equal(res.body.data.currency, "INR");
    assert.equal(res.body.data.keyId, process.env.RAZORPAY_KEY_ID);
    assert.equal(res.body.data.keySecret, undefined);
  });

  await t.test("5. Duplicate order request reuse (Duplicate Order Protection)", async () => {
    const res1 = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ courseId: course.id });

    const res2 = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ courseId: course.id });

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    // Should reuse the existing pending order ID
    assert.equal(res1.body.data.orderId, res2.body.data.orderId);
  });

  await t.test("6. Payment verification with invalid signature should fail and mark PENDING order FAILED", async () => {
    // Create an order first for otherStudentUser
    const orderRes = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${otherStudentToken}`)
      .send({ courseId: course.id });

    const razorpayOrderId = orderRes.body.data.orderId;

    const verifyRes = await request(app)
      .post("/payments/verify")
      .set("Authorization", `Bearer ${otherStudentToken}`)
      .send({
        razorpayOrderId,
        razorpayPaymentId: "pay_invalid_123",
        razorpaySignature: "invalid_signature_hash",
      });

    assert.equal(verifyRes.status, 400);
    assert.equal(verifyRes.body.success, false);
    assert.equal(verifyRes.body.message, "Invalid Razorpay signature");

    // Check DB status updated to FAILED
    const dbOrder = await prisma.paymentOrder.findUnique({
      where: { razorpayOrderId },
    });
    assert.equal(dbOrder.status, "FAILED");
  });

  await t.test("7. Payment verification for another user's order should be rejected with 403", async () => {
    // Order belongs to otherStudentUser
    const orderRes = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${otherStudentToken}`)
      .send({ courseId: course.id });

    const razorpayOrderId = orderRes.body.data.orderId;

    const verifyRes = await request(app)
      .post("/payments/verify")
      .set("Authorization", `Bearer ${studentToken}`) // Different user
      .send({
        razorpayOrderId,
        razorpayPaymentId: "pay_test_123",
        razorpaySignature: "some_signature",
      });

    assert.equal(verifyRes.status, 403);
    assert.equal(verifyRes.body.success, false);
    assert.equal(verifyRes.body.message, "Payment order belongs to another user");
  });

  await t.test("8. Successful payment verification -> PaymentOrder CAPTURED & Enrollment ACTIVE", async () => {
    const orderRes = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ courseId: course.id });

    const razorpayOrderId = orderRes.body.data.orderId;
    const razorpayPaymentId = `pay_valid_${Date.now()}`;

    // Compute valid signature
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const validSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    const verifyRes = await request(app)
      .post("/payments/verify")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: validSignature,
      });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.success, true);
    assert.equal(verifyRes.body.data.paymentStatus, "CAPTURED");
    assert.equal(verifyRes.body.data.enrollmentStatus, "ACTIVE");

    // Verify DB state
    const dbOrder = await prisma.paymentOrder.findUnique({
      where: { razorpayOrderId },
    });
    assert.equal(dbOrder.status, "CAPTURED");
    assert.equal(dbOrder.razorpayPaymentId, razorpayPaymentId);

    const studentProfile = await prisma.studentProfile.findUnique({
      where: { userId: studentUser.id },
    });
    const dbEnrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: studentProfile.id,
          courseId: course.id,
        },
      },
    });
    assert.ok(dbEnrollment);
  });

  await t.test("9. Duplicate payment verification should be idempotent", async () => {
    const existingOrder = await prisma.paymentOrder.findFirst({
      where: { userId: studentUser.id, courseId: course.id, status: "CAPTURED" },
    });

    const verifyRes = await request(app)
      .post("/payments/verify")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({
        razorpayOrderId: existingOrder.razorpayOrderId,
        razorpayPaymentId: existingOrder.razorpayPaymentId,
        razorpaySignature: existingOrder.razorpaySignature,
      });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.success, true);
    assert.equal(verifyRes.body.data.paymentStatus, "CAPTURED");
    assert.equal(verifyRes.body.data.enrollmentStatus, "ACTIVE");
  });

  await t.test("10. Already enrolled student trying to create new payment order should return 400", async () => {
    const res = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ courseId: course.id });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Already enrolled in this course");
  });

  await t.test("11. Webhook with invalid signature should return 400", async () => {
    const res = await request(app)
      .post("/payments/webhook")
      .set("x-razorpay-signature", "bad_signature")
      .send({ event: "payment.captured" });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Invalid webhook signature");
  });

  await t.test("12. Webhook with valid signature -> processes event idempotently", async () => {
    // Create new order for otherStudentUser
    const orderRes = await request(app)
      .post("/payments/orders")
      .set("Authorization", `Bearer ${otherStudentToken}`)
      .send({ courseId: course.id });

    const razorpayOrderId = orderRes.body.data.orderId;
    const razorpayPaymentId = `pay_wh_${Date.now()}`;

    const webhookPayload = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: razorpayPaymentId,
            order_id: razorpayOrderId,
          },
        },
      },
    });

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const webhookSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(webhookPayload)
      .digest("hex");

    const res = await request(app)
      .post("/payments/webhook")
      .set("x-razorpay-signature", webhookSignature)
      .set("Content-Type", "application/json")
      .send(webhookPayload);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    // Verify DB state updated
    const dbOrder = await prisma.paymentOrder.findUnique({
      where: { razorpayOrderId },
    });
    assert.equal(dbOrder.status, "CAPTURED");

    const studentProfile = await prisma.studentProfile.findUnique({
      where: { userId: otherStudentUser.id },
    });
    const dbEnrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: studentProfile.id,
          courseId: course.id,
        },
      },
    });
    assert.ok(dbEnrollment);
  });
});
