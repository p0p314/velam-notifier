import { Link } from "react-router-dom";
import Icon from "../Icon";
import LineBadge from "./LineBadge";
import TrainStatus from "./TrainStatus";
import { timeInfo } from "../../lib/trains";
import { trainMapPath } from "../../lib/trainMap";

/** « Départ 16:53 → 17:02 +9 min » : l'heure estimée n'apparaît que si elle diffère. */
export function TimeLine({ label, scheduled, estimated, delay, cancelled, platform = null }) {
  const t = timeInfo(scheduled, estimated, delay);
  return (
    <div className="train-time">
      <span className="train-time-label">{label}</span>
      <span className={"t-sched" + (t.estimated || cancelled ? " old" : "")}>{t.scheduled}</span>
      {t.estimated && <span className="t-est">{t.estimated}</span>}
      {t.delay && <span className="t-delay">{t.delay}</span>}
      {platform && !cancelled && <PlatformBadge platform={platform} />}
    </div>
  );
}

/** « Voie 4 » : connue seulement peu avant le départ (flux SIRI SNCF), jamais devinée. */
export function PlatformBadge({ platform }) {
  return <span className="platform-badge" title="Voie (quai)">Voie {platform}</span>;
}

/**
 * Carte d'un train dans une liste (résultats de recherche, prochaines circulations).
 * Toute la carte ouvre le détail (lien étiré sur le trajet) ; « Carte » ouvre la
 * carte du train (lien distinct : jamais de lien imbriqué dans un autre).
 */
export default function JourneyCard({ j, showDate = false }) {
  const cancelled = j.status === "cancelled";
  const major = j.alerts?.find((a) => a.major && a.scope !== "station");
  // Une voie affichée allonge la ligne : départ et arrivée passent l'un sous l'autre.
  const stacked = !cancelled && !!(j.departurePlatform || j.arrivalPlatform);
  return (
    <article className={"train-card" + (cancelled ? " cancelled" : "")}>
      <div className="train-card-head">
        <LineBadge line={j.line} journey={j} />
        <span className="train-num">
          {[j.brand, j.trainNumber && `n° ${j.trainNumber}`].filter(Boolean).join(" · ")}
        </span>
        <TrainStatus journey={j} />
      </div>
      <Link to={`/trains/trajet?id=${encodeURIComponent(j.id)}`} className="train-route train-card-link">
        {j.departureStation.name} <span aria-hidden="true">→</span> {j.arrivalStation.name}
        {showDate && <span className="train-date"> · {new Date(`${j.serviceDate}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span>}
      </Link>
      <div className={"train-times" + (stacked ? " stacked" : "")}>
        <div className="train-times-main">
          <TimeLine label="Départ" scheduled={j.scheduledDeparture} estimated={j.estimatedDeparture} delay={j.departureDelay} cancelled={cancelled} platform={j.departurePlatform} />
          <TimeLine label="Arrivée" scheduled={j.scheduledArrival} estimated={j.estimatedArrival} delay={j.arrivalDelay} cancelled={cancelled} platform={j.arrivalPlatform} />
        </div>
        <Link to={trainMapPath(j.id)} className="train-card-map" aria-label={`Voir sur la carte : ${j.departureStation.name} → ${j.arrivalStation.name}`}>
          <Icon name="map" size={14} /> Carte
        </Link>
      </div>
      {cancelled && j.cancellation?.reason && <div className="train-note danger">{j.cancellation.reason}</div>}
      {!cancelled && major && (
        <div className="train-note warn"><Icon name="alert-triangle" size={14} /><span>{major.header || "Perturbation signalée"}</span></div>
      )}
    </article>
  );
}
