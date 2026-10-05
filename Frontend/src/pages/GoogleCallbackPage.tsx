import { useEffect, useRef, useState } from "react";
import { completeGoogleZkLogin, readPending } from "../api/zklogin";
import { StoreHeader } from "../components/StoreHeader";
import { StoreFooter } from "../components/StoreFooter";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done" };

function parseHashIdToken(): string | null {
  const hash = window.location.hash || "";
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  const token = params.get("id_token");
  return token && token.length > 0 ? token : null;
}

export function GoogleCallbackPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const idToken = parseHashIdToken();
    if (!idToken) {
      setState({
        kind: "error",
        message: "Google sign-in did not return an id_token.",
      });
      return;
    }

    (async () => {
      try {
        const pending = readPending();
        await completeGoogleZkLogin(idToken);
        setState({ kind: "done" });
        // Hard navigation so the AuthContext re-initializes with the
        // freshly stored user.
        const returnTo = pending?.returnTo || "/";
        window.location.replace(returnTo);
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Google sign-in failed",
        });
      }
    })();
  }, []);

  return (
    <div className="om-page">
      <StoreHeader announce="Wild-harvested Himalayan botanicals — shipped worldwide." />
      <main className="om-main om-login-main">
        <div className="om-shell om-login-content" role="status" aria-live="polite">
          <h1>Sign in</h1>
          {state.kind === "error" ? (
            <>
              <p>We couldn’t complete your sign-in.</p>
              <p className="om-login-error">{state.message}</p>
              <a href="/login" className="sh-btn sh-btnPrimary om-login-retry">Try again</a>
            </>
          ) : (
            <>
              <p>Continue with Google to access your account.</p>
              <div className="om-login-progress">
                <span className="om-login-spinner" aria-hidden="true" />
                {state.kind === "done" ? "Signed in. Redirecting…" : "Signing you in…"}
              </div>
            </>
          )}
        </div>
      </main>
      <StoreFooter />
    </div>
  );
}
