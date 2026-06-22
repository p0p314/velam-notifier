import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useTheme } from "../useTheme";
import { usePwaInstall } from "./PwaInstallContext";
import Icon from "./Icon";

// Top navbar — affichée uniquement en desktop (> 768px) via CSS.
export default function Navbar() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { open: openInstall } = usePwaInstall();
  const navigate = useNavigate();
  const cls = ({ isActive }) => "nav-link" + (isActive ? " active" : "");

  return (
    <header className="top-navbar">
      <div className="brand">
        <span className="brand-logo"><Icon name="bike" size={18} /></span>
        <span className="brand-name">VéloPulse</span>
      </div>
      <nav className="nav-links">
        <NavLink to="/" end className={cls}>Stations</NavLink>
        <NavLink to="/favoris" className={cls}>Favoris</NavLink>
        <NavLink to="/alertes" className={cls}>Alertes</NavLink>
      </nav>
      <div className="nav-right">
        <button className="nav-btn" onClick={openInstall}><Icon name="download" /> Installer</button>
        <button className="icon-btn" aria-label="Changer de thème" onClick={toggle}>
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <span className="nav-user">{user?.username}</span>
        <button className="nav-btn" onClick={() => { logout(); navigate("/login", { replace: true }); }}>
          <Icon name="log-out" /> Déconnexion
        </button>
      </div>
    </header>
  );
}
