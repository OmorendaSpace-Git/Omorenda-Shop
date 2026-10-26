import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import * as authApi from "../api/auth";
import { AUTH_SESSION_EXPIRED_EVENT } from "../api/client";
import { clearPending } from "../api/zklogin";
import { AuthContext, type AuthContextValue } from "./useAuth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<authApi.AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await authApi.me();
        if (!cancelled) setUser(u);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      authApi.storeUser(null);
      setUser(null);
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    clearPending();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      logout,
    }),
    [user, isLoading, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

