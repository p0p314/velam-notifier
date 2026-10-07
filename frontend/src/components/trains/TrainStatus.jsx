import { statusInfo } from "../../lib/trains";

const TONE = { ok: "open", warn: "warn", danger: "closed", neutral: "neutral" };

/** Statut d'un trajet (« En retard », « Supprimé »…) + phase (« Parti », « Arrivé »). */
export default function TrainStatus({ journey }) {
  const s = statusInfo(journey);
  return (
    <span className="train-status">
      <span className={`status-pill ${TONE[s.tone]}`}><span className="dot" />{s.label}</span>
      {s.phase && <span className="train-phase">{s.phase}</span>}
    </span>
  );
}
