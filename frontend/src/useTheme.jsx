import { createContext, useContext, useState, useEffect } from "react";

const KEY = "velopulse-theme";
export const THEME_MODES = [
  { value: "light",  label: "Clair" },
  { value: "dark",   label: "Sombre" },
  { value: "system", label: "Automatique" },
];

const DARK_QUERY = "(prefers-color-scheme: dark)";
const systemTheme = () => (window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light");

/** Mode choisi : "light" | "dark" | "system" (suit le réglage de l'appareil, par défaut). */
function initialMode() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch { /* stockage indisponible */ }
  return "system";
}

const ThemeCtx = createContext(null);

/**
 * Applique data-theme sur <html>, persiste le mode, et partage l'état à toute l'app.
 * En mode automatique, suit en direct le réglage clair/sombre de l'appareil.
 */
export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(initialMode);
  const [system, setSystem] = useState(systemTheme);
  const theme = mode === "system" ? system : mode;

  useEffect(() => {
    if (mode !== "system" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(KEY, mode); } catch { /* facultatif */ }
  }, [mode]);

  // Le thème se choisit uniquement dans Paramètres › Préférences (setMode).
  return <ThemeCtx.Provider value={{ theme, mode, setMode }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx) ?? { theme: "light", mode: "light", setMode: () => {} };
}
