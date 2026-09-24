import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomSheet from "./BottomSheet";
import Icon from "./Icon";
import Logo from "./Logo";
import { STEPS as INSTALL_STEPS, isIOS } from "./PwaInstallModal";
import { usePwaInstall } from "./PwaInstallContext";
import { useFavorites } from "../hooks";
import { pushPermission, enablePush } from "../push";
import { isOnboardingDone, markOnboardingDone, onboardingSteps } from "../lib/onboarding";

const TITLES = {
  install: "Installez l'app",
  notifications: "Activez les notifications",
  favorites: "Ajoutez vos stations",
};

/**
 * Accueil en 3 étapes au premier lancement (après connexion). Seules les étapes
 * encore utiles sont montrées ; « Passer » ou la dernière étape le clôt pour de bon.
 * Une fois terminé, rien n'est monté (pas de requête favoris supplémentaire).
 */
export default function Onboarding() {
  const [done] = useState(isOnboardingDone);
  return done ? null : <OnboardingFlow />;
}

function OnboardingFlow() {
  const navigate = useNavigate();
  const { isMobile, isInstalled } = usePwaInstall();
  const { favorites, loading } = useFavorites();
  const [steps, setSteps] = useState(null); // figées au premier calcul
  const [index, setIndex] = useState(0);
  const [perm, setPerm] = useState(pushPermission);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (steps || loading || isOnboardingDone()) return;
    const s = onboardingSteps({ isMobile, isInstalled, permission: pushPermission(), favoritesCount: favorites.length });
    if (s.length === 0) markOnboardingDone();
    setSteps(s);
  }, [steps, loading, favorites.length, isMobile, isInstalled]);

  if (!steps?.length || isOnboardingDone()) return null;

  const finish = () => { markOnboardingDone(); setSteps([]); };
  const next = () => (index + 1 < steps.length ? setIndex(index + 1) : finish());
  const step = steps[index];
  const last = index === steps.length - 1;

  const activate = async () => {
    setBusy(true);
    try { setPerm(await enablePush()); } finally { setBusy(false); }
  };
  const browse = () => { finish(); navigate("/stations"); };

  return (
    <BottomSheet open onClose={finish} heightVh={75} labelledBy="onboarding-title">
      <div className="onboarding">
        <div className="onboarding-head">
          <span className="brand-logo"><Logo /></span>
          <span className="onboarding-count">Étape {index + 1} sur {steps.length}</span>
        </div>
        <div id="onboarding-title" className="form-title">{TITLES[step]}</div>

        {step === "install" && (
          <>
            <p className="onboarding-text">Depuis l'écran d'accueil, l'app s'ouvre en un geste et reçoit les notifications de façon fiable{isIOS ? " (obligatoire sur iPhone)" : ""}.</p>
            <ol className="pwa-steps">
              {INSTALL_STEPS[isIOS ? "ios" : "android"].map((t, i) => (
                <li key={i}><span className="pwa-step-num">{i + 1}</span><span>{t}</span></li>
              ))}
            </ol>
          </>
        )}

        {step === "notifications" && (
          <>
            <p className="onboarding-text">Soyez prévenu quand votre station se vide, se remplit, ou quand votre trajet pose problème.</p>
            {perm === "granted" ? (
              <div className="onboarding-ok"><Icon name="check" size={18} /> Notifications activées</div>
            ) : perm === "denied" ? (
              <div className="onboarding-text">Notifications refusées : vous pourrez les autoriser plus tard dans les réglages de l'appareil.</div>
            ) : (
              <button type="button" className="submit-btn" disabled={busy} onClick={activate}>
                {busy ? "…" : "Activer les notifications"}
              </button>
            )}
          </>
        )}

        {step === "favorites" && (
          <>
            <p className="onboarding-text">Ajoutez les stations que vous utilisez (maison, travail…) : elles apparaîtront dans vos favoris et serviront à créer vos alertes.</p>
            <button type="button" className="submit-btn" onClick={browse}>Parcourir les stations</button>
          </>
        )}

        <div className="onboarding-nav">
          <div className="onboarding-dots" aria-hidden="true">
            {steps.map((s, i) => <span key={s} className={i === index ? "on" : ""} />)}
          </div>
          <button type="button" className="cancel-btn" onClick={finish}>Passer</button>
          {!(last && step === "favorites") && (
            <button type="button" className="onboarding-next" onClick={next}>{last ? "Terminer" : "Suivant"}</button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
