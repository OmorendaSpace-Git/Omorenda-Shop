import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";
import { AuthGate } from "../components/AuthGate";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate("/");
  }, [isLoading, isAuthenticated, navigate]);

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />
      <main className="om-main om-login-main">
        <div className="om-shell om-login-content">
          <h1>Sign in</h1>
          <p>Continue with Google to access your account.</p>
          <AuthGate appearance="plain" returnTo="/" />
        </div>
      </main>
      <StoreFooter />
    </div>
  );
}

