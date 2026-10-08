import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { installZoomControl } from "./lib/zoom";
// Polices auto-hébergées (RGPD : aucune requête vers Google Fonts, et disponibles
// hors ligne via le cache du service worker). Sous-ensemble latin uniquement.
import "@fontsource/geist/latin-400.css";
import "@fontsource/geist/latin-500.css";
import "@fontsource/geist/latin-600.css";
import "@fontsource/geist/latin-700.css";
import "@fontsource/geist/latin-800.css"; // logotype Mox
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "@fontsource/geist-mono/latin-600.css";
import "./styles.css";

// Pas de zoom au pincement ; zoom d'iOS sur un champ annulé en le quittant. La carte
// n'est pas concernée (Mapbox zoome via les touch events).
installZoomControl();

// Enregistrement du Service Worker AVANT le rendu React (pas dans un useEffect).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      console.log("[SW] registered:", reg.scope);
    } catch (err) {
      console.warn("[SW] registration failed:", err.message);
    }
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
