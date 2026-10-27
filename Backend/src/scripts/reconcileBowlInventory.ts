import { randomUUID } from "node:crypto";
import { config } from "../config/config";
import { prisma } from "../config/db";
import { targetBowlInventoryQuantity } from "../services/bowlInventoryPolicy";
import { shopifyAdminGraphql } from "../services/shopify/admin";
import { listBowlProducts } from "../services/shopify/bowls";
import { getMintedBowlBitmap, serialIsMintedInBitmap } from "../services/sui/mintState";

type InventoryChange = {
  serial: number;
  title: string;
  inventoryItemId: string;
  currentQuantity: number;
  targetQuantity: number;
  mintedOnChain: boolean;
};

async function resolveLocationId(): Promise<string> {
  if (config.shopify.locationId) return config.shopify.locationId;
  const data = await shopifyAdminGraphql(
    config.shopify.shop,
    `query { locations(first: 1) { nodes { id } } }`,
  );
  const id = data?.locations?.nodes?.[0]?.id;
  if (!id) throw new Error("No Shopify location found; set SHOPIFY_LOCATION_ID");
  return String(id);
}

async function applyInventoryChanges(changes: InventoryChange[], locationId: string) {
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
          locationId,
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
  const dbMinted = new Set(
    dbMints
      .filter(mint => mint.status === "MINTED" && mint.bowlSerial !== null && mint.suiObjectId)
      .map(mint => mint.bowlSerial as number),
  );

  const changes: InventoryChange[] = [];
  const untracked: number[] = [];
  const soldButNotMintedOnChain: number[] = [];
  const onChainMintedMissingDb: number[] = [];

  for (const bowl of bowls) {
    const mintedOnChain = serialIsMintedInBitmap(bitmap, bowl.serial);
    const targetQuantity = targetBowlInventoryQuantity(
      bowl.inventoryQuantity,
      mintedOnChain,
    );
    if (!bowl.inventoryTracked) untracked.push(bowl.serial);
    if (bowl.inventoryQuantity === 0 && !mintedOnChain) {
      soldButNotMintedOnChain.push(bowl.serial);
    }
    if (mintedOnChain && !dbMinted.has(bowl.serial)) {
      onChainMintedMissingDb.push(bowl.serial);
    }
    if (bowl.inventoryQuantity !== targetQuantity) {
      changes.push({
        serial: bowl.serial,
        title: bowl.name,
        inventoryItemId: bowl.inventoryItemGid,
        currentQuantity: bowl.inventoryQuantity,
        targetQuantity,
        mintedOnChain,
      });
    }
  }

  return {
    bowls,
    changes,
    untracked,
    soldButNotMintedOnChain,
    onChainMintedMissingDb,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const before = await buildReport();
  const publicChanges = before.changes.map(
    ({ inventoryItemId: _inventoryItemId, ...change }) => change,
  );
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        bowlCount: before.bowls.length,
        changes: publicChanges,
        untrackedSerials: before.untracked,
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

  const locationId = await resolveLocationId();
  await applyInventoryChanges(before.changes, locationId);

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
