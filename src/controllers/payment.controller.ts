import { Request, Response }
from "express";

import { createOrder }
from "../services/payment.service";

export const create =
async (
  req: Request,
  res: Response
) => {

  const { amount }
  = req.body;

  const order =
    await createOrder(
      amount
    );

  res.json({
    success: true,
    order,
  });
};