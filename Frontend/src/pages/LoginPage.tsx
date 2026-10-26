import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { AuthGate } from "../components/AuthGate";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedReturnTo = (location.state as { returnTo?: unknown } | null)?.returnTo;
  const returnTo = requestedReturnTo === "/checkout" || requestedReturnTo === "/orders" ||
    (typeof requestedReturnTo === "string" && /^\/bowls\/(?:[1-9]|[1-9]\d|10[01])\?resumeCheckout=1$/.test(requestedReturnTo))
    ? requestedReturnTo
    : "/";

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate(returnTo, { replace: true });
  }, [isLoading, isAuthenticated, navigate, returnTo]);

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />
      <main className="om-main om-login-main">
        <div className="om-shell om-login-content">
          <h1>Sign in</h1>
          <p>{returnTo === "/checkout" ? "Continue with Google to finish checkout." : returnTo === "/orders" ? "Continue with Google to view your purchases." : returnTo.startsWith("/bowls/") ? "Continue with Google to purchase this bowl." : "Continue with Google to access your account."}</p>
          <AuthGate appearance="plain" returnTo={returnTo} />
        </div>
      </main>
      <StoreFooter />
    </div>
  );
}

