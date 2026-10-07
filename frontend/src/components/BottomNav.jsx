import { NavLink } from "react-router-dom";
import Icon from "./Icon";
import { useOnline } from "../hooks";

const TABS = [
  { to: "/trajets", label: "Mes trajets", end: false, icon: "star" },
  { to: "/velos",   label: "Vélos",       end: false, icon: "bike" },
  { to: "/trains",  label: "Trains",      end: false, icon: "train",   needsNetwork: true },
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
