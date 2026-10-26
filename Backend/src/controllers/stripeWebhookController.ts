import type Stripe from "stripe";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { config } from "../config/config";
import { prisma } from "../config/db";
import { logger } from "../utils/logger";
import { getStripeClient } from "../services/stripe/client";
import { parseItemsMetadata } from "../utils/stripeMetadata";
import { centsToDecimalString, fetchVariantPricing, priceOrderItems } from "../services/pricing";
import { createShopifyOrder } from "../services/shopify/admin";
import { handleBowlCheckoutCompleted } from "./bowlWebhookHandler";

export async function handleStripeWebhook(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  if (!config.stripe.webhookSecret) {
    res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
    return;
  }

  const rawBody = req.body;
  if (!rawBody || !(rawBody instanceof Buffer)) {
    res.status(400).send("Missing raw webhook body");
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  } catch (error) {
    logger.error({ err: toErrorMessage(error) }, "[WEBHOOK][STRIPE] signature verification failed");
    res.status(400).send("Invalid signature");
    return;
  }

  const tracked = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { provider: "stripe", externalId: event.id } },
  });
  const processingIsFresh = tracked?.status === "PROCESSING" && tracked.updatedAt > new Date(Date.now() - 5 * 60 * 1000);
  if (tracked?.status === "SUCCEEDED" || processingIsFresh) {
    res.status(200).send();
    return;
  }
  if (tracked) {
    await prisma.webhookEvent.update({ where: { id: tracked.id }, data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null } });
  } else {
    try {
      await prisma.webhookEvent.create({ data: { provider: "stripe", externalId: event.id, type: event.type } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        res.status(200).send();
        return;
      }
      throw error;
    }
  }

  try {
    logger.info(
      { eventId: event.id, eventType: event.type },
      "[WEBHOOK][STRIPE] received event",
    );
    if (event.type === "checkout.session.completed") {
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
    }
    await prisma.webhookEvent.update({
      where: { provider_externalId: { provider: "stripe", externalId: event.id } },
      data: { status: "SUCCEEDED", processedAt: new Date(), lastError: null },
    });
    res.status(200).send();
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { provider_externalId: { provider: "stripe", externalId: event.id } },
      data: { status: "FAILED", lastError: toErrorMessage(error) },
    }).catch(() => undefined);
    logger.error({ err: toErrorMessage(error), eventId: event.id }, "[WEBHOOK][STRIPE] processing failed");
    res.status(500).send();
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return;
  }

  const email =
    (typeof session.metadata?.email === "string" && session.metadata.email) ||
    session.customer_details?.email ||
    session.customer_email ||
    null;
  if (!email) {
    throw new Error("Missing email for checkout session");
  }

  const flow = typeof session.metadata?.flow === "string" ? session.metadata.flow : "product_purchase";
  const userId = typeof session.metadata?.userId === "string" ? session.metadata.userId : null;

  logger.info(
    { stripeSessionId: session.id, email, flow },
    "[WEBHOOK][STRIPE] checkout.session.completed (paid)",
  );

  if (flow === "bowl_purchase") {
    await handleBowlCheckoutCompleted(session, email);
    return;
  }

  const items = parseItemsMetadata(session.metadata ?? null);
  const currency = (session.currency ?? "usd").toUpperCase();
  const stripeSessionId = session.id;
  const stripePaymentId =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

  const existing = await prisma.order.findUnique({
    where: { stripeSessionId },
    include: { items: true },
  });
  if (existing?.status === "SHOPIFY_CREATED" || existing?.status === "REFUNDED") {
    logger.info(
      { stripeSessionId, orderId: existing.id, status: existing.status },
      "[WEBHOOK][STRIPE] already processed session",
    );
    return;
  }
  if (existing?.status === "SHOPIFY_FAILED") {
    logger.warn(
      { stripeSessionId, orderId: existing.id },
      "[WEBHOOK][STRIPE] order requires manual recovery after Shopify/refund failure",
    );
    return;
  }

  const shippingAddress = extractShippingDetails(session);
  const order = existing
    ? await prisma.order.update({
        where: { id: existing.id },
        data: {
          stripePaymentId: existing.stripePaymentId ?? stripePaymentId,
          status: "PAID",
          paymentStatus: "PAID",
          shopifyStatus: "PENDING",
          shippingAddress: (shippingAddress ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
        include: { items: true },
      })
    : await createLegacyPaidOrder({
        email,
        stripeSessionId,
        stripePaymentId,
        currency,
        shippingAddress,
        items,
        userId,
      });

  if (!config.shopify.shop) {
    logger.error(
      { stripeSessionId: session.id, orderId: order.id },
      "[WEBHOOK][STRIPE] missing SHOPIFY_SHOP; asking Stripe to retry webhook",
    );
    throw new Error("Missing SHOPIFY_SHOP; cannot create paid order in Shopify");
  }

  const shopifyLineItems = order.items.flatMap(item =>
    item.shopifyVariantGid
      ? [
          {
            variantGid: item.shopifyVariantGid,
            quantity: item.quantity,
            unitPrice: String(item.unitPrice),
          },
        ]
      : [],
  );
  if (shopifyLineItems.length === 0) {
    throw new Error("Paid order has no Shopify line items");
  }

  let shopifyOrderId: string;
  try {
    shopifyOrderId = await createShopifyOrder({
      shop: config.shopify.shop,
      email,
      currency: order.currency,
      lineItems: shopifyLineItems,
      shippingAddress: toShopifyShippingAddress(shippingAddress),
      sourceIdentifier: stripeSessionId,
    });
  } catch (error) {
    const stripe = getStripeClient();

    try {
      if (stripePaymentId) {
        await prisma.order.update({ where: { id: order.id }, data: { refundStatus: "PENDING" } });
        const refund = await stripe.refunds.create(
          { payment_intent: stripePaymentId },
          { idempotencyKey: `automatic-shopify-failure-${order.id}` },
        );
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: "REFUNDED",
            paymentStatus: "REFUNDED",
            refundStatus: "SUCCEEDED",
            shopifyStatus: "FAILED",
            stripeRefundId: refund.id,
            refundedAt: new Date(),
            lastError: toErrorMessage(error),
          },
        });
        logger.error(
          { err: toErrorMessage(error), orderId: order.id, refundId: refund.id },
          "[WEBHOOK][STRIPE] Shopify order creation failed; refunded payment",
        );
        return;
      }
    } catch (refundError) {
      logger.error(
        { err: toErrorMessage(refundError), orderId: order.id },
        "[WEBHOOK][STRIPE] Shopify order creation failed; refund attempt failed",
      );
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { status: "SHOPIFY_FAILED", shopifyStatus: "FAILED", refundStatus: "FAILED", lastError: toErrorMessage(error) },
    });

    logger.error(
      { err: toErrorMessage(error), orderId: order.id, stripeSessionId },
      "[WEBHOOK][STRIPE] Shopify order creation failed; order marked SHOPIFY_FAILED",
    );
    throw error;
  }

  try {
    await prisma.order.update({
      where: { id: order.id },
      data: { shopifyOrderId, status: "SHOPIFY_CREATED", shopifyStatus: "SUCCEEDED", lastError: null },
    });
  } catch (error) {
    logger.error(
      { err: toErrorMessage(error), orderId: order.id, shopifyOrderId, stripeSessionId },
      "[WEBHOOK][STRIPE] Shopify order exists but local order update failed; webhook will reconcile",
    );
    throw error;
  }

  logger.info(
    { orderId: order.id, shopifyOrderId, stripeSessionId },
    "[WEBHOOK][STRIPE] Shopify order created",
  );
}

