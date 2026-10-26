import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listOrders, type Order } from "../api/orders";
import { listMyNfts, type NftCertificate } from "../api/bowls";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { useCart } from "../cart/useCart";

const MAX_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 2000;

type ViewState =
  | { kind: "idle" }
  | { kind: "missingParams" }
  | { kind: "polling"; attempts: number; order: Order | null; nfts: NftCertificate[] }
  | { kind: "done"; order: Order; nfts: NftCertificate[] }
  | { kind: "error"; message: string };

function isShopifyTerminal(status: Order["status"]): boolean {
  return (
    status === "SHOPIFY_CREATED" || status === "REFUNDED" || status === "SHOPIFY_FAILED"
  );
}

function nftsTerminal(nfts: NftCertificate[]): boolean {
  return nfts.every(n => n.status === "MINTED" || n.status === "FAILED");
}

export function SuccessPage() {
  const [searchParams] = useSearchParams();
  const sessionId = useMemo(() => searchParams.get("session_id") ?? "", [searchParams]);

  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const timerRef = useRef<number | null>(null);
  const { clear: clearCart } = useCart();

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    async function tick(attempts: number) {
      try {
        const [orders, allNfts] = await Promise.all([
          listOrders(),
          listMyNfts().catch(() => [] as NftCertificate[]),
        ]);
        const order = orders.find(o => o.stripeSessionId === sessionId) ?? null;

        if (!order) {
          if (attempts >= MAX_ATTEMPTS) {
            setState({
              kind: "error",
              message:
                "Payment succeeded, but the order hasn't appeared yet. It may still be processing — check your orders in a minute.",
            });
            return;
          }
          setState({ kind: "polling", attempts, order: null, nfts: [] });
          timerRef.current = window.setTimeout(() => void tick(attempts + 1), POLL_INTERVAL_MS);
          return;
        }

        const orderNfts = allNfts.filter(n => n.orderId === order.id);
        const orderTerminal = isShopifyTerminal(order.status);
        const mintsTerminal = orderNfts.length === 0 || nftsTerminal(orderNfts);

        if (orderTerminal && mintsTerminal) {
          setState({ kind: "done", order, nfts: orderNfts });
          return;
        }

        setState({ kind: "polling", attempts, order, nfts: orderNfts });
        if (attempts < MAX_ATTEMPTS) {
          timerRef.current = window.setTimeout(() => void tick(attempts + 1), POLL_INTERVAL_MS);
        } else {
          setState({
            kind: "error",
            message:
              "We could not confirm that your order finished processing. Please check your orders or contact support.",
          });
        }
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Failed to load order status",
        });
      }
    }

    void tick(0);
  }, [sessionId]);

  useEffect(() => {
    const order = state.kind === "done" || state.kind === "polling" ? state.order : null;
    if (order?.status === "SHOPIFY_CREATED") {
      clearCart();
    }
  }, [state, clearCart]);

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />
      <main className="om-main">
        <div className="om-shell om-pagehead">
          <div className="om-pagehead-top">
            <Link to="/shop" className="om-continue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></svg>
              Back to shop
            </Link>
          </div>
          <h1>Order confirmation</h1>
        </div>
        <div className="om-shell om-block">{renderBody(sessionId ? state : { kind: "missingParams" }, sessionId)}</div>
      </main>
      <StoreFooter />
    </div>
  );
}

