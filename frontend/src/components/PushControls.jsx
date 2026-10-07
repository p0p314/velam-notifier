// Notifications de cet appareil : état partagé par la page Alertes et les Paramètres.
import { useState, useCallback, useEffect } from "react";
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

/**
 * Types d'alertes notifiés pour le compte (tous ses appareils) : { bikes, trains }.
 * `toggle(kind)` bascule l'un des deux (affichage immédiat, confirmé par le serveur).
 */
export function useNotificationPrefs() {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    api("/api/notifications/preferences")
      .then((d) => { if (alive) setPrefs(d.preferences); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);
  const toggle = useCallback(async (kind) => {
    if (!prefs) return;
    const next = !prefs[kind];
    setPrefs((p) => ({ ...p, [kind]: next }));
    setError(null);
    try {
      setPrefs((await api("/api/notifications/preferences", { method: "PUT", body: { [kind]: next } })).preferences);
    } catch (e) {
      setPrefs((p) => ({ ...p, [kind]: !next }));
      setError(e.message);
    }
  }, [prefs]);
  return { prefs, toggle, error };
}
