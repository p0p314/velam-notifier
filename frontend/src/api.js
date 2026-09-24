// Client API centralisé : injecte le JWT et normalise les erreurs.

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const TOKEN_KEY = "velam_token";
const USER_KEY  = "velam_user";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); };

export const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
};
export const setStoredUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u));

// Événement émis quand le serveur rejette le jeton (expiré / invalide) :
// AuthProvider l'écoute pour déconnecter proprement et renvoyer vers /login,
// au lieu de laisser l'utilisateur sur des pages vides (favoris, alertes…).
export const AUTH_EXPIRED_EVENT = "auth:expired";

// Render (offre gratuite) met le service en veille : le premier appel après un
// réveil peut échouer (réseau / 502-504) le temps que le serveur redémarre.
const RETRY_DELAYS = [1500, 4000];
const RETRYABLE = new Set([502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Appel API. Ajoute le Bearer token par défaut. Lève une Error si la réponse
 * n'est pas ok (HTTP ou enveloppe { ok:false }). Les GET sont rejoués sur erreur
 * réseau / 502-504 (réveil du serveur) ; un 401 authentifié déconnecte.
 */
export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  const sendsToken = auth && !!token;
  if (sendsToken) headers["Authorization"] = `Bearer ${token}`;

  const retries = method === "GET" ? RETRY_DELAYS : [];
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(BASE + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (!RETRYABLE.has(res.status) || attempt >= retries.length) break;
    } catch (err) {
      if (attempt >= retries.length) throw new Error("Serveur injoignable, vérifiez votre connexion");
    }
    await sleep(retries[attempt]);
  }

  let data = {};
  try { data = await res.json(); } catch { /* réponse sans corps */ }

  if (res.status === 401 && sendsToken) {
    // Jeton refusé : ne purger que s'il n'a pas été remplacé entre-temps (re-login).
    if (getToken() === token) {
      clearToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
  }

  if (!res.ok || data.ok === false) {
    const err = new Error(data.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
