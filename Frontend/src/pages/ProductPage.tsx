import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { fetchProducts, getFirstAvailableVariant, type StoreProduct } from "../shop/products";
import { useCart } from "../cart/useCart";

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function ProductPage() {
  const params = useParams();
  const handle = typeof params.handle === "string" ? params.handle : null;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [allProducts, setAllProducts] = useState<StoreProduct[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const cart = useCart();

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);
        if (!handle) throw new Error("Missing product handle");
        const json = await fetchProducts(250);
        const list = json.products ?? [];
        const found = list.find((p) => p.handle === handle) ?? null;
        if (!found) throw new Error("Product not found");
        if (!cancelled) {
          setAllProducts(list);
          setProduct(found);
          const firstAvailable = getFirstAvailableVariant(found);
          setSelectedVariantId(firstAvailable?.id ?? found.variants?.[0]?.id ?? null);
          setActiveImage(0);
          setQuantity(1);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const variants = product?.variants ?? [];
  const selectedVariant =
    (selectedVariantId ? variants.find((v) => v.id === selectedVariantId) : null) ?? variants[0] ?? null;
  const canBuy = !!selectedVariant?.availableForSale;
  const maxQty =
    selectedVariant?.availableForSale === false
      ? 0
      : typeof selectedVariant?.quantityAvailable === "number"
        ? Math.max(0, Math.min(99, Math.trunc(selectedVariant.quantityAvailable)))
        : 99;
  const maxQtyUi = Math.max(1, maxQty);
  const quantityUi = Math.min(maxQtyUi, Math.max(1, quantity));

  const currency = product?.price?.min?.currencyCode ?? "USD";
  const displayAmount = Number(selectedVariant?.price?.amount ?? product?.price?.min?.amount ?? 0);
  const showVariants = variants.length > 1;

  const related = useMemo(() => {
    if (!product) return [];
    return allProducts.filter((p) => p.id !== product.id).slice(0, 4);
  }, [allProducts, product]);

  function addToCart() {
    if (!selectedVariant?.id || !product) return;
    cart.add(
      {
        productId: product.id,
        productHandle: product.handle,
        title: product.title,
        imageUrl: product.images?.[0]?.url ?? null,
        currency,
        unitAmount: displayAmount,
        variantGid: selectedVariant.id,
        variantTitle: selectedVariant.title,
        availableForSale: selectedVariant.availableForSale,
        quantityAvailable: typeof selectedVariant.quantityAvailable === "number" ? selectedVariant.quantityAvailable : null,
      },
      quantityUi,
    );
  }

  if (loading) {
    return (
      <div className="om-page">
        <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />
        <main className="om-main">
          <p className="om-state">Loading…</p>
        </main>
        <StoreFooter />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="om-page">
        <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />
        <main className="om-main">
          <p className="om-state om-state-error">{error ?? "Product not found"}</p>
          <p style={{ textAlign: "center" }}>
            <Link to="/shop">← Back to shop</Link>
          </p>
        </main>
        <StoreFooter />
      </div>
    );
  }

  const images = product.images ?? [];
  const mainImage = images[activeImage] ?? images[0] ?? null;

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />

      <main className="om-main">
        <div className="om-shell om-listing-head" style={{ paddingBottom: 0 }}>
          <nav className="om-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span>/</span>
            <Link to="/shop">Shop all</Link>
            <span>/</span>
            <span aria-current="page">{product.title}</span>
          </nav>
        </div>

        <section className="om-shell om-pdp">
          {/* Gallery */}
          <div className="om-gallery">
            <div className="om-gallery-main">
              {mainImage ? <img src={mainImage.url} alt={mainImage.altText ?? product.title} /> : null}
            </div>
            {images.length > 1 ? (
              <div className="om-thumbs">
                {images.map((img, i) => (
                  <button
                    key={img.url + i}
                    type="button"
                    className={`om-thumb ${i === activeImage ? "om-thumb-active" : ""}`}
                    aria-label={`Photo ${i + 1} of ${images.length}`}
                    onClick={() => setActiveImage(i)}
                  >
                    <img src={img.url} alt="" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Info */}
          <div className="om-pdp-info">
            <h1 className="om-pdp-title">{product.title}</h1>
            <div className="om-pdp-price om-serif">{formatMoney(displayAmount, currency)}</div>

            {showVariants ? (
              <fieldset style={{ margin: 0, padding: 0, border: "none" }}>
                <legend className="om-field-label" style={{ padding: 0 }}>Options</legend>
                <div className="om-variants">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={`om-variant ${v.id === selectedVariant?.id ? "om-variant-active" : ""}`}
                      aria-pressed={v.id === selectedVariant?.id}
                      disabled={!v.availableForSale}
                      onClick={() => setSelectedVariantId(v.id)}
                    >
                      {v.title}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div className="om-buy-row">
              <div className="om-qty" role="group" aria-label="Quantity">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQuantity(quantityUi - 1)}
                  disabled={quantityUi <= 1}
                >
                  −
                </button>
                <span className="om-qty-val">{quantityUi}</span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQuantity(quantityUi + 1)}
                  disabled={quantityUi >= maxQtyUi}
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="om-addbtn"
                disabled={!canBuy}
                onClick={() => {
                  addToCart();
                  navigate("/checkout");
                }}
              >
                {canBuy ? "Buy now" : "Sold out"}
              </button>
            </div>

            <div className="om-pdp-meta">
              <div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                {canBuy ? "In stock — ready to ship" : "Currently sold out"}
              </div>
              <div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /></svg>
                Secure, encrypted checkout
              </div>
            </div>

          </div>
        </section>

        {product.description ? (
          <section className="om-shell om-product-story" aria-labelledby="om-product-story-title">
            <h2 id="om-product-story-title">About this product</h2>
            <p>{product.description}</p>
          </section>
        ) : null}

        {/* Related */}
        {related.length > 0 ? (
          <section className="om-shell om-section">
            <div className="om-section-head">
              <h2 className="om-serif">You may also like</h2>
              <Link to="/shop">Shop all</Link>
            </div>
            <div className="om-prod-grid">
              {related.map((p) => (
                <Link key={p.id} to={`/products/${encodeURIComponent(p.handle)}`} className="om-prod">
                  <div className="om-prod-img">
                    {p.images?.[0]?.url ? (
                      <img src={p.images[0].url} alt={p.images[0].altText ?? p.title} />
                    ) : null}
                  </div>
                  <div className="om-prod-body">
                    <span className="om-prod-name">{p.title}</span>
                    <span className="om-prod-price om-serif">
                      {formatMoney(Number(p.price?.min?.amount ?? 0), p.price?.min?.currencyCode ?? "USD")}
                    </span>
                  </div>
                  <span className="om-prod-shop">View product</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <StoreFooter />
    </div>
  );
}
