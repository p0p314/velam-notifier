import { createContext, useContext } from "react";
import { usePwaInstallPrompt } from "../usePwaInstallPrompt";
import PwaInstallModal from "./PwaInstallModal";

const Ctx = createContext(null);

/** Fournit `open()` à toute l'app et rend le modal d'installation PWA. */
export function PwaInstallProvider({ children }) {
  const { isOpen, dismiss, open, isInstalled, isMobile } = usePwaInstallPrompt();
  return (
    <Ctx.Provider value={{ open, isInstalled, isMobile }}>
      {children}
      <PwaInstallModal isOpen={isOpen} onClose={dismiss} isInstalled={isInstalled} />
    </Ctx.Provider>
  );
}

export function usePwaInstall() {
  return useContext(Ctx) ?? { open: () => {}, isInstalled: false, isMobile: false };
}
