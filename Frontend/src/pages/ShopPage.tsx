import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { useCart } from "../cart/useCart";
import { fetchProducts, getFirstAvailableVariant, type StoreProduct } from "../shop/products";

function formatPrice(p: StoreProduct) {
  const amount = Number(p.price?.min?.amount ?? 0);
  const currency = p.price?.min?.currencyCode ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

const PRODUCTS_PER_PAGE = 15;

export function ShopPage() {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const pageParam = Number(searchParams.get("page") ?? "1");
  const pageIdx = Number.isFinite(pageParam) ? Math.max(0, Math.trunc(pageParam) - 1) : 0;

  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>(() => {
    try {
      const raw = sessionStorage.getItem("shop_page_cursors_v1");
      const parsed = raw ? (JSON.parse(raw) as Array<string | undefined>) : null;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // ignore
    }
    return [undefined];
  });
  const [hasNextPage, setHasNextPage] = useState(false);
  const [endCursor, setEndCursor] = useState<string | null>(null);

  const navigate = useNavigate();
  const cart = useCart();

  useEffect(() => {
    try {
      sessionStorage.setItem("shop_page_cursors_v1", JSON.stringify(pageCursors));
    } catch {
      // ignore
    }
  }, [pageCursors]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);

        if (pageIdx > 0 && !pageCursors[pageIdx]) {
          const cursors = [...pageCursors];
          let cursor: string | undefined = cursors[0];
          let lastEndCursor: string | null = null;
          for (let i = 0; i < pageIdx; i++) {
            const json = await fetchProducts(PRODUCTS_PER_PAGE, cursor);
            lastEndCursor = json.endCursor ?? null;
            cursor = lastEndCursor ?? undefined;
            if (!cursors[i + 1]) cursors[i + 1] = cursor;
          }
          if (!cancelled) setPageCursors(cursors);
        }

        const cursor = pageCursors[pageIdx];
        const json = await fetchProducts(PRODUCTS_PER_PAGE, cursor);
        if (!cancelled) {
          setProducts(json.products ?? []);
          setHasNextPage(!!json.hasNextPage);
          setEndCursor(json.endCursor ?? null);
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
  }, [pageIdx, pageCursors]);

  const canPrev = pageIdx > 0;
  const canNext = products.length === PRODUCTS_PER_PAGE && !!hasNextPage && !!endCursor;

  function goToPage(nextIdx: number) {
    const page = nextIdx + 1;
    if (page <= 1) setSearchParams({});
    else setSearchParams({ page: String(page) });
  }

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />

      <main className="om-main">
        <div className="om-shell om-listing-head">
          <nav className="om-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span>/</span>
            <span aria-current="page">Shop all</span>
          </nav>
          <h1>Shop all</h1>
          <p>Himalayan herbs, teas and singing bowls, carefully sourced and quality-checked.</p>
        </div>

        <div className="om-shell om-listing-body">
          {loading ? (
            <p className="om-state">Loading products…</p>
          ) : error ? (
            <p className="om-state om-state-error">{error}</p>
          ) : products.length === 0 ? (
            <p className="om-state">No products found.</p>
          ) : (
            <>
              <div className="om-lgrid">
                {products.map((p) => {
                  const purchasable = p.availableForSale ? getFirstAvailableVariant(p) : null;
                  const soldOut = !p.availableForSale || !purchasable;
                  const variantId = purchasable?.id ?? null;
                  const inCart = variantId ? cart.ids.has(variantId) : false;
                  const href = `/products/${encodeURIComponent(p.handle)}`;
                  return (
                    <article key={p.id} className="om-lcard">
                      <Link to={href} className="om-lcard-media">
                        {p.images?.[0]?.url ? (
                          <img src={p.images[0].url} alt={p.images[0].altText ?? p.title} />
                        ) : (
                          <span className="om-lcard-noimg">No image</span>
                        )}
                        <span className={`om-lcard-badge ${soldOut ? "om-badge-out" : "om-badge-in"}`}>
                          {soldOut ? "Sold out" : "In stock"}
                        </span>
                      </Link>

                      <div className="om-lcard-body">
                        <Link to={href} className="om-lcard-name">{p.title}</Link>
                        <span className="om-lcard-price om-serif">{formatPrice(p)}</span>
                      </div>

                      <div className="om-lcard-actions">
                        <button
                          type="button"
                          className={`om-cardbtn ${inCart ? "om-cardbtn-active" : ""}`}
                          disabled={soldOut || !variantId}
                          onClick={() => {
                            if (!purchasable?.id) return;
                            cart.toggle({
                              productId: p.id,
                              productHandle: p.handle,
                              title: p.title,
                              imageUrl: p.images?.[0]?.url ?? null,
                              currency: p.price?.min?.currencyCode ?? "USD",
                              unitAmount: Number(p.price?.min?.amount ?? 0),
                              variantGid: purchasable.id,
                              variantTitle: purchasable.title,
                              availableForSale: purchasable.availableForSale,
                              quantityAvailable: typeof purchasable.quantityAvailable === "number" ? purchasable.quantityAvailable : null,
                            });
                          }}
                        >
                          {inCart ? "Remove" : "Add to cart"}
                        </button>
                        <button
                          type="button"
                          className="om-cardbtn om-cardbtn-primary"
                          disabled={soldOut}
                          onClick={() => {
                            if (!purchasable?.id) return;
                            cart.add(
                              {
                                productId: p.id,
                                productHandle: p.handle,
                                title: p.title,
                                imageUrl: p.images?.[0]?.url ?? null,
                                currency: p.price?.min?.currencyCode ?? "USD",
                                unitAmount: Number(p.price?.min?.amount ?? 0),
                                variantGid: purchasable.id,
                                variantTitle: purchasable.title,
                                availableForSale: purchasable.availableForSale,
                                quantityAvailable: typeof purchasable.quantityAvailable === "number" ? purchasable.quantityAvailable : null,
                              },
                              1,
                            );
                            navigate("/checkout");
                          }}
                        >
                          Buy now
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {canPrev || canNext ? (
                <div className="om-pagination">
                  <button
                    type="button"
                    className="om-pagebtn"
                    disabled={!canPrev}
                    onClick={() => goToPage(Math.max(0, pageIdx - 1))}
                  >
                    ← Previous
                  </button>
                  <button
                    type="button"
                    className="om-pagebtn"
                    disabled={!canNext}
                    onClick={() => {
                      if (!endCursor) return;
                      setPageCursors((arr) => {
                        const next = [...arr];
                        if (!next[pageIdx + 1]) next[pageIdx + 1] = endCursor;
                        return next;
                      });
                      goToPage(pageIdx + 1);
                    }}
                  >
                    Next →
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>

      <StoreFooter />
    </div>
  );
}

