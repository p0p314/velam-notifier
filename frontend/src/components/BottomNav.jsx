import { NavLink } from "react-router-dom";
import Icon from "./Icon";
import { useOnline } from "../hooks";
import { useModules } from "../auth";

const TABS = [
  { to: "/trajets", label: "Mes trajets", end: false, icon: "star" },
  { to: "/velos",   label: "Vélos",       end: false, icon: "bike",    module: "bikes" },
  { to: "/trains",  label: "Trains",      end: false, icon: "train",   needsNetwork: true, module: "trains" },
  { to: "/alertes", label: "Alertes",  end: false, icon: "bell",    needsNetwork: true },
];

export default function BottomNav() {
  const online = useOnline();
  const modules = useModules();
  // Fonctionnalité désactivée (Paramètres › Préférences) : son onglet disparaît.
  const tabs = TABS.filter((t) => !t.module || modules[t.module]);
  return (
    <nav className="bottom-nav">
      {tabs.map(({ to, label, end, icon, needsNetwork }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) => "bn-tab" + (isActive ? " active" : "") + (needsNetwork && !online ? " unavailable" : "")}>
          <Icon name={icon} size={22} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
