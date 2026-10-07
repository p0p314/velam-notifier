import { NavLink } from "react-router-dom";
import Icon from "./Icon";
import { useOnline } from "../hooks";
import { useModules } from "../auth";
import { fmtUpdatedAt } from "../lib/offlineCache";
import { bannerText } from "../lib/station";

/**
 * Bandeau de fraîcheur des disponibilités : hors ligne, serveur injoignable, ou
 * flux Vélam qui ne répond plus / données non mises à jour depuis ≥ 5 min.
 * Précise toujours l'heure des données affichées.
 */
export function OfflineBanner({ stale, staleReason, lastUpd }) {
  const online = useOnline();
  if (online && !stale) return null;
  const reason = !online ? "offline" : staleReason ?? "server";
  return (
    <div className="offline-banner" role="status">
      <Icon name={reason === "upstream" ? "clock" : "wifi-off"} size={16} />
      <span>{bannerText(reason, lastUpd, fmtUpdatedAt(lastUpd))}</span>
    </div>
  );
}

/** Garde de route : hors ligne, seules les stations et les favoris (vélos) restent accessibles. */
export function OnlineOnly({ children }) {
  const online = useOnline();
  const modules = useModules();
  if (online) return children;
  return (
    <div className="empty-state">
      <Icon name="wifi-off" size={40} />
      <div className="empty-title">Cette page nécessite une connexion</div>
      <div className="empty-sub">
        {modules.bikes ? (
          <>
            Hors ligne, vous pouvez consulter la <NavLink to="/velos?vue=liste">liste des stations</NavLink> et
            vos <NavLink to="/trajets">stations favorites</NavLink> (dernières données connues).
          </>
        ) : "Reconnectez-vous pour consulter vos trains."}
      </div>
    </div>
  );
}
