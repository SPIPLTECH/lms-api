const prisma = require("../../config/database");
const razorpayService = require("./razorpay.service");
const notificationService = require("../notifications/notification.service");

/**
 * Helper to retry transient database connection drops (e.g. Render DB P1017)
 */
const withRetry = async (fn, maxRetries = 2) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (
        attempt <= maxRetries &&
        (error.code === "P1017" ||
          error.code === "P1001" ||
          error.message?.includes("Server has closed the connection"))
      ) {
        await new Promise((res) => setTimeout(res, 300 * attempt));
        continue;
      }
      throw error;
    }
  }
};

/**
 * Creates a payment order for a paid course.
 */
const createOrder = async ({ userId, courseId }) => {
  // 1. Find course and authoritative store pricing
  const course = await withRetry(() =>
    prisma.course.findUnique({
      where: { id: courseId },
      include: { store: true },
    })
  );

  if (!course) {
    const error = new Error("Course not found");
    error.statusCode = 404;
    throw error;
  }

  // 2. Authoritative price check
  const store = course.store;
  let price = 0;
  if (store) {
    if (store.discountPrice !== null && store.discountPrice !== undefined && store.discountPrice > 0) {
      price = store.discountPrice;
    } else {
      price = store.price;
    }
  }

  if (price <= 0) {
    const error = new Error("Invalid course price");
    error.statusCode = 400;
    throw error;
  }

  // 3. Check existing Enrollment
  const student = await withRetry(() =>
    prisma.studentProfile.findUnique({
      where: { userId },
    })
  );

  if (student) {
    const existingEnrollment = await withRetry(() =>
      prisma.enrollment.findUnique({
        where: {
          studentId_courseId: {
            studentId: student.id,
            courseId,
          },
        },
      })
    );

    if (existingEnrollment) {
      const error = new Error("Already enrolled in this course");
      error.statusCode = 400;
      throw error;
    }
  }

  const amountInSubunits = Math.round(price * 100);
  const currency = store?.currency || "INR";

  // 4. Duplicate Order Protection: check for usable recent PENDING order
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const existingOrder = await withRetry(() =>
    prisma.paymentOrder.findFirst({
      where: {
        userId,
        courseId,
        status: "PENDING",
        amount: amountInSubunits,
        createdAt: { gte: thirtyMinutesAgo },
      },
      orderBy: { createdAt: "desc" },
    })
  );

  if (existingOrder) {
    return {
      orderId: existingOrder.razorpayOrderId,
      amount: existingOrder.amount,
      currency: existingOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    };
  }

  // 5. Create Razorpay Order
  const receipt = `rcpt_${Date.now()}_${userId.slice(-4)}`;
  const razorpayOrder = await razorpayService.createRazorpayOrder({
    amount: amountInSubunits,
    currency,
    receipt,
    notes: { userId, courseId },
  });

  // 6. Create PaymentOrder record
  await withRetry(() =>
    prisma.paymentOrder.create({
      data: {
        userId,
        courseId,
        razorpayOrderId: razorpayOrder.id,
        amount: amountInSubunits,
        currency,
        status: "PENDING",
      },
    })
  );

  return {
    orderId: razorpayOrder.id,
    amount: amountInSubunits,
    currency,
    keyId: process.env.RAZORPAY_KEY_ID,
  };
};

/**
 * Verifies payment signature and activates course enrollment.
 */
