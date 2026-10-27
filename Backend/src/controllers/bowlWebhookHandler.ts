import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db";
import { config } from "../config/config";
import { logger } from "../utils/logger";
import { enqueueBowlMint } from "../queue/nftMintQueue";
import { getStripeClient } from "../services/stripe/client";
import { createShopifyOrder, ShopifyOutOfStockError } from "../services/shopify/admin";
import { getBowlBySerial, invalidateBowlCache, toMintPayload } from "../services/shopify/bowls";
import {
  BowlAlreadyMintedOnChainError,
  isBowlSerialMinted,
} from "../services/sui/mintState";

/**
 * Handles a Stripe `checkout.session.completed` event for a bowl purchase.
 *
 * Shopify owns bowl inventory, so the Shopify order creation (with
 * DECREMENT_OBEYING_POLICY) is the authoritative sold-out gate:
 *
 *   - decrement succeeds → this buyer won: Order → SHOPIFY_CREATED and an
 *     NftMint(PENDING) row is created with a snapshot of the bowl attributes
 *   - out of stock → this buyer lost a race on a one-of-one bowl: the Stripe
 *     payment is refunded and the Order marked REFUNDED
 *   - other Shopify failure → refund as well (matching the regular product
 *     flow); if even the refund fails, Order → SHOPIFY_FAILED for manual
 *     retry
 *
 * Idempotent on stripeSessionId — re-deliveries no-op.
 */
