import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { api, getToken, setToken, clearToken, getStoredUser, setStoredUser, AUTH_EXPIRED_EVENT } from "./api";
import { syncPush, unlinkPush } from "./push";
import { modulesOf } from "./lib/modules";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,  setUser]  = useState(() => getStoredUser());
  const [token, setTok]   = useState(() => getToken());
  const userRef = useRef(user);
  userRef.current = user;

  const persist = useCallback((data) => {
    setToken(data.token);
    setStoredUser(data.user);
    setTok(data.token);
    setUser(data.user);
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api("/api/auth/login", { method: "POST", auth: false, body: { username, password } });
    persist(data);
    return data.user;
  }, [persist]);

  const register = useCallback(async (username, password) => {
    const data = await api("/api/auth/register", { method: "POST", auth: false, body: { username, password } });
    persist(data);
    return data.user;
  }, [persist]);

  /** Oublie la session localement (sans appel serveur). */
  const endSession = useCallback(() => {
    clearToken();
    setTok(null);
    setUser(null);
  }, []);

  // Async : détache d'abord l'appareil et ferme sa session côté serveur (tant que le
  // jeton est encore valide) — il disparaît de « Appareils connectés ». Best-effort.
  const logout = useCallback(async () => {
    await unlinkPush();
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    endSession();
  }, [endSession]);

  // Jeton rejeté par le serveur (api() a déjà purgé le stockage) → état déconnecté,
  // <Protected> redirige vers /login au lieu d'afficher des listes vides.
  useEffect(() => {
    const onExpired = () => { setTok(null); setUser(null); };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  // Au démarrage : renouvelle le jeton (session glissante) puis resynchronise
  // silencieusement la subscription push — sans jamais redemander la permission.
  useEffect(() => {
    const sent = getToken();
    if (!sent) return;
    api("/api/auth/me")
      .then((data) => {
        // Déconnexion (ou re-login) pendant la requête : ne pas ressusciter la session.
        if (getToken() !== sent) return;
        persist(data);
        syncPush();
      })
      .catch(() => { /* 401 → géré par AUTH_EXPIRED_EVENT ; réseau → on garde la session */ });
  }, [persist]);

  // renewSession : jeton neuf renvoyé par le serveur (mot de passe changé, autres
  // appareils déconnectés) — l'ancien jeton de cet appareil est révoqué.
  const renewSession = useCallback((data) => { if (data?.token) persist(data); }, [persist]);

  // Tutoriel terminé ou arrêté : plus proposé, ni ici ni sur les autres appareils du
  // compte. Mis à jour localement d'abord ; l'appel serveur est best-effort.
  const completeTutorial = useCallback(() => {
    setUser((u) => {
      if (!u) return u;
      const next = { ...u, tutorial_done: true };
      setStoredUser(next);
      return next;
    });
    api("/api/auth/tutorial", { method: "POST" }).catch(() => {});
  }, []);

  // Fonctionnalités du compte (vélos / trains) : appliquées tout de suite, puis
  // confirmées par le serveur ; en cas d'échec, l'état précédent est rétabli.
  const updateModules = useCallback(async (next) => {
    const previous = userRef.current;
    if (!previous) return;
    const optimistic = { ...previous, modules: { ...modulesOf(previous), ...next } };
    setStoredUser(optimistic);
    setUser(optimistic);
    try {
      const data = await api("/api/auth/modules", { method: "PUT", body: next });
      setStoredUser(data.user);
      setUser(data.user);
    } catch (e) {
      setStoredUser(previous);
      setUser(previous);
      throw e;
    }
  }, []);

  const value = {
    user, token, login, register, logout, endSession, renewSession, completeTutorial, updateModules,
    modules: modulesOf(user), isAuthenticated: !!token,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Fonctionnalités actives du compte : { bikes, trains }. Hors <AuthProvider> (pages
 * publiques, composants isolés) : les deux, comportement par défaut.
 */
export const useModules = () => modulesOf(useContext(AuthContext)?.user);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
