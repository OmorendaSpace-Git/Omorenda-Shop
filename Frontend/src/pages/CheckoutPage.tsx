import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { useCart } from "../cart/useCart";
import { useAuth } from "../auth/AuthContext";
import { API_BASE_URL, ApiError, fetchJson } from "../api/client";

function formatMoney(n: number, currency: string) {
  if (!Number.isFinite(n)) n = 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function CheckoutPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = useMemo(() => cart.items[0]?.currency ?? "USD", [cart.items]);

  const subtotal = useMemo(() => {
    return cart.items.reduce((sum, i) => sum + i.unitAmount * i.quantity, 0);
  }, [cart.items]);

  function maxQtyFor(i: { availableForSale: boolean; quantityAvailable: number | null }) {
    if (!i.availableForSale) return 0;
    if (typeof i.quantityAvailable === "number") return Math.max(0, Math.min(99, Math.trunc(i.quantityAvailable)));
    return 99;
  }

  async function checkout() {
    if (!isAuthenticated) {
      navigate("/login", { state: { returnTo: "/checkout" } });
      return;
    }
    if (cart.items.length === 0) return;

    const invalid = cart.items.find((i) => i.quantity > Math.max(1, maxQtyFor(i)));
    if (invalid) {
      setError("One or more items exceed available stock. Please reduce quantities.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const json = await fetchJson<{ url?: string }>(`${API_BASE_URL}/checkout/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.items.map((i) => ({ variantGid: i.variantGid, quantity: i.quantity })),
          successUrl: `${window.location.origin}/success?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(user?.email ?? "")}`,
          cancelUrl: `${window.location.origin}/checkout`,
        }),
      });
      if (!json.url) throw new Error("Missing Stripe Checkout url");

      window.location.href = json.url;
    } catch (e) {
      if (e instanceof ApiError && e.code === "SESSION_EXPIRED") {
        setLoading(false);
        navigate("/login", { state: { returnTo: "/checkout" } });
        return;
      }
      setError(e instanceof Error ? e.message : "Checkout failed");
      setLoading(false);
    }
  }

  const empty = cart.items.length === 0;

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />

      <main className="om-main">
        <div className="om-shell om-cart-head">
          <h1 className="om-serif">Your cart</h1>
          {!empty ? (
            <span className="om-cart-count">
              {cart.count} {cart.count === 1 ? "item" : "items"}
            </span>
          ) : null}
        </div>

        <div className="om-shell om-cart-toolbar">
          <Link to="/shop" className="om-continue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></svg>
            Continue shopping
          </Link>
          {!empty ? (
            <button type="button" className="om-cart-clear" onClick={() => cart.clear()}>
              Clear cart
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="om-shell">
            <p className="om-error">{error}</p>
          </div>
        ) : null}

        {empty ? (
          <div className="om-shell" style={{ paddingBottom: 24 }}>
            <div className="om-cart-empty">
              <p>Your cart is empty.</p>
              <button type="button" className="om-btn om-btn-primary" onClick={() => navigate("/shop")}>
                Browse products
              </button>
            </div>
          </div>
        ) : (
          <div className="om-shell om-cart-grid">
            <div className="om-cart-items">
              {cart.items.map((i) => {
                const href = `/products/${encodeURIComponent(i.productHandle)}`;
                const maxQty = Math.max(1, maxQtyFor(i));
                return (
                  <article key={i.variantGid} className="om-citem">
                    <Link to={href} className="om-citem-media">
                      {i.imageUrl ? <img src={i.imageUrl} alt={i.title} /> : null}
                    </Link>

                    <div className="om-citem-body">
                      <Link to={href} className="om-citem-name">{i.title}</Link>
                      <span className="om-citem-meta">
                        {i.variantTitle && i.variantTitle !== "Default Title" ? `${i.variantTitle} · ` : ""}
                        {formatMoney(i.unitAmount, i.currency)} each
                      </span>
                      <button type="button" className="om-citem-remove" onClick={() => cart.remove(i.variantGid)}>
                        Remove item
                      </button>
                    </div>

                    <div className="om-citem-controls">
                      <span className="om-citem-total om-serif">{formatMoney(i.unitAmount * i.quantity, i.currency)}</span>
                      <div className="om-qty" role="group" aria-label={`Quantity for ${i.title}`}>
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          onClick={() => cart.setQuantity(i.variantGid, i.quantity - 1)}
                          disabled={i.quantity <= 1}
                        >
                          −
                        </button>
                        <span className="om-qty-val">{i.quantity}</span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          onClick={() => cart.setQuantity(i.variantGid, i.quantity + 1)}
                          disabled={i.quantity >= maxQty}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <aside className="om-summary">
              <h2>Order summary</h2>
              <div className="om-summary-total">
                <b>Subtotal</b>
                <span>{formatMoney(subtotal, currency)}</span>
              </div>
              <p className="om-summary-note">Shipping and taxes are calculated at checkout.</p>
              <button type="button" className="om-checkout-btn" onClick={() => void checkout()} disabled={loading || authLoading}>
                <span>{loading ? "Opening checkout…" : authLoading ? "Checking account…" : "Continue to checkout"}</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
              </button>
            </aside>
          </div>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}
