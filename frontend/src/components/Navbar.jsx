import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { usePwaInstall } from "./PwaInstallContext";

// Top navbar — affichée uniquement en desktop (> 768px) via CSS.
export default function Navbar() {
  const { user, logout } = useAuth();
  const { open: openInstall } = usePwaInstall();
  const navigate = useNavigate();
  const cls = ({ isActive }) => "nav-link" + (isActive ? " active" : "");

  return (
    <header className="top-navbar">
      <span className="nav-title">VéloPulse</span>
      <nav className="nav-links">
        <NavLink to="/" end className={cls}>Stations</NavLink>
        <NavLink to="/favoris" className={cls}>Favoris</NavLink>
        <NavLink to="/alertes" className={cls}>Alertes</NavLink>
      </nav>
      <div className="nav-right">
        <button className="nav-logout" onClick={openInstall}>📲 Installer l'app</button>
        <span className="nav-user">{user?.username}</span>
        <button className="nav-logout" onClick={() => { logout(); navigate("/login", { replace: true }); }}>
          Déconnexion
        </button>
      </div>
    </header>
  );
}
