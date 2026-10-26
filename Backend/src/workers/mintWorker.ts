/**
 * Long-running worker process that drains the NftMint queue and mints
 * Singing Bowl NFTs on Sui.
 *
 * Run with:  npm run worker
 */
import { prisma } from "../config/db";
import { config } from "../config/config";
import { logger } from "../utils/logger";
import { runBowlMint } from "./mintRunner";
import { BowlAlreadyMintedError } from "../services/sui/mint";

const POLL_MS = config.mintWorker.pollIntervalMs;
const MAX_ATTEMPTS = config.mintWorker.maxAttempts;

let shuttingDown = false;

async function claimNextMint(): Promise<{ id: string } | null> {
  // Atomic claim via compare-and-set on status. Picks the oldest eligible
  // PENDING row whose scheduledAt has passed (or is null), flips it to
  // MINTING, and increments attempts.
  const now = new Date();
  const candidate = await prisma.nftMint.findFirst({
    where: {
      status: "PENDING",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
  });
  if (!candidate) return null;

  const claimed = await prisma.nftMint.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: {
      status: "MINTING",
      attempts: { increment: 1 },
      scheduledAt: null,
    },
  });
  if (claimed.count === 0) return null; // another worker beat us
  return { id: candidate.id };
}

function backoffMs(attempts: number): number {
  // 2s, 4s, 8s, 16s, 32s ...
  return Math.min(60_000 * 5, 1000 * Math.pow(2, attempts));
}

async function processMint(mintId: string) {
  const mint = await prisma.nftMint.findUnique({ where: { id: mintId } });
  if (!mint) {
    logger.error({ mintId }, "[WORKER] mint vanished after claim");
    return;
  }
  if (mint.bowlSerial === null || !mint.mintPayload) {
    // Snapshot data won't appear on retry — fail permanently.
    await markFailed(mint.id, mint.attempts, "Mint has no bowlSerial/mintPayload snapshot");
    return;
  }

  try {
    const result = await runBowlMint({ mint });
    await prisma.nftMint.update({
      where: { id: mint.id },
      data: {
        status: "MINTED",
        suiObjectId: result.suiObjectId,
        mintTxDigest: result.mintTxDigest,
        sponsoredByAddress: result.sponsorAddress,
        lastError: null,
      },
    });
    logger.info(
      {
        mintId: mint.id,
        suiObjectId: result.suiObjectId,
        mintTxDigest: result.mintTxDigest,
        bowlSerial: mint.bowlSerial,
      },
      "[WORKER] mint succeeded",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof BowlAlreadyMintedError || mint.attempts >= MAX_ATTEMPTS) {
      await markFailed(mint.id, mint.attempts, message);
      logger.error(
        { mintId: mint.id, attempts: mint.attempts, err: message },
        "[WORKER] mint failed permanently",
      );
    } else {
      const next = new Date(Date.now() + backoffMs(mint.attempts));
      await prisma.nftMint.update({
        where: { id: mint.id },
        data: {
          status: "PENDING",
          lastError: message.slice(0, 1000),
          scheduledAt: next,
        },
      });
      logger.warn(
        { mintId: mint.id, attempts: mint.attempts, nextAt: next, err: message },
        "[WORKER] mint failed; scheduled retry",
      );
    }
  }
}

async function markFailed(id: string, attempts: number, msg: string) {
  await prisma.nftMint.update({
    where: { id },
    data: {
      status: "FAILED",
      lastError: msg.slice(0, 1000),
      attempts,
    },
  });
}

async function mintLoop() {
  while (!shuttingDown) {
    try {
      const job = await claimNextMint();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      await processMint(job.id);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[WORKER] unexpected error in mint loop",
      );
      await sleep(POLL_MS);
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("[WORKER] shutting down");
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

logger.info(
  {
    pollMs: POLL_MS,
    maxAttempts: MAX_ATTEMPTS,
    network: config.sui.network,
  },
  "[WORKER] starting mint worker",
);

void mintLoop();
