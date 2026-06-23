import { useState } from "react";
import BottomSheet from "./BottomSheet";
import Icon from "./Icon";
import Logo from "./Logo";

const isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = /android/i.test(navigator.userAgent);

const STEPS = {
  ios: [
    "Appuyez sur l'icône Partager dans Safari",
    "Sélectionnez « Sur l'écran d'accueil »",
    "Ouvrez l'app depuis votre écran d'accueil",
  ],
  android: [
    "Appuyez sur le menu (3 points) dans Chrome",
    "Sélectionnez « Ajouter à l'écran d'accueil »",
    "Ouvrez l'app depuis votre écran d'accueil",
  ],
};
const NOTE = {
  ios:     "Les notifications nécessitent iOS 16.4 ou supérieur",
  android: "Autorisez les notifications au premier lancement",
};

export default function PwaInstallModal({ isOpen, onClose, isInstalled }) {
  const [tab, setTab] = useState(isAndroid && !isIOS ? "android" : "ios");

  return (
    <BottomSheet open={isOpen} onClose={onClose} heightVh={80} labelledBy="pwa-title">
      {isInstalled ? (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <span className="pwa-check"><Icon name="check" size={26} /></span>
          <div id="pwa-title" style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", marginTop: 12 }}>
            L'app est déjà installée
          </div>
          <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 6 }}>
            Vous recevrez les notifications normalement.
          </div>
          <button onClick={onClose} className="submit-btn" style={{ marginTop: 20 }}>Fermer</button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}>
            <span className="brand-logo"><Logo /></span>
            <div id="pwa-title" style={{ fontSize: 17, fontWeight: 600, color: "var(--text)" }}>
              Recevoir les notifications
            </div>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>
            Ajoutez VéloPulse à votre écran d'accueil pour des notifications fiables et un accès rapide.
          </div>

          <div className="seg" role="tablist" aria-label="Plateforme" style={{ marginBottom: 18 }}>
            <button type="button" role="tab" aria-selected={tab === "ios"} className={tab === "ios" ? "active" : ""} onClick={() => setTab("ios")}>iPhone (Safari)</button>
            <button type="button" role="tab" aria-selected={tab === "android"} className={tab === "android" ? "active" : ""} onClick={() => setTab("android")}>Android (Chrome)</button>
          </div>

          <ol className="pwa-steps">
            {STEPS[tab].map((text, i) => (
              <li key={i}><span className="pwa-step-num">{i + 1}</span><span>{text}</span></li>
            ))}
          </ol>

          <div className="pwa-note">{NOTE[tab]}</div>

          <button onClick={onClose} data-autofocus className="submit-btn" style={{ marginTop: 20 }}>J'ai compris</button>
          <button onClick={onClose} className="pwa-later">Me le rappeler demain</button>
        </>
      )}
    </BottomSheet>
  );
}