export async function handleBowlCheckoutCompleted(
  session: Stripe.Checkout.Session,
  email: string,
) {
  const serialRaw = session.metadata?.bowlSerial;
  const serial = typeof serialRaw === "string" ? Number(serialRaw) : NaN;
  const userId = typeof session.metadata?.userId === "string" ? session.metadata.userId : null;
  const variantGid =
    typeof session.metadata?.variantGid === "string" ? session.metadata.variantGid : null;
  if (!Number.isInteger(serial) || !userId || !variantGid) {
    throw new Error("bowl_purchase session missing bowlSerial/userId/variantGid metadata");
  }

  // Idempotency: a terminal status means this session is fully processed.
  // PENDING is created before redirecting to Stripe; PAID or SHOPIFY_FAILED
  // means an earlier delivery stopped before Shopify finished. Resume those
  // states so a crash or transient failure cannot strand a paid order.
  let existing = await prisma.order.findUnique({
    where: { stripeSessionId: session.id },
    include: { items: true },
  });
  if (existing && (existing.status === "SHOPIFY_CREATED" || existing.status === "REFUNDED")) {
    logger.info(
      { stripeSessionId: session.id, orderId: existing.id, status: existing.status },
      "[WEBHOOK][BOWL] already processed",
    );
    return;
  }

  const stripePaymentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  const shippingAddress = extractShippingDetails(session);
  if (existing?.status === "PENDING") {
    existing = await prisma.order.update({
      where: { id: existing.id },
      data: {
        status: "PAID",
        paymentStatus: "PAID",
        shopifyStatus: "PENDING",
        stripePaymentId: existing.stripePaymentId ?? stripePaymentId,
        shippingAddress: (shippingAddress ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
      include: { items: true },
    });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error(`User ${userId} not found for session ${session.id}`);
  }

  // Throwing here 500s the webhook so Stripe redelivers — a transient
  // Shopify outage must not lose a paid order.
  const bowl = await getBowlBySerial(serial, { bypassCache: true });
  if (!bowl) {
    throw new Error(`Bowl #${serial} not found in Shopify for session ${session.id}`);
  }

  const currency = (session.currency ?? bowl.currency ?? "USD").toUpperCase();
  const price = new Prisma.Decimal(bowl.price);
  const sku = bowl.sku ?? `BOWL-${String(serial).padStart(3, "0")}`;
  const order =
    existing ??
    (await prisma.order.create({
      data: {
        email,
        userId,
        stripeSessionId: session.id,
        stripePaymentId,
        status: "PAID",
        paymentStatus: "PAID",
        shopifyStatus: "PENDING",
        currency,
        subtotal: price,
        discountAmount: new Prisma.Decimal(0),
        total: price,
        shippingAddress: (shippingAddress ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        items: {
          create: [
            {
              shopifyVariantGid: variantGid,
              title: bowl.name,
              sku,
              quantity: 1,
              unitPrice: price,
              discountApplied: new Prisma.Decimal(0),
              lineTotal: price,
            },
          ],
        },
      },
      include: { items: true },
    }));

  const orderItem = order.items[0];
  if (!orderItem) {
    throw new Error("Internal: order item missing after create");
  }

  // Payment can complete after the checkout-time availability check. Verify
  // the chain again before creating a Shopify order. A transient Sui failure
  // is thrown so Stripe retries; a confirmed prior mint is refunded.
  const mintedOnChain = await isBowlSerialMinted(serial, { bypassCache: true });
  if (mintedOnChain) {
    await refundLostOrFailed(
      order.id,
      stripePaymentId,
      serial,
      new BowlAlreadyMintedOnChainError(serial),
    );
    return;
  }

  if (!config.shopify.shop) {
    // Misconfiguration must not refund a paying customer: throw so Stripe
    // redelivers and the PAID order resumes once config is fixed.
    throw new Error("Missing SHOPIFY_SHOP; cannot create bowl order in Shopify");
  }

  let shopifyOrderId: string;
  try {
    shopifyOrderId = await createShopifyOrder({
      shop: config.shopify.shop,
      email,
      currency,
      inventoryBehaviour: "DECREMENT_OBEYING_POLICY",
      lineItems: [{ variantGid, quantity: 1, unitPrice: bowl.price }],
      shippingAddress: toShopifyShippingAddress(shippingAddress),
      sourceIdentifier: session.id,
    });
  } catch (error) {
    invalidateBowlCache();
    // Concurrent first orders for the same new customer can collide on
    // Shopify's customer creation ("Customer email address has already been
    // taken"). That's transient — the customer exists now — so let Stripe
    // redeliver and resume rather than refunding a legitimate sale.
    if (error instanceof Error && /already been taken/i.test(error.message)) {
      throw error;
    }
    await refundLostOrFailed(order.id, stripePaymentId, serial, error);
    return;
  }
  invalidateBowlCache();

  await prisma.order.update({
    where: { id: order.id },
    data: { shopifyOrderId, status: "SHOPIFY_CREATED", shopifyStatus: "SUCCEEDED", lastError: null },
  });

  if (!user.suiAddress) {
    // Checkout requires a wallet, so this is a defensive fallback only.
    logger.warn(
      { stripeSessionId: session.id, orderId: order.id, serial, userId: user.id },
      "[WEBHOOK][BOWL] order created; NFT mint NOT enqueued (user has no suiAddress)",
    );
    return;
  }

  try {
    await prisma.nftMint.create({
      data: {
        orderId: order.id,
        orderItemId: orderItem.id,
        userId: user.id,
        productKind: "BOWL",
        bowlSerial: serial,
        mintPayload: toMintPayload(bowl) as Prisma.InputJsonValue,
        shopifyVariantGid: variantGid,
        recipientSuiAddress: user.suiAddress,
        status: "PENDING",
      },
    });
  } catch (error) {
    // Unique bowlSerial violation would mean a second sale of the same bowl
    // slipped past the inventory gate — surface loudly, don't fail the
    // webhook (the order itself is fine).
    logger.error(
      {
        err: error instanceof Error ? error.message : String(error),
        orderId: order.id,
        serial,
      },
      "[WEBHOOK][BOWL] failed to create NftMint row",
    );
    return;
  }

  await enqueueBowlMint({ orderItemId: orderItem.id });
  logger.info(
    { stripeSessionId: session.id, orderId: order.id, shopifyOrderId, serial },
    "[WEBHOOK][BOWL] order created in Shopify + NFT mint enqueued",
  );
}

async function refundLostOrFailed(
  orderId: string,
  stripePaymentId: string | null,
  serial: number,
  error: unknown,
) {
  const alreadyMinted = error instanceof BowlAlreadyMintedOnChainError;
  const lostRace = error instanceof ShopifyOutOfStockError || alreadyMinted;
  const errMessage = error instanceof Error ? error.message : String(error);

  try {
    if (stripePaymentId) {
      const stripe = getStripeClient();
      await prisma.order.update({ where: { id: orderId }, data: { refundStatus: "PENDING" } });
      const refund = await stripe.refunds.create(
        { payment_intent: stripePaymentId },
        { idempotencyKey: `automatic-bowl-failure-${orderId}` },
      );
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: "REFUNDED", paymentStatus: "REFUNDED", shopifyStatus: "FAILED",
          refundStatus: "SUCCEEDED", stripeRefundId: refund.id, refundedAt: new Date(), lastError: errMessage,
        },
      });
      logger.error(
        { err: errMessage, orderId, serial, refundId: refund.id, lostRace },
        alreadyMinted
          ? "[WEBHOOK][BOWL] bowl already minted on Sui; payment refunded"
          : lostRace
          ? "[WEBHOOK][BOWL] bowl already sold (lost inventory race); payment refunded"
          : "[WEBHOOK][BOWL] Shopify order creation failed; payment refunded",
      );
      return;
    }
  } catch (refundError) {
    logger.error(
      {
        err: refundError instanceof Error ? refundError.message : String(refundError),
        orderId,
        serial,
      },
      "[WEBHOOK][BOWL] Shopify order creation failed; refund attempt failed",
    );
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "SHOPIFY_FAILED", shopifyStatus: "FAILED", refundStatus: "FAILED", lastError: errMessage },
  });
  logger.error(
    { err: errMessage, orderId, serial, lostRace },
    "[WEBHOOK][BOWL] Shopify order creation failed; order marked SHOPIFY_FAILED",
  );
  throw error instanceof Error ? error : new Error(errMessage);
}

function extractShippingDetails(session: Stripe.Checkout.Session) {
  return session.shipping_details ?? null;
}

function toShopifyShippingAddress(
  shipping: Stripe.Checkout.Session.ShippingDetails | null,
) {
  if (!shipping?.address) {
    return null;
  }

  return {
    name: shipping.name ?? null,
    address1: shipping.address.line1 ?? null,
    address2: shipping.address.line2 ?? null,
    city: shipping.address.city ?? null,
    province: shipping.address.state ?? null,
    zip: shipping.address.postal_code ?? null,
    country: shipping.address.country ?? null,
  };
}
