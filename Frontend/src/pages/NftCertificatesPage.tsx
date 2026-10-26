import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { useAuth } from "../auth/useAuth";
import { listMyNfts, type NftCertificate } from "../api/bowls";

function NftShell({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />
      <main className="om-main">
        <div className="om-shell om-pagehead">
          <h1>NFT certificates</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="om-shell om-block">{children}</div>
      </main>
      <StoreFooter />
    </div>
  );
}

const STATUS_COPY: Record<NftCertificate["status"], string> = {
  PENDING: "Preparing your certificate…",
  MINTING: "Creating your certificate…",
  MINTED: "Ready",
  FAILED: "Needs review — please contact support",
};

function CertificateCard({ certificate: n, initiallyExpanded }: { certificate: NftCertificate; initiallyExpanded: boolean }) {
  const bowl = n.bowl;
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const panelId = `certificate-details-${n.id}`;
  return (
    <article id={`certificate-${n.id}`} className="om-certificate sh-card">
      <button
        type="button"
        className="om-certificate-summary"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="om-certificate-image">
          {bowl?.imageUrl ? <img src={bowl.imageUrl} alt="" /> : <span aria-hidden="true">Omorenda</span>}
        </span>
        <span className="om-certificate-heading">
          <strong>{bowl?.name ?? "NFT certificate"}</strong>
          <span>{bowl ? `Bowl #${bowl.serialNumber} of 101` : "Bowl certificate"}</span>
          {n.order ? (
            <small>Purchased {new Date(n.order.createdAt).toLocaleDateString()} · {Number(n.order.total).toFixed(2)} {n.order.currency}</small>
          ) : null}
        </span>
        <span className="om-certificate-status" data-status={n.status}>
          {STATUS_COPY[n.status]}
        </span>
        <svg className="om-certificate-chevron" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
      </button>
      <div id={panelId} className={`om-certificate-panel${expanded ? " is-open" : ""}`} aria-hidden={!expanded} inert={!expanded}>
        <div className="om-certificate-panel-inner">
          <div className="om-certificate-body">
            <div className="om-certificate-body-head">
              <h2>Bowl details</h2>
              {n.status === "MINTED" && n.suiObjectId ? (
                <a
                  href={`https://suiscan.xyz/testnet/object/${n.suiObjectId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="om-certificate-explorer"
                >
                  View on Sui Explorer <span aria-hidden="true">↗</span>
                </a>
              ) : null}
            </div>
            {bowl ? (
              <dl className="om-certificate-specs">
                <div><dt>Serial number</dt><dd>#{bowl.serialNumber} of 101</dd></div>
                <div><dt>Weight</dt><dd>{bowl.weightGrams} g</dd></div>
                <div><dt>Height</dt><dd>{bowl.heightMm} mm</dd></div>
                <div><dt>Width</dt><dd>{bowl.widthMm} mm</dd></div>
                <div><dt>Musical note</dt><dd>{bowl.note}</dd></div>
                <div><dt>Frequency</dt><dd>{bowl.frequency} Hz</dd></div>
              </dl>
            ) : (
              <p className="om-certificate-note">Bowl details are unavailable for this purchase.</p>
            )}
            {bowl ? <p className="om-certificate-note">Bowl details recorded at purchase.</p> : null}
            {n.status !== "MINTED" || !n.suiObjectId ? (
              <p className="om-certificate-mint-note">
                {n.status === "FAILED"
                  ? "Your purchase details are available here, but the NFT has not been issued. Please contact support."
                  : n.status === "MINTED"
                    ? "Your NFT is ready, but its explorer link is unavailable. Please contact support."
                    : "Your purchase details are available here while the NFT is being created."}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function NftCertificatesPage() {
  const location = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [nfts, setNfts] = useState<NftCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const scrolledToHash = useRef("");

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load(initial = false) {
      try {
        if (initial) setLoading(true);
        const list = await listMyNfts();
        if (cancelled) return;
        setNfts(list);
        setError(null);
        setRefreshError(false);
        if (list.some((nft) => nft.status === "PENDING" || nft.status === "MINTING")) {
          timer = setTimeout(() => void load(), 5000);
        }
      } catch (e) {
        if (cancelled) return;
        if (initial) setError(e instanceof Error ? e.message : "Failed to load");
        else setRefreshError(true);
        timer = setTimeout(() => void load(initial), 5000);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load(true);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!location.hash) scrolledToHash.current = "";
    if (!loading && location.hash.startsWith("#certificate-") && scrolledToHash.current !== location.hash) {
      const card = document.getElementById(location.hash.slice(1));
      if (card) {
        card.scrollIntoView({ block: "center" });
        scrolledToHash.current = location.hash;
      }
    }
  }, [loading, location.hash, nfts]);

  if (authLoading) {
    return (
      <NftShell>
        <p className="om-state">Loading…</p>
      </NftShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <NftShell>
        <div className="sh-card" style={{ padding: 16 }}>
          <p style={{ margin: 0 }}>
            Please <Link to="/login">sign in</Link> to view your digital certificates.
          </p>
        </div>
      </NftShell>
    );
  }

  return (
    <NftShell subtitle="Digital certificates of authenticity for the bowls you own.">
      {refreshError ? <p role="status" className="om-error">Couldn't refresh certificate status. Retrying…</p> : null}
      {loading ? (
        <p className="om-state">Loading…</p>
      ) : error ? (
        <p className="om-error">{error}</p>
      ) : nfts.length === 0 ? (
        <div className="sh-card" style={{ padding: 16 }}>
          <p style={{ margin: 0 }}>
            You don't have any certificates yet. <Link to="/bowls">Browse bowls →</Link>
          </p>
        </div>
      ) : (
        <div className="om-certificate-list">
          {nfts.map((n) => <CertificateCard key={`${n.id}:${location.hash === `#certificate-${n.id}`}`} certificate={n} initiallyExpanded={location.hash === `#certificate-${n.id}`} />)}
        </div>
      )}
    </NftShell>
  );
}
