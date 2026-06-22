import { Routes, Route, Navigate, Outlet, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { PwaInstallProvider, usePwaInstall } from "./components/PwaInstallContext";
import BottomNav from "./components/BottomNav";
import Navbar from "./components/Navbar";
import Login from "./pages/Login";
import Stations from "./pages/Stations";
import Favorites from "./pages/Favorites";
import Alerts from "./pages/Alerts";

function Protected() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

function Layout() {
  const { logout } = useAuth();
  const { open: openInstall } = usePwaInstall();
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      {/* Mobile : header simple (masqué en desktop via CSS) */}
      <header className="app-header">
        <span className="app-title">VéloPulse</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="icon-btn" aria-label="Installer l'app" title="Installer l'app" onClick={openInstall}>
            📲
          </button>
          <button
            className="icon-btn"
            aria-label="Déconnexion"
            onClick={() => { logout(); navigate("/login", { replace: true }); }}
          >
            ⎋
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
    <AuthProvider>
      <PwaInstallProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Stations />} />
              <Route path="/favoris" element={<Favorites />} />
              <Route path="/alertes" element={<Alerts />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PwaInstallProvider>
    </AuthProvider>
  );
}
