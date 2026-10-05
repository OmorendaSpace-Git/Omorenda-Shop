import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useCart } from "../cart/useCart";
import { useAuth } from "../auth/AuthContext";
import { LogoutDialog } from "./LogoutDialog";

function initials(email: string) {
  const name = (email.split("@")[0] ?? "").trim();
  if (!name) return "U";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? name[0] ?? "U";
  const second = parts[1]?.[0] ?? (name.length > 1 ? name[1] : "");
  return (first + second).toUpperCase();
}

const NAV = [
  { label: "Shop all", to: "/shop" },
  { label: "Singing bowls", to: "/bowls" },
  { label: "My purchases", to: "/orders" },
];

type StoreHeaderProps = {
  announce?: string;
};

export function StoreHeader({ announce }: StoreHeaderProps) {
  const cart = useCart();
  const { pathname } = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const label = useMemo(() => initials(user?.email ?? ""), [user?.email]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const el = rootRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  return (
    <>
      {announce ? <div className="om-announce">{announce}</div> : null}
      <header className="om-header">
        <div className="om-shell om-header-inner">
          <Link to="/" className="om-brand" aria-label="Omorenda home">
            <span className="om-brand-name">Omorenda</span>
            <span className="om-brand-tag">Himalayan Botanicals</span>
          </Link>

          <nav className="om-nav" aria-label="Primary">
            {NAV.map((item, i) => (
              <Link key={`${item.label}-${i}`} to={item.to} aria-current={pathname === item.to ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="om-header-actions">
            <Link to="/orders" className="om-mobile-purchases" aria-label="My purchases" aria-current={pathname === "/orders" ? "page" : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 7h14v13H5zM8 7V5a4 4 0 0 1 8 0v2" />
                <path d="M9 12h6M9 16h4" />
              </svg>
              <span>Purchases</span>
            </Link>
            {isAuthenticated ? (
              <div className="om-account-wrap" ref={rootRef}>
                <button
                  type="button"
                  className="om-avatar"
                  aria-label="Account menu"
                  aria-expanded={open}
                  onClick={() => setOpen((v) => !v)}
                >
                  {label}
                </button>
                {open ? (
                  <div className="om-dropdown" role="menu" aria-label="Account">
                    <div className="om-dropdown-email">{user?.email ?? ""}</div>
                    <Link to="/orders" className="om-dropdown-item" role="menuitem" onClick={() => setOpen(false)}>
                      My purchases
                    </Link>
                    <Link to="/account/nfts" className="om-dropdown-item" role="menuitem" onClick={() => setOpen(false)}>
                      NFT certificates
                    </Link>
                    <button
                      type="button"
                      className="om-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        setConfirmLogout(true);
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link to="/login" className="om-iconbtn" aria-label="Sign in">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
                </svg>
              </Link>
            )}

            <Link to="/checkout" className="om-cart" aria-label={`Cart, ${cart.count} items`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 8h14l-1 12H6L5 8z" />
                <path d="M9 8V6a3 3 0 0 1 6 0v2" />
              </svg>
              Cart ({cart.count})
            </Link>
          </div>
        </div>
      </header>
      {confirmLogout ? <LogoutDialog onClose={() => setConfirmLogout(false)} /> : null}
    </>
  );
}
