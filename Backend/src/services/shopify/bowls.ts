import { config } from "../../config/config";
import { logger } from "../../utils/logger";
import { shopifyAdminGraphql } from "./admin";

/**
 * Singing bowls live in Shopify as one product per bowl (single variant,
 * inventory qty 1, tagged `singing-bowl`), with the NFT attributes stored as
 * product metafields under the `omorenda` namespace:
 *
 *   serial (integer), weight_grams, height_mm, width_mm, note, frequency,
 *   audio_url (optional URL used for the storefront preview)
 *
 * This module is the only place that knows that encoding.
 */

export const BOWL_METAFIELD_NAMESPACE = "omorenda";
export const MIN_SERIAL = 1;
export const MAX_SERIAL = 101;

export type BowlProduct = {
  productGid: string;
  variantGid: string;
  serial: number;
  name: string;
  imageUrl: string;
  audioUrl: string | null;
  description: string | null;
  weightGrams: number;
  heightMm: number;
  widthMm: number;
  note: string;
  frequency: string;
  price: string;
  currency: string;
  sku: string | null;
  inventoryItemGid: string;
  inventoryQuantity: number;
  inventoryTracked: boolean;
  available: boolean;
};

/** The subset of bowl attributes snapshotted onto NftMint.mintPayload. */
export type BowlMintPayload = {
  name: string;
  imageUrl: string;
  weightGrams: number;
  heightMm: number;
  widthMm: number;
  note: string;
  frequency: string;
};

export function toMintPayload(bowl: BowlProduct): BowlMintPayload {
  return {
    name: bowl.name,
    imageUrl: bowl.imageUrl,
    weightGrams: bowl.weightGrams,
    heightMm: bowl.heightMm,
    widthMm: bowl.widthMm,
    note: bowl.note,
    frequency: bowl.frequency,
  };
}

/** Validates a stored NftMint.mintPayload. Returns null if malformed. */
export function parseMintPayload(value: unknown): BowlMintPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const strings = ["name", "imageUrl", "note", "frequency"] as const;
  const ints = ["weightGrams", "heightMm", "widthMm"] as const;
  for (const key of strings) {
    if (typeof v[key] !== "string" || !(v[key] as string)) return null;
  }
  for (const key of ints) {
    if (typeof v[key] !== "number" || !Number.isInteger(v[key]) || (v[key] as number) <= 0) {
      return null;
    }
  }
  return {
    name: v.name as string,
    imageUrl: v.imageUrl as string,
    weightGrams: v.weightGrams as number,
    heightMm: v.heightMm as number,
    widthMm: v.widthMm as number,
    note: v.note as string,
    frequency: v.frequency as string,
  };
}

type ProductNode = {
  id: string;
  title: string;
  description: string | null;
  featuredImage: { url: string } | null;
  metafields: { edges: Array<{ node: { key: string; value: string } }> };
  variants: {
    edges: Array<{
      node: {
        id: string;
        sku: string | null;
        price: string;
        inventoryQuantity: number | null;
        inventoryItem: { id: string; tracked: boolean } | null;
      };
    }>;
  };
};

const LIST_CACHE_TTL_MS = 30_000;

let listCache: { bowls: BowlProduct[]; currency: string; expiresAt: number } | null = null;

export function invalidateBowlCache() {
  listCache = null;
}

async function fetchShopCurrency(): Promise<string> {
  const data = await shopifyAdminGraphql(
    config.shopify.shop,
    `query { shop { currencyCode } }`,
  );
  return typeof data?.shop?.currencyCode === "string" ? data.shop.currencyCode : "USD";
}

