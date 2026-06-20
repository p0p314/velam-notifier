import { NavLink } from "react-router-dom";
import { BikeIcon, StarIcon, BellIcon } from "./icons";

const TABS = [
  { to: "/",        label: "Stations", end: true,  Icon: BikeIcon },
  { to: "/favoris", label: "Favoris",  end: false, Icon: StarIcon },
  { to: "/alertes", label: "Alertes",  end: false, Icon: BellIcon },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {TABS.map(({ to, label, end, Icon }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => "bn-tab" + (isActive ? " active" : "")}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
