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

/**
 * Demande la permission, souscrit au PushManager et envoie la subscription
 * au backend. Best-effort : ne lève pas (log seulement) pour ne pas bloquer
 * le flux de login.
 */
export async function registerPush() {
  if (!pushSupported()) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

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
