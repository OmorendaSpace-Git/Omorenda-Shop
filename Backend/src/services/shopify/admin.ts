import { createHash } from "node:crypto";
import { config } from "../../config/config";
import { logger } from "../../utils/logger";
import { formatCurrencyAmount } from "../../utils/currency";

export type ShopifyOrderLineItem = {
  variantGid: string;
  quantity: number;
  unitPrice: string;
};

export type ShopifyShippingAddress = {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
};

const SHOPIFY_RETRY_ATTEMPTS = 3;
const SHOPIFY_RETRY_BASE_DELAY_MS = 250;
const SHOPIFY_REQUEST_TIMEOUT_MS = 10_000;

type ShopifyVariantNode = {
  id: string;
  title?: string | null;
  sku?: string | null;
  price?: string | number | null;
  product?: { title?: string | null } | null;
};

type VariantPricingResponse = {
  nodes?: Array<ShopifyVariantNode | null>;
};

class ShopifyNonRetryableError extends Error {}

/** orderCreate rejected because an item's inventory is exhausted (lost the
 *  race on a one-of-one product under DECREMENT_OBEYING_POLICY). */
export class ShopifyOutOfStockError extends Error {}

export type ShopifyInventoryBehaviour =
  | "BYPASS"
  | "DECREMENT_IGNORING_POLICY"
  | "DECREMENT_OBEYING_POLICY";

