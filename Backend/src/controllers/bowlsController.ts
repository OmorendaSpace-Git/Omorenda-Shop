import type { Request, Response } from "express";
import { prisma } from "../config/db";
import { logger } from "../utils/logger";
import { isBowlPurchasable } from "../services/bowlInventoryPolicy";
import { getMintedBowlBitmap, serialIsMintedInBitmap } from "../services/sui/mintState";
import {
  getBowlBySerial as fetchBowlBySerial,
  listBowlProducts,
  MAX_SERIAL,
  MIN_SERIAL,
  type BowlProduct,
} from "../services/shopify/bowls";

function serializeBowl(
  b: BowlProduct,
  nftObjectId: string | null,
  mintedOnChain: boolean,
) {
  return {
    id: b.productGid,
    serialNumber: b.serial,
    name: b.name,
    imageUrl: b.imageUrl,
    audioUrl: b.audioUrl,
    description: b.description,
    weightGrams: b.weightGrams,
    heightMm: b.heightMm,
    widthMm: b.widthMm,
    note: b.note,
    frequency: b.frequency,
    price: b.price,
    currency: b.currency,
    status: isBowlPurchasable(b.available, mintedOnChain) ? "AVAILABLE" : "SOLD",
    nftObjectId,
  };
}

async function mintedObjectIdsBySerial(serials: number[]): Promise<Map<number, string>> {
  if (serials.length === 0) return new Map();
  const mints = await prisma.nftMint.findMany({
    where: { bowlSerial: { in: serials }, status: "MINTED", suiObjectId: { not: null } },
    select: { bowlSerial: true, suiObjectId: true },
  });
  const map = new Map<number, string>();
  for (const m of mints) {
    if (m.bowlSerial !== null && m.suiObjectId) map.set(m.bowlSerial, m.suiObjectId);
  }
  return map;
}

export async function listBowls(_req: Request, res: Response) {
  const bowls = await listBowlProducts();
  let bitmap: bigint;
  try {
    bitmap = await getMintedBowlBitmap();
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "[BOWLS] failed to verify Sui mint state",
    );
    res.status(503).json({
      code: "BOWL_AVAILABILITY_UNAVAILABLE",
      message: "Bowl availability is temporarily unavailable. Please try again.",
    });
    return;
  }
  const minted = await mintedObjectIdsBySerial(bowls.map(b => b.serial));
  res.status(200).json({
    bowls: bowls.map(b =>
      serializeBowl(
        b,
        minted.get(b.serial) ?? null,
        serialIsMintedInBitmap(bitmap, b.serial),
      ),
    ),
  });
}

export async function getBowlBySerial(req: Request, res: Response) {
  const serialRaw = req.params.serial;
  const serial = Number(serialRaw);
  if (!Number.isInteger(serial) || serial < MIN_SERIAL || serial > MAX_SERIAL) {
    res.status(400).json({ message: "Invalid serial" });
    return;
  }
  const bowl = await fetchBowlBySerial(serial);
  if (!bowl) {
    res.status(404).json({ message: "Bowl not found" });
    return;
  }
  let bitmap: bigint;
  try {
    bitmap = await getMintedBowlBitmap();
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), serial },
      "[BOWLS] failed to verify Sui mint state",
    );
    res.status(503).json({
      code: "BOWL_AVAILABILITY_UNAVAILABLE",
      message: "Bowl availability is temporarily unavailable. Please try again.",
    });
    return;
  }
  const minted = await mintedObjectIdsBySerial([serial]);
  res.status(200).json({
    bowl: serializeBowl(
      bowl,
      minted.get(serial) ?? null,
      serialIsMintedInBitmap(bitmap, serial),
    ),
  });
}
