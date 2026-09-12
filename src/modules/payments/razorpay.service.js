const Razorpay = require("razorpay");
const crypto = require("crypto");

/**
 * Ensures Razorpay configuration and instance.
 * Reads credentials strictly from process.env.
 */
const getRazorpayInstance = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    const error = new Error("Razorpay credentials are not configured in environment variables");
    error.statusCode = 500;
    throw error;
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
};

/**
 * Creates an order on Razorpay API.
 */
const createRazorpayOrder = async ({ amount, currency = "INR", receipt, notes = {} }) => {
  const instance = getRazorpayInstance();
  return await instance.orders.create({
    amount,
    currency,
    receipt,
    notes,
  });
};

/**
 * Verifies Razorpay payment signature for checkout callback.
 */
const verifyPaymentSignature = ({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw new Error("RAZORPAY_KEY_SECRET is not configured");
  }

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return false;
  }

  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedSignature, "utf-8"),
      Buffer.from(razorpaySignature, "utf-8")
    );
  } catch (err) {
    return false;
  }
};

/**
 * Verifies Razorpay webhook signature.
 */
const verifyWebhookSignature = (rawBody, signature) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured");
  }
  if (!signature) {
    return false;
  }

  const payload = typeof rawBody === "string" ? rawBody : (Buffer.isBuffer(rawBody) ? rawBody.toString("utf-8") : JSON.stringify(rawBody));
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(payload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "utf-8"),
      Buffer.from(signature, "utf-8")
    );
  } catch (err) {
    return false;
  }
};

module.exports = {
  getRazorpayInstance,
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
