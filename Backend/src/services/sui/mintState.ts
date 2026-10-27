import { config } from "../../config/config";
import { getSuiClient } from "./client";

const DEFAULT_CACHE_TTL_MS = 15_000;

let cache: { bitmap: bigint; expiresAt: number } | null = null;

function cacheTtlMs(): number {
  const configured = Number(process.env.SUI_MINT_STATE_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_CACHE_TTL_MS;
}

export function serialIsMintedInBitmap(bitmap: bigint, serial: number): boolean {
  if (!Number.isInteger(serial) || serial < 1) {
    throw new Error(`Invalid bowl serial: ${serial}`);
  }
  return (bitmap & (1n << BigInt(serial - 1))) !== 0n;
}

export async function getMintedBowlBitmap(opts?: { bypassCache?: boolean }): Promise<bigint> {
  const now = Date.now();
  if (!opts?.bypassCache && cache && cache.expiresAt > now) {
    return cache.bitmap;
  }
  if (!config.sui.mintCapObjectId) {
    throw new Error("Missing SUI_MINT_CAP_OBJECT_ID");
  }

  const client = await getSuiClient();
  const cap = await client.getObject({
    objectId: config.sui.mintCapObjectId,
    include: { json: true },
  });
  const content = cap.object.json;
  if (!content || !("minted_bitmap" in content)) {
    throw new Error("Could not read the configured MintCap bitmap");
  }

  const bitmap = BigInt(String(content.minted_bitmap));
  cache = { bitmap, expiresAt: now + cacheTtlMs() };
  return bitmap;
}

export async function isBowlSerialMinted(
  serial: number,
  opts?: { bypassCache?: boolean },
): Promise<boolean> {
  const bitmap = await getMintedBowlBitmap(opts);
  return serialIsMintedInBitmap(bitmap, serial);
}

export function invalidateMintStateCache() {
  cache = null;
}

export class BowlAlreadyMintedOnChainError extends Error {
  constructor(serial: number) {
    super(`Bowl #${serial} is already minted on Sui`);
    this.name = "BowlAlreadyMintedOnChainError";
  }
}
