import { randomUUID } from "node:crypto";
import { config } from "../config/config";
import { prisma } from "../config/db";
import { targetBowlInventoryQuantities } from "../services/bowlInventoryPolicy";
import { shopifyAdminGraphql } from "../services/shopify/admin";
import { listBowlProducts, type BowlProduct } from "../services/shopify/bowls";
import { getMintedBowlBitmap, serialIsMintedInBitmap } from "../services/sui/mintState";

type InventoryChange = {
  serial: number;
  title: string;
  inventoryItemId: string;
  locationId: string;
  locationName: string;
  currentQuantity: number;
  targetQuantity: number;
  mintedOnChain: boolean;
};

type InventoryLevelState = {
  locationGid: string;
  locationName: string;
  availableQuantity: number;
};

async function loadInventoryLevels(
  bowls: BowlProduct[],
): Promise<Map<string, InventoryLevelState[]>> {
  if (bowls.length === 0) return new Map();
  const data = await shopifyAdminGraphql(
    config.shopify.shop,
    `query bowlInventoryLevels($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on InventoryItem {
          id
          inventoryLevels(first: 50) {
            nodes {
              location { id name }
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }`,
    { ids: bowls.map(bowl => bowl.inventoryItemGid) },
  );
  const result = new Map<string, InventoryLevelState[]>();
  for (const node of data?.nodes ?? []) {
    if (!node?.id) continue;
    result.set(
      String(node.id),
      (node.inventoryLevels?.nodes ?? []).map((level: any) => ({
        locationGid: String(level.location.id),
        locationName: String(level.location.name),
        availableQuantity: Number(
          level.quantities?.find((quantity: any) => quantity.name === "available")?.quantity ?? 0,
        ),
      })),
    );
  }
  return result;
}

async function applyInventoryChanges(changes: InventoryChange[]) {
  if (changes.length === 0) return;
  const data = await shopifyAdminGraphql(
    config.shopify.shop,
    `mutation reconcileBowlInventory(
      $input: InventorySetQuantitiesInput!
      $idempotencyKey: String!
    ) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        userErrors { code field message }
      }
    }`,
    {
      idempotencyKey: randomUUID(),
      input: {
        name: "available",
        reason: "correction",
        quantities: changes.map(change => ({
          inventoryItemId: change.inventoryItemId,
          locationId: change.locationId,
          quantity: change.targetQuantity,
          // Compare-and-set prevents this administrative repair from
          // overwriting an order that changes stock during reconciliation.
          changeFromQuantity: change.currentQuantity,
        })),
      },
    },
  );
  const errors: Array<{ code?: string | null; field?: string[] | null; message: string }> =
    data?.inventorySetQuantities?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `Shopify inventory reconciliation failed: ${errors.map(error => error.message).join(", ")}`,
    );
  }
}

async function buildReport() {
  if (!config.shopify.shop) throw new Error("Missing SHOPIFY_SHOP");
  if (!config.shopify.adminAccessToken) throw new Error("Missing SHOPIFY_ADMIN_ACCESS_TOKEN");

  const [bowls, bitmap, dbMints] = await Promise.all([
    listBowlProducts({ bypassCache: true }),
    getMintedBowlBitmap({ bypassCache: true }),
    prisma.nftMint.findMany({
      select: { bowlSerial: true, status: true, suiObjectId: true },
    }),
  ]);
  const inventoryLevelsByItem = await loadInventoryLevels(bowls);
  const dbMinted = new Set(
    dbMints
      .filter(mint => mint.status === "MINTED" && mint.bowlSerial !== null && mint.suiObjectId)
      .map(mint => mint.bowlSerial as number),
  );

  const changes: InventoryChange[] = [];
  const untracked: number[] = [];
  const missingInventoryLevels: number[] = [];
  const soldButNotMintedOnChain: number[] = [];
  const onChainMintedMissingDb: number[] = [];

  for (const bowl of bowls) {
    const mintedOnChain = serialIsMintedInBitmap(bitmap, bowl.serial);
    const inventoryLevels = inventoryLevelsByItem.get(bowl.inventoryItemGid) ?? [];
    if (!bowl.inventoryTracked) untracked.push(bowl.serial);
    if (bowl.inventoryTracked && inventoryLevels.length === 0) {
      missingInventoryLevels.push(bowl.serial);
    }
    if (bowl.inventoryQuantity === 0 && !mintedOnChain) {
      soldButNotMintedOnChain.push(bowl.serial);
    }
    if (mintedOnChain && !dbMinted.has(bowl.serial)) {
      onChainMintedMissingDb.push(bowl.serial);
    }
    const preferredIndex = inventoryLevels.findIndex(
      level => level.locationGid === config.shopify.locationId,
    );
    const levelTargets = targetBowlInventoryQuantities(
      inventoryLevels.map(level => level.availableQuantity),
      mintedOnChain,
      preferredIndex,
    );
    for (const [index, level] of inventoryLevels.entries()) {
      const levelTarget = levelTargets[index];
      if (level.availableQuantity !== levelTarget) {
        changes.push({
          serial: bowl.serial,
          title: bowl.name,
          inventoryItemId: bowl.inventoryItemGid,
          locationId: level.locationGid,
          locationName: level.locationName,
          currentQuantity: level.availableQuantity,
          targetQuantity: levelTarget,
          mintedOnChain,
        });
      }
    }
  }

  return {
    bowls,
    changes,
    untracked,
    missingInventoryLevels,
    soldButNotMintedOnChain,
    onChainMintedMissingDb,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const before = await buildReport();
  const publicChanges = before.changes.map(
    ({ inventoryItemId: _inventoryItemId, locationId: _locationId, ...change }) => change,
  );
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        bowlCount: before.bowls.length,
        changes: publicChanges,
        untrackedSerials: before.untracked,
        missingInventoryLevelSerials: before.missingInventoryLevels,
        soldButNotMintedOnChain: before.soldButNotMintedOnChain,
        onChainMintedMissingDb: before.onChainMintedMissingDb,
      },
      null,
      2,
    ),
  );

  if (!apply) return;
  if (before.untracked.length > 0) {
    throw new Error(
      `Refusing to apply while bowl inventory is untracked: ${before.untracked.join(", ")}`,
    );
  }
  if (before.missingInventoryLevels.length > 0) {
    throw new Error(
      `Refusing to apply while bowl inventory levels are missing: ${before.missingInventoryLevels.join(", ")}`,
    );
  }

  await applyInventoryChanges(before.changes);

  const after = await buildReport();
  if (after.changes.length > 0) {
    throw new Error(
      `Inventory still differs after reconciliation for serials: ${after.changes.map(c => c.serial).join(", ")}`,
    );
  }
  console.log(JSON.stringify({ applied: before.changes.length, verified: true }));
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
