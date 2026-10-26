import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { hideOrderFromHistory, listOrders, type Order, type OrderItem } from "../api/orders";
import { listMyNfts, type NftCertificate } from "../api/bowls";
import { useAuth } from "../auth/useAuth";
import { useCart } from "../cart/useCart";
import type { CartItem } from "../cart/types";
import { StoreFooter } from "../components/StoreFooter";
import { StoreHeader } from "../components/StoreHeader";

type ProductMeta = { imageUrl: string | null; productId: string; productHandle: string };
type ProductsResponse = {
  products: Array<{
    id: string;
    handle: string;
    images: Array<{ url: string }>;
    variants: Array<{ id: string }>;
  }>;
};

function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

function cartItem(order: Order, item: OrderItem, variantGid: string, meta?: ProductMeta): Omit<CartItem, "quantity"> {
  return {
    productId: meta?.productId ?? "unknown",
    productHandle: meta?.productHandle ?? "",
    title: item.title ?? "Purchased item",
    imageUrl: meta?.imageUrl ?? null,
    currency: order.currency,
    unitAmount: Number(item.unitPrice),
    variantGid,
    variantTitle: item.title ?? "Variant",
    availableForSale: true,
    quantityAvailable: null,
  };
}

export function OrdersPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const cart = useCart();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [certificates, setCertificates] = useState<NftCertificate[]>([]);
  const [variantMeta, setVariantMeta] = useState<Record<string, ProductMeta>>({});
  const [confirmOrderId, setConfirmOrderId] = useState<string | null>(null);
  const [hidingOrderId, setHidingOrderId] = useState<string | null>(null);
  const [hideError, setHideError] = useState<string | null>(null);
  const cancelHideRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmOrderId) return;
    cancelHideRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !hidingOrderId) setConfirmOrderId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmOrderId, hidingOrderId]);

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [data, nfts] = await Promise.all([listOrders(), listMyNfts().catch(() => [] as NftCertificate[])]);
        if (cancelled) return;
        setOrders(data);
        setCertificates(nfts);

        try {
          const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001/api";
          const response = await fetch(`${apiBase}/products?limit=250`);
          if (!response.ok) throw new Error("Product images unavailable");
          const { products } = (await response.json()) as ProductsResponse;
          const meta: Record<string, ProductMeta> = {};
          for (const product of products ?? []) {
            for (const variant of product.variants ?? []) {
              meta[variant.id] = {
                imageUrl: product.images?.[0]?.url ?? null,
                productId: product.id,
                productHandle: product.handle,
              };
            }
          }
          if (!cancelled) setVariantMeta(meta);
        } catch {
          if (!cancelled) setVariantMeta({});
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load purchases");
          setOrders([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  async function confirmHideOrder() {
    if (!confirmOrderId || hidingOrderId) return;
    const id = confirmOrderId;
    setHidingOrderId(id);
    setHideError(null);
    try {
      await hideOrderFromHistory(id);
      setOrders((current) => current.filter((order) => order.id !== id));
      setConfirmOrderId(null);
    } catch (cause) {
      setHideError(cause instanceof Error ? cause.message : "Couldn't remove this purchase from your history.");
    } finally {
      setHidingOrderId(null);
    }
  }

  if (!authLoading && !isAuthenticated) {
    return <Navigate to="/login" replace state={{ returnTo: "/orders" }} />;
  }

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />
      <main className="om-main">
        <div className="om-shell om-listing-head">
          <nav className="om-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link><span>/</span><span aria-current="page">My purchases</span>
          </nav>
          <h1>My purchases</h1>
          <p>Orders for {user?.email ?? "your account"}</p>
        </div>

        <div className="om-shell om-purchases-body">
          {authLoading ? <p className="om-state">Loading your account…</p> : null}
          {isAuthenticated && loading ? <p className="om-state">Loading purchases…</p> : null}
          {isAuthenticated && error ? <p className="om-error">{error}</p> : null}
          {isAuthenticated && !loading && !error && orders.length === 0 ? (
            <div className="om-purchases-empty">
              <h2>No purchases to show</h2>
              <p>New orders will appear here. Bowl certificates remain available in your account even if you remove an order from this list.</p>
              <div className="om-purchase-actions" style={{ justifyContent: "center" }}>
                <Link to="/shop" className="om-btn om-btn-primary">Explore the shop</Link>
                <Link to="/account/nfts" className="om-btn om-btn-outline">My NFT certificates</Link>
              </div>
            </div>
          ) : null}

          {isAuthenticated && !loading && !error ? (
            <div className="om-purchases-list">
              {orders.map((order) => (
                <article key={order.id} className="om-purchase">
                  <div className="om-purchase-head">
                    <div>
                      <span className="om-purchase-label">Order placed</span>
                      <h2>{new Date(order.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</h2>
                    </div>
                    <div className="om-purchase-summary">
                      <span className="om-purchase-status">{order.status.replaceAll("_", " ").toLowerCase()}</span>
                      <strong>{formatMoney(order.total, order.currency)}</strong>
                      <button type="button" className="om-purchase-remove" onClick={() => { setHideError(null); setConfirmOrderId(order.id); }}>
                        Remove from history
                      </button>
                    </div>
                  </div>
                  <div className="om-purchase-items">
                    {order.items.map((item) => {
                      const variantGid = item.shopifyVariantGid;
                      const meta = variantGid ? variantMeta[variantGid] : undefined;
                      const certificate = certificates.find((nft) => nft.orderId === order.id && nft.productKind === "BOWL");
                      const isBowl = Boolean(certificate) || /^BOWL-\d{3}$/i.test(item.sku ?? "");
                      const inCart = variantGid ? cart.ids.has(variantGid) : false;
                      return (
                        <div key={item.id} className="om-purchase-item">
                          <div className="om-purchase-image">
                            {meta?.imageUrl || certificate?.bowl?.imageUrl ? <img src={meta?.imageUrl ?? certificate?.bowl?.imageUrl ?? ""} alt="" /> : <span aria-hidden="true">Omorenda</span>}
                          </div>
                          <div className="om-purchase-info">
                            <h3>{item.title ?? "Purchased item"}</h3>
                            <p>Qty {item.quantity} · {formatMoney(item.unitPrice, order.currency)} each</p>
                            <div className="om-purchase-actions">
                              {isBowl ? (
                                <Link to={certificate ? `/account/nfts#certificate-${certificate.id}` : "/account/nfts"} className="om-btn om-btn-primary">
                                  View NFT certificate
                                </Link>
                              ) : variantGid ? (
                                <button type="button" className="om-btn om-btn-primary" onClick={() => cart.add(cartItem(order, item, variantGid, meta), item.quantity)}>
                                  {inCart ? "Add more to cart" : "Add to cart"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <strong className="om-purchase-line-total">{formatMoney(item.lineTotal, order.currency)}</strong>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </main>

      {confirmOrderId ? (
        <div className="om-history-dialog-backdrop">
          <div className="om-history-dialog" role="alertdialog" aria-modal="true" aria-labelledby="om-hide-title" aria-describedby="om-hide-description">
            <h2 id="om-hide-title">Remove this purchase?</h2>
            <p id="om-hide-description">It will disappear from My purchases. This does not cancel or refund the order, and any bowl NFT certificate will remain in your account.</p>
            {hideError ? <p className="om-error" role="alert">{hideError}</p> : null}
            <div className="om-history-dialog-actions">
              <button ref={cancelHideRef} type="button" className="om-btn om-btn-outline" disabled={Boolean(hidingOrderId)} onClick={() => setConfirmOrderId(null)}>Keep purchase</button>
              <button type="button" className="om-btn om-btn-primary" disabled={Boolean(hidingOrderId)} onClick={() => void confirmHideOrder()}>
                {hidingOrderId ? "Removing…" : "Remove from history"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <StoreFooter />
    </div>
  );
}
