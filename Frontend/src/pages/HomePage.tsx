import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { fetchProducts, type StoreProduct } from "../shop/products";

const CATEGORIES = [
  { name: "Cordyceps", img: "/home/cat-cordyceps.jpg", to: "/shop" },
  { name: "Herbal teas", img: "/home/tea.jpg", to: "/shop" },
  { name: "Herbs & fruits", img: "/home/gooseberry.jpg", to: "/shop" },
  { name: "Singing bowls", img: null, to: "/bowls" },
];

function formatPrice(p: StoreProduct) {
  const amount = Number(p.price?.min?.amount ?? 0);
  const currency = p.price?.min?.currencyCode ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function ArrowRight() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function HomePage() {
  const [featured, setFeatured] = useState<StoreProduct[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchProducts(4)
      .then((res) => {
        if (!cancelled) setFeatured(res.products ?? []);
      })
      .catch(() => {
        if (!cancelled) setFeatured([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />

      <main className="om-main">
        {/* Hero */}
        <section className="om-shell om-hero">
          <div className="om-hero-copy">
            <span className="om-eyebrow">From the high Himalayas</span>
            <h1 className="om-serif">Wild-harvested herbs, carried down from the mountains.</h1>
            <p>
              Cordyceps, herbal teas and mountain botanicals — carefully sourced, hygienically
              processed and quality-checked before they reach you.
            </p>
            <div className="om-hero-cta">
              <Link to="/shop" className="om-btn om-btn-primary">Shop Cordyceps</Link>
              <a href="#om-story" className="om-btn om-btn-outline">Our story</a>
            </div>
          </div>
          <div className="om-hero-media">
            <img className="om-hero-img" src="/home/cordyceps.jpg" alt="Dried Cordyceps Sinensis" />
            <div className="om-hero-badge">
              <img src="/home/tea.jpg" alt="" />
              <div>
                <b>Yarchagumba Tea Bags</b>
                <br />
                <span>Everyday herbal infusion</span>
              </div>
            </div>
          </div>
        </section>

        {/* Trust row */}
        <section className="om-shell">
          <div className="om-trust">
            <div className="om-trust-item">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 19l6-10 4 6 2-3 6 7H3z" /></svg>
              <div className="om-trust-text"><b>Sourced at altitude</b><span>Himalayan region</span></div>
            </div>
            <div className="om-trust-item">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" /><path d="M5 19l7-7" /></svg>
              <div className="om-trust-text"><b>Quality-checked</b><span>Hygienically processed</span></div>
            </div>
            <div className="om-trust-item">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="m9 12 2 2 4-4" /></svg>
              <div className="om-trust-text"><b>Secure checkout</b><span>Encrypted payment</span></div>
            </div>
            <div className="om-trust-item">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.5" /><circle cx="17" cy="17.5" r="1.5" /></svg>
              <div className="om-trust-text"><b>Ships worldwide</b><span>Tracked delivery</span></div>
            </div>
          </div>
        </section>

        {/* Categories */}
        <section className="om-shell om-section">
          <div className="om-section-head">
            <h2 className="om-serif">Shop by category</h2>
            <Link to="/shop">View all products</Link>
          </div>
          <div className="om-cat-grid">
            {CATEGORIES.map((c) => (
              <Link key={c.name} to={c.to} className="om-cat">
                {c.img ? (
                  <img src={c.img} alt="" />
                ) : (
                  <div className="om-cat-fallback" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10a8 4 0 0 0 16 0" /><path d="M4 10a8 4 0 0 1 16 0" /><path d="M2 10h20" /><path d="M12 3v3" /></svg>
                  </div>
                )}
                <div className="om-cat-label">
                  <span className="om-serif">{c.name}</span>
                  <ArrowRight />
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Featured products (live from the backend) */}
        {featured.length > 0 ? (
          <section className="om-shell om-section">
            <div className="om-section-head">
              <h2 className="om-serif">Most loved</h2>
              <Link to="/shop">Shop all</Link>
            </div>
            <div className="om-prod-grid">
              {featured.map((p) => (
                <Link key={p.id} to={`/products/${encodeURIComponent(p.handle)}`} className="om-prod">
                  <div className="om-prod-img">
                    {p.images?.[0]?.url ? (
                      <img src={p.images[0].url} alt={p.images[0].altText ?? p.title} />
                    ) : null}
                  </div>
                  <div className="om-prod-body">
                    <span className="om-prod-name">{p.title}</span>
                    <span className="om-prod-price om-serif">{formatPrice(p)}</span>
                  </div>
                  <span className="om-prod-shop">View product <ArrowRight /></span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Story */}
        <section className="om-shell" id="om-story">
          <div className="om-story">
            <img src="/home/story.jpg" alt="Himalayan botanicals growing on a rock face" />
            <div className="om-story-copy">
              <span className="om-eyebrow">Our story</span>
              <h2 className="om-serif">Rooted in centuries of Himalayan tradition.</h2>
              <p>
                Herbs like Cordyceps have been valued in traditional Himalayan and Tibetan practice
                for generations. We work closely with mountain harvesters to bring them to you,
                sourced and processed with care.
              </p>
              <Link to="/shop" className="om-btn om-btn-pale">Explore the shop</Link>
            </div>
          </div>
        </section>
      </main>

      <StoreFooter />
    </div>
  );
}
