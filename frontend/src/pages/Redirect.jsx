import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Page de redirection intermédiaire (cible des notifications push).
 *
 * Le Service Worker iOS refuse d'ouvrir un scheme custom (velam://) ; il n'ouvre
 * que des URLs https://. Cette page same-origin reçoit le deep link + les stores
 * en query params et, côté navigateur (qui lui peut ouvrir les apps natives),
 * tente : 1) deep link → 2) store de la plateforme → 3) site web.
 *
 * Route publique (hors auth) et jamais indexée (meta robots noindex).
 */
export default function Redirect() {
  const [params] = useSearchParams();
  const [step, setStep] = useState("trying"); // 'trying' | 'store'

  const deep    = params.get("deep");
  const ios     = params.get("ios");
  const android = params.get("android");
  const web     = params.get("web") || "https://velam.amiens.fr/fr/home";

  // Détection de la plateforme pour choisir le bon store.
  const isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  const storeUrl  = isIOS ? ios : isAndroid ? android : null;

  // Empêche l'indexation par les moteurs de recherche.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  // Étape 1 : tenter le deep link, sinon repli direct sur le web.
  useEffect(() => {
    if (!deep) {
      window.location.href = web;
      return;
    }

    window.location.href = deep;

    // Si l'app n'est pas installée, le deep link échoue silencieusement : après
    // 2s on est toujours là → on propose le store, sinon on bascule sur le web.
    const timer = setTimeout(() => {
      if (storeUrl) setStep("store");
      else window.location.href = web;
    }, 2000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Étape 2 : le deep link a échoué → store, puis repli web après 2s.
  useEffect(() => {
    if (step !== "store" || !storeUrl) return;
    window.location.href = storeUrl;
    const t = setTimeout(() => { window.location.href = web; }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: "16px",
        fontFamily: "sans-serif",
      }}
    >
      <img src="/icon-192.png" alt="VéloPulse" width={64} />
      <p style={{ color: "#6b7280", fontSize: "15px" }}>
        {step === "trying" && "Ouverture de l'application Vélam…"}
        {step === "store" && "Redirection vers le store…"}
      </p>
      <a href={web} style={{ color: "#0066cc", fontSize: "14px" }}>
        Ouvrir le site web
      </a>
    </div>
  );
}
