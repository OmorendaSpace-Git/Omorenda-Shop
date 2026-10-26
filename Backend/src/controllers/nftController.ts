import type { Response } from "express";
import { prisma } from "../config/db";
import { parseMintPayload } from "../services/shopify/bowls";
import type { AuthedRequest } from "../auth/middleware";

export async function listMyNfts(req: AuthedRequest, res: Response) {
  const userId = req.user?.id ?? null;
  if (!userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }

  const mints = await prisma.nftMint.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      order: { select: { id: true, createdAt: true, total: true, currency: true } },
    },
  });

  res.status(200).json({
    nfts: mints.map(m => {
      const payload = parseMintPayload(m.mintPayload);
      return {
      id: m.id,
      orderId: m.orderId,
      productKind: m.productKind,
      status: m.status,
      suiObjectId: m.suiObjectId,
      mintTxDigest: m.mintTxDigest,
      recipientSuiAddress: m.recipientSuiAddress,
      createdAt: m.createdAt,
      bowl: m.bowlSerial !== null && payload
        ? {
            serialNumber: m.bowlSerial,
            name: payload.name,
            imageUrl: payload.imageUrl,
            weightGrams: payload.weightGrams,
            heightMm: payload.heightMm,
            widthMm: payload.widthMm,
            note: payload.note,
            frequency: payload.frequency,
          }
        : null,
      order: m.order
        ? {
            id: m.order.id,
            createdAt: m.order.createdAt,
            total: m.order.total.toString(),
            currency: m.order.currency,
          }
        : null,
      };
    }),
  });
}
