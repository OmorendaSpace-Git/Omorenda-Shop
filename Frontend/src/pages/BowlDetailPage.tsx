import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { useAuth } from "../auth/AuthContext";
import { GoogleWalletGate } from "../components/GoogleWalletGate";
import { BowlAudioPreview } from "../components/BowlAudioPreview";
import { createBowlCheckoutSession, getBowl, type Bowl } from "../api/bowls";

export function BowlDetailPage() {
  const { serial: serialParam } = useParams<{ serial: string }>();
  const serial = Number(serialParam);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [bowl, setBowl] = useState<Bowl | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [needsGoogle, setNeedsGoogle] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(serial) || serial < 1 || serial > 101) {
      setError("Invalid serial");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const b = await getBowl(serial);
        if (!cancelled) setBowl(b);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load bowl");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serial]);

  async function buyNow() {
    if (!bowl) return;
    if (!isAuthenticated) {
      navigate("/login", { state: { returnTo: `/bowls/${bowl.serialNumber}?resumeCheckout=1` } });
      return;
    }
    if (!user?.hasSuiWallet) {
      setNeedsGoogle(true);
      return;
    }
    setBuying(true);
    setError(null);
    try {
      const res = await createBowlCheckoutSession({
        serial: bowl.serialNumber,
        successUrl: `${window.location.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${window.location.origin}/bowls/${bowl.serialNumber}`,
      });
      if (!res.url) throw new Error("Missing Stripe Checkout url");
      window.location.href = res.url;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to start checkout";
      if (message.includes("GOOGLE_SIGNIN_REQUIRED")) {
        // A legacy session may not have a wallet yet; the certificate wallet
        // is derived when that account is linked through Google.
        setNeedsGoogle(true);
        setBuying(false);
        return;
      }
      if (message.includes("already sold")) {
        try {
          setBowl(await getBowl(serial));
        } catch {
          // keep the stale bowl; the error text below covers it
        }
        setError("This bowl has just been sold to another buyer.");
        setBuying(false);
        return;
      }
      setError(message);
      setBuying(false);
    }
  }

  useEffect(() => {
    if (
      searchParams.get("resumeCheckout") === "1" &&
      !authLoading &&
      !loading &&
      isAuthenticated &&
      user?.hasSuiWallet &&
      bowl &&
      !buying
    ) {
      setSearchParams({}, { replace: true });
      // Resume the user-requested checkout after the Google callback reloads this page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void buyNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, authLoading, loading, isAuthenticated, user?.hasSuiWallet, bowl, buying]);

  const sold = bowl?.status === "SOLD";

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />

      <main className="om-main">
        <div className="om-shell om-listing-head" style={{ paddingBottom: 0 }}>
          <nav className="om-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span>/</span>
            <Link to="/bowls">Singing bowls</Link>
            <span>/</span>
            <span aria-current="page">{bowl ? bowl.name : "Singing bowl"}</span>
          </nav>
        </div>

        {!authLoading && isAuthenticated && (needsGoogle || searchParams.get("resumeCheckout") === "1") && !user?.hasSuiWallet ? (
          <div className="om-shell om-block">
            <div style={{ marginBottom: 16, maxWidth: 460 }}>
              <GoogleWalletGate returnTo={`/bowls/${serial}?resumeCheckout=1`} />
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="om-state">Loading…</p>
        ) : error ? (
          <p className="om-shell om-error">{error}</p>
        ) : !bowl ? (
          <p className="om-state">Bowl not found.</p>
        ) : (
          <section className="om-shell om-pdp">
            <div className="om-gallery">
              <div className="om-gallery-main">
                {bowl.imageUrl ? <img src={bowl.imageUrl} alt={bowl.name} /> : null}
              </div>
            </div>

            <div className="om-pdp-info">
              <span className={`om-lcard-badge ${sold ? "om-badge-out" : "om-badge-in"}`} style={{ position: "static", alignSelf: "flex-start" }}>
                {sold ? "Sold" : `#${bowl.serialNumber} of 101`}
              </span>
              <h1 className="om-pdp-title">{bowl.name}</h1>
              {bowl.description ? <p className="om-pdp-desc">{bowl.description}</p> : null}
              <div className="om-pdp-price om-serif">{`$${Number(bowl.price).toFixed(2)} ${bowl.currency}`}</div>

              <BowlAudioPreview audioUrl={bowl.audioUrl} bowlName={bowl.name} />

              <dl className="om-spec">
                <div><dt>Serial</dt><dd>#{bowl.serialNumber} of 101</dd></div>
                <div><dt>Weight</dt><dd>{bowl.weightGrams} g</dd></div>
                <div><dt>Height</dt><dd>{bowl.heightMm} mm</dd></div>
                <div><dt>Width</dt><dd>{bowl.widthMm} mm</dd></div>
                <div><dt>Note</dt><dd>{bowl.note}</dd></div>
                <div><dt>Frequency</dt><dd>{bowl.frequency} Hz</dd></div>
              </dl>

              <p className="om-note">
                Each purchase comes with a digital certificate of authenticity recorded on the Sui
                network. You don't need a crypto wallet — we handle that automatically.
              </p>

              <button
                type="button"
                onClick={() => void buyNow()}
                disabled={sold || buying || authLoading}
                className="om-addbtn"
              >
                {sold ? "Already sold" : buying ? "Redirecting to checkout…" : authLoading ? "Checking account…" : "Buy now"}
              </button>

              {sold && bowl.nftObjectId ? (
                <a
                  href={`https://suiscan.xyz/testnet/object/${bowl.nftObjectId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="om-buybtn"
                  style={{ textDecoration: "none", display: "flex" }}
                >
                  View NFT on Sui Explorer →
                </a>
              ) : null}

              {!isAuthenticated ? (
                <p className="om-note">You'll be asked to sign in or create an account before payment.</p>
              ) : null}

              <Link to="/bowls" className="om-continue">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></svg>
                Back to all bowls
              </Link>
            </div>
          </section>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}
