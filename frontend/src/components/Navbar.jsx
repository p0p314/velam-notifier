import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { usePwaInstall } from "./PwaInstallContext";
import Icon from "./Icon";
import Logo from "./Logo";
import Wordmark from "./Wordmark";
import { APP_VERSION } from "../theme";

// Top navbar — affichée uniquement en desktop (> 768px) via CSS.
export default function Navbar() {
  const { user, logout, modules } = useAuth();
  const { open: openInstall, isMobile, isInstalled } = usePwaInstall();
  const navigate = useNavigate();
  const cls = ({ isActive }) => "nav-link" + (isActive ? " active" : "");

  return (
    <header className="top-navbar">
      <div className="brand">
        <span className="brand-logo"><Logo /></span>
        <Wordmark className="brand-name" />
        <span className="app-version">v{APP_VERSION}</span>
      </div>
      <nav className="nav-links">
        <NavLink to="/trajets" className={cls}>Mes trajets</NavLink>
        {modules.bikes && <NavLink to="/velos" className={cls}>Vélos</NavLink>}
        {modules.trains && <NavLink to="/trains" className={cls}>Trains</NavLink>}
        <NavLink to="/alertes" className={cls}>Alertes</NavLink>
      </nav>
      <div className="nav-right">
        {/* Installation PWA : uniquement sur mobile (jamais sur desktop), et pas si déjà installée. */}
        {isMobile && !isInstalled && <button className="nav-btn" onClick={openInstall}><Icon name="download" /> Installer</button>}
        <NavLink to="/compte" className="nav-user" title="Paramètres"><Icon name="user" size={16} /> {user?.username}</NavLink>
        <button className="nav-btn" onClick={async () => { await logout(); navigate("/login", { replace: true }); }}>
          <Icon name="log-out" /> Déconnexion
        </button>
      </div>
    </header>
  );
}
