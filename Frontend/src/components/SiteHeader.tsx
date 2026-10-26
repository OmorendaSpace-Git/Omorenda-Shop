import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useCart } from "../cart/useCart";
import { useAuth } from "../auth/useAuth";
import { AccountMenu } from "./AccountMenu";
import { Header } from "./Header";

export function SiteHeader({
  pageTitle,
  subtitle,
  left,
}: {
  pageTitle: string;
  subtitle?: string;
  left?: ReactNode;
}) {
  const cart = useCart();
  const { isAuthenticated } = useAuth();

  return (
    <Header
      title={pageTitle}
      titleHref="/"
      logoSrc="/favicon.svg"
      logoAlt="Omorenda"
      subtitle={subtitle}
      left={left}
      right={
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link to="/shop" className="sh-btn sh-menuLink" style={{ textDecoration: "none" }}>
            Shop
          </Link>
          <Link to="/bowls" className="sh-btn sh-menuLink" style={{ textDecoration: "none" }}>
            Bowls
          </Link>
          {!isAuthenticated ? (
            <Link to="/login" className="sh-btn sh-menuLink" style={{ textDecoration: "none" }}>
              <svg className="sh-menuIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20 21a8 8 0 0 0-16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path
                  d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Sign in
            </Link>
          ) : (
            <AccountMenu />
          )}
          <Link to="/checkout" className="sh-btn sh-menuLink" style={{ textDecoration: "none" }}>
            <svg className="sh-menuIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 7h15l-1.5 8.5a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.6L5 3H2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M9.5 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" />
              <path d="M17.5 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" />
            </svg>
            Cart ({cart.count})
          </Link>
        </div>
      }
    />
  );
}

