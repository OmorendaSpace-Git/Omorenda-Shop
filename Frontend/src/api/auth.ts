import { API_BASE_URL, TOKEN_EXPIRY_KEY, fetchJson, resetTokenExpiry } from "./client";

export type AuthUser = { id: string; email: string; hasSuiWallet: boolean };

const AUTH_USER_KEY = "auth_user";
const AUTH_COOKIE_KEY = "isAuthenticated";

function setAuthCookie(isAuthenticated: boolean) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const basePath = "; Path=/; SameSite=Lax";
  if (isAuthenticated) {
    document.cookie = `${AUTH_COOKIE_KEY}=1${basePath}; Max-Age=${60 * 60}${secure}`;
  } else {
    document.cookie = `${AUTH_COOKIE_KEY}=;${basePath}; Max-Age=0${secure}`;
  }
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (typeof parsed.id !== "string" || typeof parsed.email !== "string") return null;
    return {
      id: parsed.id,
      email: parsed.email,
      hasSuiWallet: parsed.hasSuiWallet === true,
    };
  } catch {
    return null;
  }
}

export function storeUser(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  if (user) {
    window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    setAuthCookie(true);
    resetTokenExpiry();
  } else {
    window.localStorage.removeItem(AUTH_USER_KEY);
    window.localStorage.removeItem(TOKEN_EXPIRY_KEY);
    setAuthCookie(false);
  }
}

export async function me(): Promise<AuthUser | null> {
  const json = await fetchJson<{ user: AuthUser | null }>(`${API_BASE_URL}/auth/me`);
  if (json.user) {
    storeUser(json.user);
    return json.user;
  }
  storeUser(null);
  return null;
}

export async function logout(): Promise<void> {
  await fetchJson(`${API_BASE_URL}/auth/logout`, { method: "POST" });
  storeUser(null);
}

