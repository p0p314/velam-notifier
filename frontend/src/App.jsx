import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, Outlet, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { useIsMobile } from "./hooks";
import { ThemeProvider, useTheme } from "./useTheme";
import { PwaInstallProvider, usePwaInstall } from "./components/PwaInstallContext";
import BottomNav from "./components/BottomNav";
import Navbar from "./components/Navbar";
import Icon from "./components/Icon";
import Login from "./pages/Login";
import Stations from "./pages/Stations";
import Favorites from "./pages/Favorites";
import Alerts from "./pages/Alerts";
import Redirect from "./pages/Redirect";

// Carte chargée à la demande : mapbox-gl (~1,5 Mo) reste hors du bundle principal.
const MapPage = lazy(() => import("./pages/MapPage"));

function Protected() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

// Landing différenciée : mobile → Favoris (expérience centrée favoris),
// desktop → Stations (tableau de bord complet).
function Landing() {
  const isMobile = useIsMobile();
  return <Navigate to={isMobile ? "/favoris" : "/stations"} replace />;
}

function Layout() {
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { open: openInstall } = usePwaInstall();
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      {/* Mobile : header (masqué en desktop via CSS) */}
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo"><Icon name="bike" size={18} /></span>
          <span className="brand-name">VéloPulse</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="icon-btn" aria-label="Changer de thème" onClick={toggle}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          <button className="icon-btn" aria-label="Installer l'app" onClick={openInstall}>
            <Icon name="download" />
          </button>
          <button className="icon-btn" aria-label="Déconnexion" onClick={() => { logout(); navigate("/login", { replace: true }); }}>
            <Icon name="log-out" />
          </button>
        </div>
      </header>
      {/* Desktop : top navbar (masquée en mobile via CSS) */}
      <Navbar />
      <main className="app-content"><Outlet /></main>
      <BottomNav />
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
            {/* Cible des notifications push — publique, ouvre l'app native puis store/web. */}
            <Route path="/redirect" element={<Redirect />} />
            <Route element={<Protected />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Landing />} />
                <Route path="/stations" element={<Stations />} />
                <Route path="/carte" element={<Suspense fallback={<div className="view-state">Chargement de la carte…</div>}><MapPage /></Suspense>} />
                <Route path="/favoris" element={<Favorites />} />
                <Route path="/alertes" element={<Alerts />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </PwaInstallProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
