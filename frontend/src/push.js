// Gestion des push notifications côté navigateur (API native PushManager).
import { api } from "./api";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** État courant de la permission, ou "unsupported" si l'API est absente. */
export function notifPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

/**
 * Demande la permission si besoin, souscrit et envoie la subscription au backend.
 * Ne jamais appeler automatiquement — uniquement sur action explicite de l'utilisateur.
 * Ne déclenche AUCUN dialog si la permission est déjà "granted" ou "denied".
 */
export async function registerPush() {
  if (!pushSupported()) return false;
  if (Notification.permission === "denied") return false;

  try {
    // Demander uniquement si l'état est "default" — jamais re-demander si déjà accordé
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return false;
    }

    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api("/api/push/vapid-public-key", { auth: false });
    if (!publicKey) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await api("/api/push/subscribe", { method: "POST", body: { subscription: sub } });
    return true;
  } catch (err) {
    console.warn("[push] activation échouée :", err.message);
    return false;
  }
}

/**
 * Re-synchronise silencieusement l'abonnement push avec le backend après un
 * re-login. N'affiche AUCUN dialog et ne fait rien si la permission n'est pas
 * "granted" ou si aucun abonnement n'existe dans le navigateur.
 */
export async function syncPushSubscription() {
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return; // abonnement absent → l'utilisateur devra réactiver depuis Alertes
    await api("/api/push/subscribe", { method: "POST", body: { subscription: sub } });
  } catch (err) {
    console.warn("[push] sync échouée :", err.message);
  }
}
