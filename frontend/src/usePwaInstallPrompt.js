import { useState } from "react";

const KEY = "pwa-modal-dismissed";
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Pilote l'affichage du modal d'installation PWA.
 * - auto-ouvert si l'app n'est pas installée ET pas déjà ignorée aujourd'hui
 * - `dismiss()` mémorise le jour (réapparaît le lendemain)
 * - `open()` pour un appel manuel depuis la navigation
 */
export function usePwaInstallPrompt() {
  const isInstalled =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const dismissedToday = localStorage.getItem(KEY) === todayStr();

  const [isOpen, setIsOpen] = useState(!isInstalled && !dismissedToday);

  const dismiss = () => {
    localStorage.setItem(KEY, todayStr());
    setIsOpen(false);
  };

  const open = () => setIsOpen(true);

  return { isOpen, dismiss, open, isInstalled };
}