export async function createShopifyOrder(args: {
  shop: string;
  email?: string | null;
  lineItems: ShopifyOrderLineItem[];
  shippingAddress?: ShopifyShippingAddress | null;
  currency: string;
  inventoryBehaviour?: ShopifyInventoryBehaviour;
  sourceIdentifier?: string | null;
}) {
  const recoveryTag = args.sourceIdentifier
    // Shopify order tags allow at most 40 characters. Hash the full session
    // rather than truncating it so different checkouts retain distinct tags.
    ? `stripe-${createHash("sha256").update(args.sourceIdentifier).digest("hex").slice(0, 32)}`
    : null;
  const recoveryTags = recoveryTag
    ? [recoveryTag, `stripe-session-${args.sourceIdentifier}`]
    : [];
  if (recoveryTag) {
    const existingOrderId = await findShopifyOrderByTags(args.shop, recoveryTags);
    if (existingOrderId) {
      logger.info(
        { shopifyOrderId: existingOrderId, sourceIdentifier: args.sourceIdentifier },
        "[SHOPIFY] recovered existing order by Stripe session",
      );
      return existingOrderId;
    }
  }

  const lineItems = args.lineItems
    .map(item => {
      if (!item.variantGid) {
        return null;
      }

      return {
        variantId: item.variantGid,
        quantity: item.quantity,
        priceSet: {
          shopMoney: {
            amount: formatCurrencyAmount(Number(item.unitPrice), args.currency),
            currencyCode: args.currency.toUpperCase(),
          },
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (lineItems.length === 0) {
    throw new Error("No valid Shopify line items for order creation");
  }

  const totalAmount = lineItems.reduce(
    (sum, item) => sum + Number(item.priceSet.shopMoney.amount) * item.quantity,
    0,
  );

  const mutation = `
    mutation orderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        userErrors { field message }
        order { id }
      }
    }
  `;

  const variables: Record<string, unknown> = {
    options: {
      inventoryBehaviour: args.inventoryBehaviour ?? "BYPASS",
    },
    order: {
      currency: args.currency.toUpperCase(),
      email: args.email ?? undefined,
      shippingAddress: toMailingAddress(args.shippingAddress),
      lineItems,
      transactions: [
        {
          kind: "SALE",
          status: "SUCCESS",
          amountSet: {
            shopMoney: {
              amount: formatCurrencyAmount(totalAmount, args.currency),
              currencyCode: args.currency.toUpperCase(),
            },
          },
        },
      ],
      tags: recoveryTag ? ["stripe", recoveryTag] : ["stripe"],
      sourceIdentifier: args.sourceIdentifier ?? undefined,
    },
  };

  try {
    const response = await shopifyAdminGraphql(args.shop, mutation, variables);
    const userErrors: Array<{ field?: string[] | null; message: string }> =
      response?.orderCreate?.userErrors ?? [];
    if (userErrors.length > 0) {
      const joined = userErrors.map(err => err.message).join(", ");
      if (/inventory|stock|available|quantity/i.test(joined)) {
        throw new ShopifyOutOfStockError(`Shopify orderCreate out of stock: ${joined}`);
      }
      throw new Error(`Shopify orderCreate error: ${joined}`);
    }

    const orderId = response?.orderCreate?.order?.id;
    if (!orderId) {
      throw new Error("Shopify order creation failed");
    }

    return String(orderId);
  } catch (error) {
    // Shopify may have accepted the mutation even if the response was lost.
    // Check the recovery tag before reporting failure or issuing a refund.
    if (recoveryTag) {
      try {
        const recoveredOrderId = await findShopifyOrderByTags(args.shop, recoveryTags);
        if (recoveredOrderId) {
          logger.warn(
            { shopifyOrderId: recoveredOrderId, sourceIdentifier: args.sourceIdentifier },
            "[SHOPIFY] order mutation errored, but the order was recovered",
          );
          return recoveredOrderId;
        }
      } catch (recoveryError) {
        logger.error(
          {
            err: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            sourceIdentifier: args.sourceIdentifier,
          },
          "[SHOPIFY] failed to check whether order already exists",
        );
      }
    }
    throw error;
  }
}

async function findShopifyOrderByTags(shop: string, tags: string[]): Promise<string | null> {
  const query = `
    query findOrderByTag($query: String!) {
      orders(first: 1, query: $query) {
        nodes { id }
      }
    }
  `;
  const response = await shopifyAdminGraphql(shop, query, {
    // Legacy tags are searched only; never submit them on new orders.
    query: tags.map(tag => `tag:'${tag.replace(/['\\]/g, "")}'`).join(" OR "),
  });
  const orderId = response?.orders?.nodes?.[0]?.id;
  return typeof orderId === "string" && orderId ? orderId : null;
}

export async function fetchVariantPricingFromShopify(shop: string, variantGids: string[]) {
  if (variantGids.length === 0) {
    return { variants: [], missing: [] as string[] };
  }

  const query = `
    query variantPricing($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          title
          sku
          price
          product { title }
        }
      }
    }
  `;

  const response = (await shopifyAdminGraphql(shop, query, { ids: variantGids })) as VariantPricingResponse;
  const nodes = Array.isArray(response?.nodes) ? response.nodes : [];

  const variants: Array<{
    shopifyVariantGid: string;
    title: string | null;
    sku: string | null;
    price: string;
  }> = nodes
    .filter((node): node is ShopifyVariantNode => Boolean(node && typeof node.id === "string"))
    .filter(node => node.price !== null && node.price !== undefined)
    .map(node => {
      const variantTitle = typeof node.title === "string" ? node.title : null;
      const productTitle = typeof node.product?.title === "string" ? node.product.title : null;
      const displayTitle =
        productTitle && variantTitle && variantTitle !== "Default Title"
          ? `${productTitle} - ${variantTitle}`
          : (productTitle ?? variantTitle);
      return {
        shopifyVariantGid: String(node.id),
        title: displayTitle,
        sku: typeof node.sku === "string" ? node.sku : null,
        price: String(node.price ?? ""),
      };
    });

  const found = new Set(variants.map(variant => variant.shopifyVariantGid));
  const missing = variantGids.filter(gid => !found.has(gid));

  return { variants, missing };
}

export async function shopifyAdminGraphql(shop: string, query: string, variables?: Record<string, unknown>) {
  const token = config.shopify.adminAccessToken;
  if (!token) {
    throw new Error("Missing SHOPIFY_ADMIN_ACCESS_TOKEN");
  }

  const url = `https://${shop}/admin/api/${config.shopify.apiVersion}/graphql.json`;

  for (let attempt = 1; attempt <= SHOPIFY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(SHOPIFY_REQUEST_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
      });

      let json: any;
      try {
        json = await response.json();
      } catch {
        throw new Error("Invalid JSON response from Shopify");
      }

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < SHOPIFY_RETRY_ATTEMPTS) {
          logger.warn(`[SHOPIFY] GraphQL status=${response.status} attempt=${attempt} retrying`);
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw new ShopifyNonRetryableError(
          "Shopify GraphQL request failed: " + response.status + " " + JSON.stringify(json?.errors),
        );
      }

      if (json.errors) {
        throw new ShopifyNonRetryableError(
          "Shopify GraphQL request failed: " + JSON.stringify(json.errors),
        );
      }

      return json.data;
    } catch (error) {
      if (error instanceof ShopifyNonRetryableError) {
        throw error;
      }
      if (attempt >= SHOPIFY_RETRY_ATTEMPTS) {
        throw error;
      }
      await sleep(backoffDelay(attempt));
    }
  }

  throw new Error("Shopify GraphQL request failed completely");
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

function backoffDelay(attempt: number) {
  return SHOPIFY_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toMailingAddress(address?: ShopifyShippingAddress | null) {
  if (!address) {
    return undefined;
  }

  const name = address.name ?? "";
  const [firstName, ...rest] = name.split(" ").filter(Boolean);
  const lastName = rest.length > 0 ? rest.join(" ") : undefined;

  return {
    firstName: firstName || undefined,
    lastName,
    address1: address.address1 ?? undefined,
    address2: address.address2 ?? undefined,
    city: address.city ?? undefined,
    provinceCode: address.province ?? undefined,
    zip: address.zip ?? undefined,
    countryCode: address.country ?? undefined,
    phone: address.phone ?? undefined,
  };
}

