import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, Outlet, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth, useModules } from "./auth";
import { useIsMobile } from "./hooks";
import { ThemeProvider } from "./useTheme";
import { PwaInstallProvider, usePwaInstall } from "./components/PwaInstallContext";
import { getLandingPref, landingPath } from "./lib/prefs";
import BottomNav from "./components/BottomNav";
import Navbar from "./components/Navbar";
import Icon from "./components/Icon";
import Logo from "./components/Logo";
import Wordmark from "./components/Wordmark";
import Login from "./pages/Login";
import MyTrips from "./pages/MyTrips";
import Bikes from "./pages/Bikes";
import Alerts from "./pages/Alerts";
import Account from "./pages/Account";
import Privacy from "./pages/Privacy";
import { OnlineOnly } from "./components/Offline";
import Onboarding from "./components/Onboarding";
import Tutorial from "./components/Tutorial";
import { tutorialPending, tutorialSlides } from "./lib/tutorial";

// Module Trains, lui aussi chargé à la demande (hors du bundle principal).
const Trains = lazy(() => import("./pages/Trains"));
const TrainJourney = lazy(() => import("./pages/TrainJourney"));
const TrainMapPage = lazy(() => import("./pages/TrainMapPage"));
const trainsFallback = <div className="view-state">Chargement…</div>;

function Protected() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

// Page d'ouverture : choisie dans Paramètres › Préférences ; par défaut, mobile →
// Mes trajets (ce qu'on suit, vélo et train), desktop → Vélos (tableau de bord complet).
function Landing() {
  const isMobile = useIsMobile();
  const modules = useModules();
  return <Navigate to={landingPath(getLandingPref(), isMobile, modules)} replace />;
}

/** Page d'une fonctionnalité désactivée (lien, raccourci, notification) → Mes trajets. */
function RequireModule({ name, children }) {
  const modules = useModules();
  return modules[name] ? children : <Navigate to="/trajets" replace />;
}

/**
 * Première connexion : le tutoriel de présentation d'abord, puis l'accueil pratique
 * (installer, notifications, favoris) — jamais les deux à la fois. Tant que le serveur
 * n'a pas confirmé l'état du tutoriel (utilisateur mémorisé sans le champ), rien.
 */
function FirstRun() {
  const { user, completeTutorial, modules } = useAuth();
  if (tutorialPending(user)) return <Tutorial slides={tutorialSlides(modules)} onClose={completeTutorial} />;
  return user?.tutorial_done ? <Onboarding /> : null;
}

export function Layout() {
  // Déjà installée (lancée depuis l'écran d'accueil) : plus rien à proposer.
  const { open: openInstall, isInstalled } = usePwaInstall();
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      {/* Mobile : header (masqué en desktop via CSS) */}
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo"><Logo /></span>
          <Wordmark className="brand-name" />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!isInstalled && (
            <button className="icon-btn" aria-label="Installer l'app" onClick={openInstall}>
              <Icon name="download" />
            </button>
          )}
          <button className="icon-btn" aria-label="Paramètres" onClick={() => navigate("/compte")}>
            <Icon name="user" />
          </button>
        </div>
      </header>
      {/* Desktop : top navbar (masquée en mobile via CSS) */}
      <Navbar />
      <main className="app-content"><Outlet /></main>
      <BottomNav />
      <FirstRun />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PwaInstallProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Confidentialité / mentions légales — publique. */}
            <Route path="/confidentialite" element={<Privacy />} />
            <Route element={<Protected />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Landing />} />
                <Route path="/trajets" element={<MyTrips />} />
                <Route path="/velos" element={<RequireModule name="bikes"><Bikes /></RequireModule>} />
                {/* Adresses d'avant la v1.7 (favoris enregistrés, raccourcis, notifications). */}
                <Route path="/favoris" element={<Navigate to="/trajets" replace />} />
                <Route path="/stations" element={<Navigate to="/velos?vue=liste" replace />} />
                <Route path="/carte" element={<Navigate to="/velos?vue=carte" replace />} />
                <Route path="/alertes" element={<OnlineOnly><Alerts /></OnlineOnly>} />
                <Route path="/trains" element={<RequireModule name="trains"><OnlineOnly><Suspense fallback={trainsFallback}><Trains /></Suspense></OnlineOnly></RequireModule>} />
                <Route path="/trains/trajet" element={<RequireModule name="trains"><OnlineOnly><Suspense fallback={trainsFallback}><TrainJourney /></Suspense></OnlineOnly></RequireModule>} />
                <Route path="/trains/carte" element={<RequireModule name="trains"><OnlineOnly><Suspense fallback={trainsFallback}><TrainMapPage /></Suspense></OnlineOnly></RequireModule>} />
                <Route path="/compte" element={<OnlineOnly><Account /></OnlineOnly>} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </PwaInstallProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
