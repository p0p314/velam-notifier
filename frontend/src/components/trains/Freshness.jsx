import Icon from "../Icon";
import { freshnessInfo } from "../../lib/trains";
import { useNow } from "../../trainHooks";

/**
 * Origine et fraîcheur des données : « Temps réel — mis à jour il y a 1 min »,
 * « Horaires théoriques »… Pas de bouton : on actualise en tirant la page vers le bas
 * (PullToRefresh), et les pages se rafraîchissent seules (2 min si visibles).
 */
export default function Freshness({ realtime }) {
  const now = useNow();
  const f = freshnessInfo(realtime, now);
  return (
    <div className={`freshness ${f.tone}`} role="status">
      <Icon name={f.tone === "ok" ? "clock" : f.tone === "warn" ? "wifi-off" : "calendar"} size={15} />
      <span>{f.text}</span>
    </div>
  );
}
