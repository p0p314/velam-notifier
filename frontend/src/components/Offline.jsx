import { NavLink } from "react-router-dom";
import Icon from "./Icon";
import { useOnline } from "../hooks";
import { fmtUpdatedAt } from "../lib/offlineCache";

/**
 * Bandeau affiché quand les données viennent du cache (hors ligne ou serveur
 * injoignable) : précise l'heure de la dernière mise à jour réussie.
 */
export function OfflineBanner({ stale, lastUpd }) {
  const online = useOnline();
  if (online && !stale) return null;
  const when = fmtUpdatedAt(lastUpd);
  return (
    <div className="offline-banner" role="status">
      <Icon name="wifi-off" size={16} />
      <span>
        {online ? "Serveur injoignable" : "Hors ligne"}
        {" — "}
        {when ? `données de ${when}` : "aucune donnée enregistrée"}
      </span>
    </div>
  );
}

/** Garde de route : hors ligne, seules les stations et les favoris restent accessibles. */
export function OnlineOnly({ children }) {
  const online = useOnline();
  if (online) return children;
  return (
    <div className="empty-state">
      <Icon name="wifi-off" size={40} />
      <div className="empty-title">Cette page nécessite une connexion</div>
      <div className="empty-sub">
        Hors ligne, vous pouvez consulter la <NavLink to="/stations">liste des stations</NavLink> et
        vos <NavLink to="/favoris">favoris</NavLink> (dernières données connues).
      </div>
    </div>
  );
}
