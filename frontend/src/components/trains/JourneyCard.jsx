import { Link } from "react-router-dom";
import Icon from "../Icon";
import LineBadge from "./LineBadge";
import TrainStatus from "./TrainStatus";
import { timeInfo } from "../../lib/trains";

/** « Départ 16:53 → 17:02 +9 min » : l'heure estimée n'apparaît que si elle diffère. */
export function TimeLine({ label, scheduled, estimated, delay, cancelled }) {
  const t = timeInfo(scheduled, estimated, delay);
  return (
    <div className="train-time">
      <span className="train-time-label">{label}</span>
      <span className={"t-sched" + (t.estimated || cancelled ? " old" : "")}>{t.scheduled}</span>
      {t.estimated && <span className="t-est">{t.estimated}</span>}
      {t.delay && <span className="t-delay">{t.delay}</span>}
    </div>
  );
}

/** Carte d'un train dans une liste (résultats de recherche, prochaines circulations). */
export default function JourneyCard({ j, showDate = false }) {
  const cancelled = j.status === "cancelled";
  const major = j.alerts?.find((a) => a.major && a.scope !== "station");
  return (
    <Link to={`/trains/trajet?id=${encodeURIComponent(j.id)}`} className={"train-card" + (cancelled ? " cancelled" : "")}>
      <div className="train-card-head">
        <LineBadge line={j.line} journey={j} />
        <span className="train-num">
          {[j.brand, j.trainNumber && `n° ${j.trainNumber}`].filter(Boolean).join(" · ")}
        </span>
        <TrainStatus journey={j} />
      </div>
      <div className="train-route">
        {j.departureStation.name} <span aria-hidden="true">→</span> {j.arrivalStation.name}
        {showDate && <span className="train-date"> · {new Date(`${j.serviceDate}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span>}
      </div>
      <div className="train-times">
        <TimeLine label="Départ" scheduled={j.scheduledDeparture} estimated={j.estimatedDeparture} delay={j.departureDelay} cancelled={cancelled} />
        <TimeLine label="Arrivée" scheduled={j.scheduledArrival} estimated={j.estimatedArrival} delay={j.arrivalDelay} cancelled={cancelled} />
      </div>
      {cancelled && j.cancellation?.reason && <div className="train-note danger">{j.cancellation.reason}</div>}
      {!cancelled && major && (
        <div className="train-note warn"><Icon name="alert-triangle" size={14} /><span>{major.header || "Perturbation signalée"}</span></div>
      )}
    </Link>
  );
}
