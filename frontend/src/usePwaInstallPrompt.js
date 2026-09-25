import { useState } from "react";
import { isMobileDevice } from "./hooks";
import { isOnboardingDone } from "./lib/onboarding";

const KEY = "pwa-modal-dismissed";
const todayStr = () => new Date().toISOString().slice(0, 10);

/** Considère la modale comme ignorée aujourd'hui (réapparaît demain). */
export function markPwaDismissedToday() {
  try { localStorage.setItem(KEY, todayStr()); } catch { /* facultatif */ }
}

/**
 * Pilote l'affichage du modal d'installation PWA.
 * - réservé au mobile : sur desktop, aucun trigger (auto ni manuel) ne l'ouvre,
 *   le flow d'installation PWA est complètement ignoré
 * - auto-ouvert si l'app n'est pas installée ET pas déjà ignorée aujourd'hui
 * - `dismiss()` mémorise le jour (réapparaît le lendemain)
 * - `open()` pour un appel manuel depuis la navigation (mobile uniquement)
 */
export function usePwaInstallPrompt() {
  const isMobile = isMobileDevice();

  const isInstalled =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const dismissedToday = localStorage.getItem(KEY) === todayStr();

  // Pas d'ouverture automatique tant que l'accueil (qui inclut l'installation) est en attente.
  const [isOpen, setIsOpen] = useState(isMobile && !isInstalled && !dismissedToday && isOnboardingDone());

  const dismiss = () => {
    localStorage.setItem(KEY, todayStr());
    setIsOpen(false);
  };

  // Sur desktop, open() est volontairement neutre : la modal ne s'affiche jamais.
  const open = () => { if (isMobile) setIsOpen(true); };

  return { isOpen, dismiss, open, isInstalled, isMobile };
}