export async function listBowlProducts(opts?: { bypassCache?: boolean }): Promise<BowlProduct[]> {
  if (!config.shopify.shop) throw new Error("Missing SHOPIFY_SHOP");

  const now = Date.now();
  if (!opts?.bypassCache && listCache && listCache.expiresAt > now) {
    return listCache.bowls;
  }

  const query = `
    query bowlProducts($search: String!, $cursor: String) {
      products(first: 100, query: $search, after: $cursor) {
        edges {
          cursor
          node {
            id
            title
            description
            featuredImage { url }
            metafields(first: 20, namespace: "${BOWL_METAFIELD_NAMESPACE}") {
              edges { node { key value } }
            }
            variants(first: 1) {
              edges { node { id sku price inventoryQuantity inventoryItem { id tracked } } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const currency = await fetchShopCurrency();
  const bowls: BowlProduct[] = [];
  let cursor: string | null = null;

  do {
    const data = await shopifyAdminGraphql(config.shopify.shop, query, {
      search: `tag:'${config.shopify.bowlTag}'`,
      cursor,
    });
    const edges: Array<{ cursor: string; node: ProductNode }> = data?.products?.edges ?? [];
    for (const edge of edges) {
      const bowl = toBowlProduct(edge.node, currency);
      if (bowl) bowls.push(bowl);
    }
    cursor = data?.products?.pageInfo?.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  bowls.sort((a, b) => a.serial - b.serial);
  listCache = { bowls, currency, expiresAt: Date.now() + LIST_CACHE_TTL_MS };
  return bowls;
}

export async function getBowlBySerial(
  serial: number,
  opts?: { bypassCache?: boolean },
): Promise<BowlProduct | null> {
  const bowls = await listBowlProducts(opts);
  return bowls.find(b => b.serial === serial) ?? null;
}

function toBowlProduct(node: ProductNode, currency: string): BowlProduct | null {
  const variant = node.variants?.edges?.[0]?.node;
  if (!variant || !variant.inventoryItem?.id) {
    logger.warn({ productGid: node.id }, "[SHOPIFY][BOWLS] product has no variant; skipping");
    return null;
  }

  const fields = new Map<string, string>();
  for (const edge of node.metafields?.edges ?? []) {
    fields.set(edge.node.key, edge.node.value);
  }

  // Prefer the canonical image metafield (IPFS) — featuredImage is only a
  // fallback since Shopify processes uploaded media asynchronously.
  const imageUrl = fields.get("image_url") || node.featuredImage?.url || "";
  const audioUrl = fields.get("audio_url")?.trim() || null;
  const serial = parsePositiveInt(fields.get("serial"));
  const weightGrams = parsePositiveInt(fields.get("weight_grams"));
  const heightMm = parsePositiveInt(fields.get("height_mm"));
  const widthMm = parsePositiveInt(fields.get("width_mm"));
  const note = fields.get("note") ?? "";
  const frequency = fields.get("frequency") ?? "";

  if (
    serial === null ||
    serial < MIN_SERIAL ||
    serial > MAX_SERIAL ||
    weightGrams === null ||
    heightMm === null ||
    widthMm === null ||
    !note ||
    !frequency
  ) {
    logger.warn(
      { productGid: node.id, title: node.title },
      "[SHOPIFY][BOWLS] product missing/invalid omorenda.* metafields; skipping",
    );
    return null;
  }

  if (!imageUrl) {
    logger.warn({ productGid: node.id, serial }, "[SHOPIFY][BOWLS] product has no image; skipping");
    return null;
  }

  const inventoryQuantity = Number(variant.inventoryQuantity ?? 0);
  const inventoryTracked = variant.inventoryItem.tracked === true;

  return {
    productGid: node.id,
    variantGid: variant.id,
    serial,
    name: node.title,
    imageUrl,
    audioUrl,
    description: node.description || null,
    weightGrams,
    heightMm,
    widthMm,
    note,
    frequency,
    price: variant.price,
    currency,
    sku: variant.sku ?? null,
    inventoryItemGid: variant.inventoryItem.id,
    inventoryQuantity,
    inventoryTracked,
    available: inventoryTracked && inventoryQuantity > 0,
  };
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