function renderBody(state: ViewState, sessionId: string) {
  if (state.kind === "missingParams") {
    return (
      <div>
        <p style={{ color: "crimson" }}>Missing required URL params.</p>
        <p style={{ marginTop: 12 }}>
          <Link to="/shop" style={{ color: "var(--fg)", fontWeight: 900 }}>
            Back to shop
          </Link>
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div>
        <p style={{ color: "crimson" }}>{state.message}</p>
        <p style={{ marginTop: 12 }}>
          <Link to="/orders" style={{ color: "var(--fg)", fontWeight: 900 }}>
            Go to orders
          </Link>
        </p>
      </div>
    );
  }

  if (state.kind === "idle") return null;

  const { order, nfts, attempts } =
    state.kind === "polling"
      ? { order: state.order, nfts: state.nfts, attempts: state.attempts }
      : { order: state.order, nfts: state.nfts, attempts: 0 };
  const statusMessage = checkoutStatusMessage(order);

  return (
    <div>
      <p style={{ color: statusMessage.color, fontWeight: 950, margin: 0 }}>
        {statusMessage.message}
      </p>
      {state.kind === "polling" && !order ? (
        <p style={{ color: "var(--muted-fg)", marginTop: 8 }}>
          Creating your order… (attempt {attempts + 1}/{MAX_ATTEMPTS})
        </p>
      ) : null}
      <p style={{ color: "var(--muted-fg)", fontSize: 13, marginTop: 8 }}>
        Stripe session: <code>{sessionId}</code>
      </p>

      {order ? (
        <div className="sh-card" style={{ marginTop: 12, padding: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted-fg)", fontWeight: 900 }}>Order</div>
          <div style={{ fontWeight: 950, color: "var(--fg)" }}>
            <code>{order.id}</code>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted-fg)" }}>
            Status: <strong style={{ color: "var(--fg)" }}>{order.status}</strong>
          </div>
          {order.shopifyOrderId ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted-fg)" }}>
              Shopify order: <code>{order.shopifyOrderId}</code>
            </div>
          ) : null}
        </div>
      ) : null}

      {order && nfts.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ margin: "12px 0 8px", fontSize: 14, fontWeight: 950 }}>
            Digital certificate
          </h3>
          {nfts.map(n => (
            <div key={n.id} className="sh-card" style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "rgba(13, 150, 136, 0.06)",
                    border: "1px solid rgba(31, 41, 46, 0.08)",
                  }}
                >
                  {n.bowl?.imageUrl ? (
                    <img
                      src={n.bowl.imageUrl}
                      alt={n.bowl.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : null}
                </div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div style={{ fontWeight: 950, color: "var(--fg)" }}>
                    {n.bowl?.name ?? "Certificate"}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted-fg)",
                      marginTop: 4,
                    }}
                  >
                    {n.bowl ? `#${n.bowl.serialNumber} of 101 · ` : ""}
                    {nftStatusCopy(n.status)}
                  </div>
                </div>
                <div>
                  {n.suiObjectId ? (
                    <a
                      href={`https://suiscan.xyz/testnet/object/${n.suiObjectId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="sh-btn sh-btnPrimary"
                      style={{ textDecoration: "none" }}
                    >
                      View on Sui Explorer →
                    </a>
                  ) : (
                    <span className="sh-badge sh-badgeInStock">{nftStatusCopy(n.status)}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <p style={{ marginTop: 14 }}>
        <Link to="/orders" style={{ color: "var(--fg)", fontWeight: 900, marginRight: 16 }}>
          View all orders
        </Link>
        <Link to="/account/nfts" style={{ color: "var(--fg)", fontWeight: 900 }}>
          My NFT certificates
        </Link>
      </p>
    </div>
  );
}

function checkoutStatusMessage(order: Order | null): { message: string; color: string } {
  if (!order) {
    return { message: "Confirming your payment and creating your order…", color: "var(--fg)" };
  }

  switch (order.status) {
    case "SHOPIFY_CREATED":
      return {
        message: "Thanks — your payment went through and your order is confirmed.",
        color: "var(--fg)",
      };
    case "REFUNDED":
      return {
        message: "We could not complete your order, so your payment was refunded.",
        color: "crimson",
      };
    case "SHOPIFY_FAILED":
      return {
        message: "Your payment was received, but we could not create your order. Please contact support.",
        color: "crimson",
      };
    case "PAID":
      return { message: "Your payment went through. We’re creating your order…", color: "var(--fg)" };
    case "PENDING":
      return { message: "Confirming your payment…", color: "var(--fg)" };
  }
}

function nftStatusCopy(status: NftCertificate["status"]): string {
  switch (status) {
    case "PENDING":
      return "Preparing your certificate…";
    case "MINTING":
      return "Engraving on-chain…";
    case "MINTED":
      return "Ready";
    case "FAILED":
      return "Action required — please contact support";
  }
}
