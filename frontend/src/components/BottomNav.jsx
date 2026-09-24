import { NavLink } from "react-router-dom";
import Icon from "./Icon";
import { useOnline } from "../hooks";

const TABS = [
  { to: "/stations", label: "Stations", end: false, icon: "parking" },
  { to: "/carte",    label: "Carte",    end: false, icon: "map-pin", needsNetwork: true },
  { to: "/favoris", label: "Favoris",  end: false, icon: "star" },
  { to: "/alertes", label: "Alertes",  end: false, icon: "bell",    needsNetwork: true },
];

export default function BottomNav() {
  const online = useOnline();
  return (
    <nav className="bottom-nav">
      {TABS.map(({ to, label, end, icon, needsNetwork }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) => "bn-tab" + (isActive ? " active" : "") + (needsNetwork && !online ? " unavailable" : "")}>
          <Icon name={icon} size={22} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
