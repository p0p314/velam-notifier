import { useTheme } from "../useTheme";

// Icône Mox, adaptée au thème actif :
//  - clair  → plaque blanche, cadran bleu, point orange ;
//  - sombre → plaque nuit, cadran bleu clair, point orange clair.
// Remplit son conteneur (dimensions pilotées par .brand-logo / .auth-logo).
// Sources : public/mox-icon-*.svg (icône de l'app installée : public/mox-icon.svg, fond bleu).
export default function Logo({ className = "" }) {
  const { theme } = useTheme();
  const src = theme === "dark" ? "/mox-icon-dark.svg" : "/mox-icon-light.svg";
  return (
    <img src={src} alt="Mox" className={`app-logo ${className}`.trim()} draggable="false" />
  );
}