const verifyPayment = async ({ userId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  // 1. Find PaymentOrder
  const paymentOrder = await withRetry(() =>
    prisma.paymentOrder.findUnique({
      where: { razorpayOrderId },
    })
  );

  if (!paymentOrder) {
    const error = new Error("Payment order not found");
    error.statusCode = 404;
    throw error;
  }

  // 2. Ownership check
  if (paymentOrder.userId !== userId) {
    const error = new Error("Payment order belongs to another user");
    error.statusCode = 403;
    throw error;
  }

  // 3. Idempotency check: if already captured, return final state
  if (paymentOrder.status === "CAPTURED") {
    let student = await withRetry(() => prisma.studentProfile.findUnique({ where: { userId } }));
    if (student) {
      const enrollment = await withRetry(() =>
        prisma.enrollment.findUnique({
          where: {
            studentId_courseId: {
              studentId: student.id,
              courseId: paymentOrder.courseId,
            },
          },
        })
      );
      if (!enrollment) {
        await activateEnrollment(userId, paymentOrder.courseId);
      }
    } else {
      await activateEnrollment(userId, paymentOrder.courseId);
    }

    return {
      paymentStatus: "CAPTURED",
      enrollmentStatus: "ACTIVE",
    };
  }

  // 4. Verify signature
  const isValidSignature = razorpayService.verifyPaymentSignature({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!isValidSignature) {
    if (paymentOrder.status === "PENDING") {
      await withRetry(() =>
        prisma.paymentOrder.update({
          where: { id: paymentOrder.id },
          data: { status: "FAILED" },
        })
      );
    }

    const error = new Error("Invalid Razorpay signature");
    error.statusCode = 400;
    throw error;
  }

  // 5. Mark PaymentOrder as CAPTURED
  await withRetry(() =>
    prisma.paymentOrder.update({
      where: { id: paymentOrder.id },
      data: {
        status: "CAPTURED",
        razorpayPaymentId,
        razorpaySignature,
      },
    })
  );

  // 6. Create / activate Enrollment
  await activateEnrollment(userId, paymentOrder.courseId);

  return {
    paymentStatus: "CAPTURED",
    enrollmentStatus: "ACTIVE",
  };
};

/**
 * Helper to idempotently create student profile (if missing) and activate course enrollment.
 */
const activateEnrollment = async (userId, courseId) => {
  let student = await withRetry(() =>
    prisma.studentProfile.findUnique({
      where: { userId },
    })
  );

  if (!student) {
    student = await withRetry(() =>
      prisma.studentProfile.create({
        data: { userId },
      })
    );
  }

  const existing = await withRetry(() =>
    prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: student.id,
          courseId,
        },
      },
    })
  );

  if (existing) {
    return existing;
  }

  const enrollment = await withRetry(() =>
    prisma.enrollment.create({
      data: {
        studentId: student.id,
        courseId,
      },
      include: {
        student: {
          include: {
            user: { select: { name: true } },
          },
        },
        course: {
          select: { title: true, creatorId: true },
        },
      },
    })
  );

  try {
    if (notificationService && notificationService.createNotification) {
      await notificationService.createNotification(enrollment.course.creatorId, {
        title: "New Student Enrolled 🎓",
        message: `${enrollment.student?.user?.name || "A student"} enrolled in your course "${enrollment.course?.title || ""}".`,
        type: "ENROLLMENT",
        link: `/courses/${courseId}/students`,
      });
    }
  } catch (err) {
    console.error("Error creating enrollment notification:", err.message);
  }

  return enrollment;
};

/**
 * Processes incoming Razorpay webhooks.
 */
const processWebhook = async (rawBody, signature) => {
  const isValid = razorpayService.verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    const error = new Error("Invalid webhook signature");
    error.statusCode = 400;
    throw error;
  }

  const payload = typeof rawBody === "string" ? JSON.parse(rawBody) : (Buffer.isBuffer(rawBody) ? JSON.parse(rawBody.toString("utf-8")) : rawBody);
  const event = payload.event;
  const eventData = payload.payload;

  if (event === "payment.captured" || event === "order.paid") {
    const paymentEntity = eventData?.payment?.entity;
    const orderEntity = eventData?.order?.entity;

    const razorpayOrderId = paymentEntity?.order_id || orderEntity?.id;
    const razorpayPaymentId = paymentEntity?.id;

    if (razorpayOrderId) {
      const paymentOrder = await withRetry(() =>
        prisma.paymentOrder.findUnique({
          where: { razorpayOrderId },
        })
      );

      if (paymentOrder) {
        if (paymentOrder.status !== "CAPTURED") {
          await withRetry(() =>
            prisma.paymentOrder.update({
              where: { id: paymentOrder.id },
              data: {
                status: "CAPTURED",
                razorpayPaymentId: razorpayPaymentId || paymentOrder.razorpayPaymentId,
              },
            })
          );
        }

        await activateEnrollment(paymentOrder.userId, paymentOrder.courseId);
      }
    }
  } else if (event === "payment.failed") {
    const paymentEntity = eventData?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id;

    if (razorpayOrderId) {
      const paymentOrder = await withRetry(() =>
        prisma.paymentOrder.findUnique({
          where: { razorpayOrderId },
        })
      );

      if (paymentOrder && paymentOrder.status === "PENDING") {
        await withRetry(() =>
          prisma.paymentOrder.update({
            where: { id: paymentOrder.id },
            data: { status: "FAILED" },
          })
        );
      }
    }
  }

  return { processed: true };
};

module.exports = {
  createOrder,
  verifyPayment,
  processWebhook,
  activateEnrollment,
};
