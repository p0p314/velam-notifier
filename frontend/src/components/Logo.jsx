import { useTheme } from "../useTheme";

// Logo principal VéloPulse, adapté au thème actif :
//  - clair  → variante fond clair (plaque blanche, marque bleue)
//  - sombre → variante fond sombre (plaque bleu nuit, marque cyan)
// Remplit son conteneur (dimensions pilotées par .brand-logo / .auth-logo),
// donc dimensions / alignement / responsive inchangés.
export default function Logo({ className = "" }) {
  const { theme } = useTheme();
  const src = theme === "dark" ? "/velopulse-icon-dark.svg" : "/velopulse-icon-light.svg";
  return (
    <img src={src} alt="VéloPulse" className={`app-logo ${className}`.trim()} draggable="false" />
  );
}
