import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../config/db";
import type { AuthedRequest } from "../auth/middleware";
import { parseOrRespond } from "../utils/validation";

const idSchema = z.object({ id: z.string().uuid() });

const customerOrderSelect = {
  id: true,
  stripeSessionId: true,
  shopifyOrderId: true,
  status: true,
  paymentStatus: true,
  shopifyStatus: true,
  refundStatus: true,
  currency: true,
  subtotal: true,
  discountAmount: true,
  total: true,
  refundedAt: true,
  createdAt: true,
  updatedAt: true,
  items: true,
} as const;

export async function listOrders(req: AuthedRequest, res: Response) {
  const user = req.user;
  if (!user) return void res.status(401).json({ message: "Not authenticated" });
  const orders = await prisma.order.findMany({
    where: { hiddenAt: null, OR: [{ userId: user.id }, { userId: null, email: user.email }] },
    orderBy: { createdAt: "desc" },
    select: customerOrderSelect,
    take: 50,
  });
  res.status(200).json({ orders });
}

export async function hideOrderFromHistory(req: AuthedRequest, res: Response) {
  const params = parseOrRespond(idSchema, req.params, res);
  if (!params || !req.user) return;

  const result = await prisma.order.updateMany({
    where: {
      id: params.id,
      hiddenAt: null,
      OR: [{ userId: req.user.id }, { userId: null, email: req.user.email }],
    },
    data: { hiddenAt: new Date() },
  });
  if (result.count === 0) return void res.status(404).json({ message: "Purchase not found in your history" });
  res.status(200).json({ hidden: true });
}

export async function getOrderById(req: AuthedRequest, res: Response) {
  const params = parseOrRespond(idSchema, req.params, res);
  if (!params || !req.user) return;
  const order = await prisma.order.findFirst({
    where: {
      id: params.id,
      OR: [{ userId: req.user.id }, { userId: null, email: req.user.email }],
    },
    select: customerOrderSelect,
  });
  if (!order) return void res.status(404).json({ message: "Order not found" });
  res.status(200).json({ order });
}
