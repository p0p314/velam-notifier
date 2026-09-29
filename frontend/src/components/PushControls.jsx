// Notifications de cet appareil : état partagé par la page Alertes et les Paramètres.
import { useState, useCallback } from "react";
import { api } from "../api";
import { pushStatus, enablePush, disablePush } from "../push";

/**
 * État des notifications de cet appareil + actions (sur clic uniquement).
 * `status` : "unsupported" | "denied" | "default" | "off" | "on" (voir pushStatus).
 */
export function usePushState() {
  const [status, setStatus] = useState(pushStatus);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action) => {
    setBusy(true);
    let override = null;
    try { override = await action(); } finally {
      setStatus(override ?? pushStatus());
      setBusy(false);
    }
  }, []);

  // La réponse à la demande de permission fait foi (certains navigateurs mettent
  // Notification.permission à jour en différé).
  const enable = useCallback(() => run(async () => {
    const permission = await enablePush();
    return permission === "granted" ? null : permission;
  }), [run]);
  const disable = useCallback(() => run(async () => { await disablePush(); return null; }), [run]);
  return { status, busy, enable, disable };
}

/** Envoie une notification de test à tous les appareils du compte. */
export function TestPushButton({ className = "push-banner-btn ghost", onResult }) {
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const { sent } = await api("/api/push/test", { method: "POST" });
      onResult(`Notification envoyée à ${sent} appareil${sent > 1 ? "s" : ""}.`);
    } catch (e) {
      onResult(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={className} disabled={busy} onClick={test}>
      {busy ? "…" : "Tester"}
    </button>
  );
}
