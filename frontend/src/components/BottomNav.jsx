import { NavLink } from "react-router-dom";
import Icon from "./Icon";

const TABS = [
  { to: "/",        label: "Stations", end: true,  icon: "map-pin" },
  { to: "/favoris", label: "Favoris",  end: false, icon: "star" },
  { to: "/alertes", label: "Alertes",  end: false, icon: "bell" },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {TABS.map(({ to, label, end, icon }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => "bn-tab" + (isActive ? " active" : "")}>
          <Icon name={icon} size={22} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
