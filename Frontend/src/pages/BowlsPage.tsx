import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { listBowls, type Bowl } from "../api/bowls";

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function BowlsPage() {
  const [bowls, setBowls] = useState<Bowl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await listBowls();
        if (!cancelled) setBowls(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load bowls");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />

      <main className="om-main">
        <div className="om-shell om-listing-head">
          <nav className="om-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span>/</span>
            <span aria-current="page">Singing bowls</span>
          </nav>
          <h1>Singing bowls</h1>
          <p>101 hand-hammered bowls. Each purchase comes with a digital certificate of authenticity.</p>
        </div>

        <div className="om-shell om-listing-body">
          {loading ? (
            <p className="om-state">Loading bowls…</p>
          ) : error ? (
            <p className="om-state om-state-error">{error}</p>
          ) : bowls.length === 0 ? (
            <p className="om-state">No bowls listed yet.</p>
          ) : (
            <div className="om-lgrid">
              {bowls.map((b) => {
                const sold = b.status === "SOLD";
                return (
                  <article key={b.id} className="om-lcard">
                    <button
                      type="button"
                      className="om-lcard-media om-lcard-media-wrap"
                      onClick={() => navigate(`/bowls/${b.serialNumber}`)}
                      style={{ border: "none", padding: 0, cursor: "pointer" }}
                      aria-label={`View ${b.name}`}
                    >
                      {b.imageUrl ? <img src={b.imageUrl} alt={b.name} /> : <span className="om-lcard-noimg">No image</span>}
                      <span className={`om-lcard-badge ${sold ? "om-badge-out" : "om-badge-in"}`}>
                        {sold ? "Sold" : `#${b.serialNumber} of 101`}
                      </span>
                      {sold ? <span className="om-lcard-sold">SOLD</span> : null}
                    </button>

                    <div className="om-lcard-body">
                      <Link to={`/bowls/${b.serialNumber}`} className="om-lcard-name">{b.name}</Link>
                      <span className="om-lcard-sub">{b.note} · {b.frequency} Hz</span>
                      <span className="om-lcard-price om-serif">{formatMoney(Number(b.price), b.currency)}</span>
                    </div>

                    <div className="om-lcard-actions">
                      <button
                        type="button"
                        className="om-cardbtn om-cardbtn-primary"
                        onClick={() => navigate(`/bowls/${b.serialNumber}`)}
                      >
                        {sold ? "View certificate" : "View bowl"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <StoreFooter />
    </div>
  );
}
