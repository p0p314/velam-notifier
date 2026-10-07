import Icon from "../Icon";
import { freshnessInfo } from "../../lib/trains";
import { useNow } from "../../trainHooks";

/**
 * Origine et fraîcheur des données : « Temps réel — mis à jour il y a 1 min »,
 * « Horaires théoriques »… + bouton d'actualisation (force la relecture du flux).
 */
export default function Freshness({ realtime, onRefresh, refreshing = false }) {
  const now = useNow();
  const f = freshnessInfo(realtime, now);
  return (
    <div className={`freshness ${f.tone}`} role="status">
      <Icon name={f.tone === "ok" ? "clock" : f.tone === "warn" ? "wifi-off" : "calendar"} size={15} />
      <span>{f.text}</span>
      {onRefresh && (
        <button type="button" className="freshness-btn" onClick={onRefresh} disabled={refreshing} aria-label="Actualiser">
          <Icon name="refresh" size={15} className={refreshing ? "spin" : ""} />
          <span>Actualiser</span>
        </button>
      )}
    </div>
  );
}
