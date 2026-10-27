import type { Response } from "express";
import { prisma } from "../config/db";
import { getStripeClient, isStripeCredentialError } from "../services/stripe/client";
import { config } from "../config/config";
import { toMinorUnits } from "../utils/currency";
import { logger } from "../utils/logger";
import { getBowlBySerial, MAX_SERIAL, MIN_SERIAL } from "../services/shopify/bowls";
import type { AuthedRequest } from "../auth/middleware";
import { z } from "zod";
import { parseOrRespond, trustedRedirectUrl } from "../utils/validation";
import { isBowlSerialMinted } from "../services/sui/mintState";

const bowlCheckoutSchema = z.object({
  serial: z.number().int().min(MIN_SERIAL).max(MAX_SERIAL),
  successUrl: z.string().url().max(1000).optional(),
  cancelUrl: z.string().url().max(1000).optional(),
});

/**
 * Starts a Stripe checkout for one singing bowl.
 *
 * Inventory lives in Shopify; there is no reservation. The availability
 * check here is a UX guard only — the authoritative sold-out gate is the
 * DECREMENT_OBEYING_POLICY Shopify order creation in the payment webhook,
 * which refunds the loser if two buyers pay for the same bowl.
 *
 * Requires a wallet: the NFT certificate is minted to the buyer's zkLogin
 * address, so buyers without one must sign in with Google first.
 */
export async function createBowlCheckoutSession(req: AuthedRequest, res: Response) {
  const body = parseOrRespond(bowlCheckoutSchema, req.body ?? {}, res);
  if (!body) return;
  const { serial, successUrl, cancelUrl } = body;

  const userId = req.user?.id ?? null;
  const email = req.user?.email ?? null;
  if (!userId || !email) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  if (!user.suiAddress) {
    res.status(403).json({
      code: "GOOGLE_SIGNIN_REQUIRED",
      message:
        "Sign in with Google to purchase a bowl — your certificate is minted to a wallet created from your Google account",
    });
    return;
  }

  const bowl = await getBowlBySerial(serial, { bypassCache: true });
  if (!bowl) {
    res.status(404).json({ message: "Bowl not found" });
    return;
  }
  let mintedOnChain: boolean;
  try {
    // Checkout always bypasses the short storefront cache. A stale chain read
    // must never allow payment for an already-minted one-of-one bowl.
    mintedOnChain = await isBowlSerialMinted(serial, { bypassCache: true });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), serial },
      "[BOWL_CHECKOUT] failed to verify Sui mint state",
    );
    res.status(503).json({
      code: "BOWL_AVAILABILITY_UNAVAILABLE",
      message: "Unable to verify bowl availability. Please try again.",
    });
    return;
  }
  if (!bowl.available || mintedOnChain) {
    res.status(409).json({ message: "Bowl already sold" });
    return;
  }

  const currency = bowl.currency || "USD";
  const unitAmountCents = toMinorUnits(Number(bowl.price), currency);
  if (unitAmountCents <= 0) {
    res.status(400).json({ message: "Bowl price must be greater than zero" });
    return;
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      shipping_address_collection: { allowed_countries: ["US", "CA"] },
      phone_number_collection: { enabled: true },
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: bowl.name,
              description: `Singing Bowl #${bowl.serial}`,
              images: bowl.imageUrl ? [bowl.imageUrl] : undefined,
            },
            unit_amount: unitAmountCents,
          },
          quantity: 1,
        },
      ],
      success_url: trustedRedirectUrl(successUrl, `${config.frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`),
      cancel_url: trustedRedirectUrl(cancelUrl, `${config.frontendUrl}/bowls/${bowl.serial}`),
      metadata: {
        email,
        flow: "bowl_purchase",
        bowlSerial: String(bowl.serial),
        variantGid: bowl.variantGid,
        userId,
      },
    });

    try {
      await prisma.order.create({
        data: {
          email,
          userId,
          stripeSessionId: session.id,
          status: "PENDING",
          paymentStatus: "PENDING",
          shopifyStatus: "NOT_STARTED",
          currency,
          subtotal: bowl.price,
          discountAmount: 0,
          total: bowl.price,
          items: {
            create: [
              {
                shopifyVariantGid: bowl.variantGid,
                title: bowl.name,
                sku: bowl.sku ?? `BOWL-${String(bowl.serial).padStart(3, "0")}`,
                quantity: 1,
                unitPrice: bowl.price,
                discountApplied: 0,
                lineTotal: bowl.price,
              },
            ],
          },
        },
      });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), serial, stripeSessionId: session.id },
        "[BOWL_CHECKOUT] failed to save pending order; expiring Stripe session",
      );
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireError) {
        logger.error(
          {
            err: expireError instanceof Error ? expireError.message : String(expireError),
            serial,
            stripeSessionId: session.id,
          },
          "[BOWL_CHECKOUT] failed to expire orphaned Stripe session",
        );
      }
      res.status(500).json({
        code: "ORDER_INITIALIZATION_FAILED",
        message: "Unable to prepare your order. Please try again.",
      });
      return;
    }

    res.status(200).json({
      sessionId: session.id,
      url: session.url,
      totals: {
        subtotal: bowl.price,
        total: bowl.price,
        currency,
      },
    });
  } catch (err) {
    const credentialError = isStripeCredentialError(err);
    logger.error(
      { err: err instanceof Error ? err.message : String(err), serial },
      credentialError
        ? "[BOWL_CHECKOUT] Stripe credentials are missing, invalid, or revoked"
        : "[BOWL_CHECKOUT] failed to create Stripe session",
    );
    res.status(credentialError ? 503 : 502).json({
      code: credentialError ? "PAYMENT_PROVIDER_AUTH_ERROR" : "PAYMENT_PROVIDER_ERROR",
      message: credentialError
        ? "Payment is temporarily unavailable. The store administrator has been notified."
        : "Unable to start payment. Please try again.",
    });
  }
}
