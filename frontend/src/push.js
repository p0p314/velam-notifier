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

/** État de la permission : "unsupported" | "default" | "granted" | "denied". */
export function pushPermission() {
  return pushSupported() ? Notification.permission : "unsupported";
}

/** Vrai si la subscription existante a été créée avec la clé VAPID courante. */
function sameKey(sub, key) {
  const cur = sub.options?.applicationServerKey;
  if (!cur) return true; // navigateur qui n'expose pas la clé : on ne peut pas comparer
  const a = new Uint8Array(cur);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}

/**
 * Resynchronise silencieusement la subscription avec le backend, SANS jamais
 * afficher la demande de permission (ne fait rien si elle n'est pas accordée).
 * Appelé au démarrage et après login : garantit que l'appareil reste rattaché
 * au compte connecté, et resouscrit si les clés VAPID ont changé côté serveur.
 */
export async function syncPush() {
  if (pushPermission() !== "granted") return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api("/api/push/vapid-public-key", { auth: false });
    if (!publicKey) return false;
    const key = urlBase64ToUint8Array(publicKey);

    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, key)) {
      await sub.unsubscribe(); // ancienne clé → les envois échoueraient en silence
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }

    await api("/api/push/subscribe", { method: "POST", body: { subscription: sub } });
    return true;
  } catch (err) {
    console.warn("[push] synchronisation échouée :", err.message);
    return false;
  }
}

/**
 * Demande explicite de la permission puis souscription. À appeler UNIQUEMENT
 * depuis un geste utilisateur (clic) : iOS l'exige, et cela évite de
 * redemander à chaque connexion. Renvoie l'état final de la permission.
 */
export async function enablePush() {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "granted") await syncPush();
  return permission;
}
