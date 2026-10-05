import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listOrders, type Order, type OrderItem } from "../api/orders";
import { useAuth } from "../auth/AuthContext";
import { useCart } from "../cart/useCart";
import type { CartItem } from "../cart/types";
import { AuthGate } from "../components/AuthGate";
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

function cartItem(order: Order, item: OrderItem, meta?: ProductMeta): Omit<CartItem, "quantity"> {
  return {
    productId: meta?.productId ?? "unknown",
    productHandle: meta?.productHandle ?? "",
    title: item.title ?? "Purchased item",
    imageUrl: meta?.imageUrl ?? null,
    currency: order.currency,
    unitAmount: Number(item.unitPrice),
    variantGid: item.shopifyVariantGid,
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
  const [variantMeta, setVariantMeta] = useState<Record<string, ProductMeta>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      setOrders([]);
      setVariantMeta({});
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listOrders();
        if (cancelled) return;
        setOrders(data);

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

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />
      <main className="om-main">
        <div className="om-shell om-listing-head">
          <nav className="om-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link><span>/</span><span aria-current="page">My purchases</span>
          </nav>
          <h1>My purchases</h1>
          <p>{isAuthenticated ? `Orders for ${user?.email ?? "your account"}` : "Sign in to see your orders and buy your favorites again."}</p>
        </div>

        <div className="om-shell om-purchases-body">
          {authLoading ? <p className="om-state">Loading your account…</p> : null}
          {!authLoading && !isAuthenticated ? (
            <div className="om-purchases-gate">
              <AuthGate appearance="plain" />
            </div>
          ) : null}
          {isAuthenticated && loading ? <p className="om-state">Loading purchases…</p> : null}
          {isAuthenticated && error ? <p className="om-error">{error}</p> : null}
          {isAuthenticated && !loading && !error && orders.length === 0 ? (
            <div className="om-purchases-empty">
              <h2>No purchases yet</h2>
              <p>When you place an order, you’ll find it here.</p>
              <Link to="/shop" className="om-btn om-btn-primary">Explore the shop</Link>
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
                    </div>
                  </div>
                  <div className="om-purchase-items">
                    {order.items.map((item) => {
                      const meta = variantMeta[item.shopifyVariantGid];
                      const inCart = cart.ids.has(item.shopifyVariantGid);
                      const product = cartItem(order, item, meta);
                      return (
                        <div key={item.id} className="om-purchase-item">
                          <div className="om-purchase-image">
                            {meta?.imageUrl ? <img src={meta.imageUrl} alt="" /> : <span aria-hidden="true">Omorenda</span>}
                          </div>
                          <div className="om-purchase-info">
                            <h3>{item.title ?? "Purchased item"}</h3>
                            <p>Qty {item.quantity} · {formatMoney(item.unitPrice, order.currency)} each</p>
                            <div className="om-purchase-actions">
                              <button type="button" className="om-btn om-btn-primary" onClick={() => cart.add(product, item.quantity)}>
                                Reorder
                              </button>
                              <button type="button" className="om-btn om-btn-outline" onClick={() => cart.toggle(product)}>
                                {inCart ? "Remove from cart" : "Add to cart"}
                              </button>
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
      <StoreFooter />
    </div>
  );
}