async function createLegacyPaidOrder(args: {
  email: string;
  stripeSessionId: string;
  stripePaymentId: string | null;
  currency: string;
  shippingAddress: ReturnType<typeof extractShippingDetails>;
  items: Array<{ variantGid: string; quantity: number }>;
  userId: string | null;
}) {
  if (args.items.length === 0) {
    throw new Error("Checkout session missing order items metadata");
  }
  const variantGids = args.items.map(item => item.variantGid);
  const { variants, missing } = await fetchVariantPricing(variantGids);
  if (missing.length > 0) {
    throw new Error("Unable to price all order items from Shopify");
  }
  const priced = priceOrderItems({ items: args.items, variants, currency: args.currency });

  return prisma.order.create({
    data: {
      email: args.email,
      userId: args.userId,
      stripeSessionId: args.stripeSessionId,
      stripePaymentId: args.stripePaymentId,
      status: "PAID",
      paymentStatus: "PAID",
      shopifyStatus: "PENDING",
      currency: args.currency,
      subtotal: new Prisma.Decimal(centsToDecimalString(priced.totals.subtotalCents, args.currency)),
      discountAmount: new Prisma.Decimal(
        centsToDecimalString(priced.totals.discountAmountCents, args.currency),
      ),
      total: new Prisma.Decimal(centsToDecimalString(priced.totals.totalCents, args.currency)),
      shippingAddress: (args.shippingAddress ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      items: {
        create: priced.items.map(item => ({
          shopifyVariantGid: item.variantGid,
          title: item.title,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: new Prisma.Decimal(
            centsToDecimalString(item.discountedUnitAmountCents, args.currency),
          ),
          discountApplied: new Prisma.Decimal(
            centsToDecimalString(item.discountAppliedCents, args.currency),
          ),
          lineTotal: new Prisma.Decimal(centsToDecimalString(item.lineTotalCents, args.currency)),
        })),
      },
    },
    include: { items: true },
  });
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

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return "Unknown Stripe webhook error";
}

