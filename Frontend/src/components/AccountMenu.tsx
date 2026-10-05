import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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

export function AccountMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const label = useMemo(() => initials(user?.email ?? ""), [user?.email]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && !el.contains(target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  return (
    <div
      className="sh-avatarWrap"
      ref={rootRef}
    >
      <button
        type="button"
        className="sh-avatarBtn"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>

      {open ? (
        <div className="sh-dropdown" role="menu" aria-label="Account">
          <div style={{ padding: "6px 10px 10px", fontSize: 12, color: "var(--muted-fg)", fontWeight: 800 }}>
            {user?.email ?? ""}
          </div>
          <Link to="/orders" className="sh-dropdownItem" role="menuitem" onClick={() => setOpen(false)}>
            My purchases
          </Link>
          <Link to="/account/nfts" className="sh-dropdownItem" role="menuitem" onClick={() => setOpen(false)}>
            NFT certificates
          </Link>
          <button
            type="button"
            className="sh-dropdownItem"
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
      {confirmLogout ? <LogoutDialog onClose={() => setConfirmLogout(false)} /> : null}
    </div>
  );
}

