import { useState } from "react";
import BottomSheet from "./BottomSheet";
import { C } from "../theme";

const isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = /android/i.test(navigator.userAgent);

const STEPS = {
  ios: [
    { icon: "📤", text: "Appuyez sur l'icône Partager dans Safari" },
    { icon: "📲", text: "Sélectionnez « Sur l'écran d'accueil »" },
    { icon: "✅", text: "Ouvrez l'app depuis votre écran d'accueil" },
  ],
  android: [
    { icon: "⋮",  text: "Appuyez sur le menu (3 points) dans Chrome" },
    { icon: "📲", text: "Sélectionnez « Ajouter à l'écran d'accueil »" },
    { icon: "✅", text: "Ouvrez l'app depuis votre écran d'accueil" },
  ],
};
const NOTE = {
  ios:     "Les notifications nécessitent iOS 16.4 ou supérieur",
  android: "Autorisez les notifications au premier lancement",
};

export default function PwaInstallModal({ isOpen, onClose, isInstalled }) {
  // Onglet par défaut : Android si détecté, sinon iOS.
  const [tab, setTab] = useState(isAndroid && !isIOS ? "android" : "ios");

  return (
    <BottomSheet open={isOpen} onClose={onClose} heightVh={78} labelledBy="pwa-title">
      {isInstalled ? (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div id="pwa-title" style={{ fontSize: 17, fontWeight: 800, color: C.text }}>
            L'app est déjà installée
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
            Vous recevrez les notifications normalement.
          </div>
          <button onClick={onClose} style={primaryBtn}>Fermer</button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 26 }}>🚲</span>
            <div id="pwa-title" style={{ fontSize: 17, fontWeight: 800, color: C.text }}>
              Recevoir les notifications Vélam
            </div>
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
            Ajoutez VéloPulse à votre écran d'accueil pour des notifications fiables et un accès rapide.
          </div>

          {/* Sélecteur iOS / Android */}
          <div className="seg" role="tablist" aria-label="Plateforme" style={{ marginBottom: 16 }}>
            <button type="button" role="tab" aria-selected={tab === "ios"}
              className={tab === "ios" ? "active" : ""} onClick={() => setTab("ios")}> iPhone (Safari)</button>
            <button type="button" role="tab" aria-selected={tab === "android"}
              className={tab === "android" ? "active" : ""} onClick={() => setTab("android")}>Android (Chrome)</button>
          </div>

          {/* Étapes numérotées */}
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {STEPS[tab].map((s, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={stepNum}>{i + 1}</span>
                <span style={{ fontSize: 20, width: 26, textAlign: "center" }}>{s.icon}</span>
                <span style={{ fontSize: 14, color: C.text }}>{s.text}</span>
              </li>
            ))}
          </ol>

          <div style={{ fontSize: 12, color: C.muted, marginTop: 14, opacity: 0.9 }}>
            ℹ️ {NOTE[tab]}
          </div>

          <button onClick={onClose} data-autofocus style={primaryBtn}>J'ai compris</button>
          <button onClick={onClose} style={linkBtn}>Me le rappeler demain</button>
        </>
      )}
    </BottomSheet>
  );
}

const primaryBtn = {
  width: "100%", minHeight: 52, marginTop: 20, borderRadius: 12,
  background: "var(--color-primary)", border: "none", color: "#fff",
  fontSize: 16, fontWeight: 700, cursor: "pointer",
};
const linkBtn = {
  width: "100%", marginTop: 10, padding: "8px 0", background: "none", border: "none",
  color: C.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline",
};
const stepNum = {
  flexShrink: 0, width: 24, height: 24, borderRadius: "50%",
  background: "var(--color-primary)", color: "#fff",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  fontSize: 12, fontWeight: 700,
};
