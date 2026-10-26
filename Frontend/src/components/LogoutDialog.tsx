import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

export function LogoutDialog({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") {
        if (event.shiftKey && document.activeElement === cancelRef.current) {
          event.preventDefault();
          confirmRef.current?.focus();
        } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
          event.preventDefault();
          cancelRef.current?.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function confirmLogout() {
    setBusy(true);
    setError(null);
    try {
      await logout();
      onClose();
      navigate("/");
    } catch {
      setError("We couldn’t sign you out. Please try again.");
      setBusy(false);
    }
  }

  return createPortal(
    <div className="om-logout-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="om-logout-dialog" role="alertdialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description">
        <h2 id="logout-title">Sign out?</h2>
        <p id="logout-description">You’ll need to sign in with Google again to access your account.</p>
        {error ? <p className="om-logout-error" role="alert">{error}</p> : null}
        <div className="om-logout-actions">
          <button ref={cancelRef} type="button" className="om-logout-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button ref={confirmRef} type="button" className="om-logout-confirm" onClick={() => void confirmLogout()} disabled={busy}>
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
