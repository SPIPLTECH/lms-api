import { razorpay }
from "../config/razorpay";

export const createOrder =
async (
  amount: number
) => {

  return razorpay.orders.create({
    amount:
      amount * 100,

    currency:
      "INR",
  });
};
