import { useState } from "react";
import Seg from "../Seg";
import DayPicker from "../DayPicker";
import {
  DELAY_OPTIONS, tripAlertForm, lineAlertForm, alertFormError, tripAlertPayload, lineAlertPayload,
} from "../../lib/trains";

/**
 * Alerte sur un trajet favori (retard ≥ seuil, suppression, perturbation, voie) ou sur une
 * ligne (perturbations, trains supprimés, créneau facultatif). `alert` : alerte
 * existante (modification) ou null (création).
 */
export default function TrainAlertForm({ scope, alert = null, subject, onSubmit, onCancel, onDelete }) {
  const [form, setForm] = useState(() => (scope === "line" ? lineAlertForm(alert) : tripAlertForm(alert)));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    const err = alertFormError(form, scope);
    if (err) { setError(err); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(scope === "line" ? lineAlertPayload(form) : tripAlertPayload(form));
    } catch (ex) {
      setError(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="train-alert-form" aria-label="Alerte train">
      <div className="form-title">{alert ? "Modifier l'alerte" : scope === "line" ? "Suivre la ligne" : "Créer une alerte"}</div>
      {subject && <div className="form-hint">{subject}</div>}

      {scope === "trip" && (
        <div className="train-field">
          <span className="form-label">Me prévenir en cas de retard</span>
          <Seg label="Seuil de retard" options={DELAY_OPTIONS} value={form.delay} onChange={(v) => set("delay", v)} />
          {form.delay && <span className="form-hint">Puis à chaque aggravation de 10 min, quand il baisse d'au moins 5 min et quand il est rattrapé.</span>}
        </div>
      )}
      <label className="check-row">
        <input type="checkbox" checked={form.onCancel} onChange={(e) => set("onCancel", e.target.checked)} />
        <span>{scope === "line" ? "Un train de la ligne est supprimé" : "Le train est supprimé"}</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={form.onDisruption} onChange={(e) => set("onDisruption", e.target.checked)} />
        <span>{scope === "line" ? "Perturbation importante sur la ligne" : "Perturbation annoncée sur ce train ou sa ligne"}</span>
      </label>

      {scope === "trip" && (
        <label className="check-row">
          <input type="checkbox" checked={form.onPlatform} onChange={(e) => set("onPlatform", e.target.checked)} />
          <span>Voie de départ : dès qu'elle est annoncée, puis si elle change</span>
        </label>
      )}

      {scope === "line" && (
        <>
          <label className="check-row">
            <input type="checkbox" checked={form.window} onChange={(e) => set("window", e.target.checked)} />
            <span>Seulement sur un créneau</span>
          </label>
          {form.window && (
            <div className="train-search-when">
              <label className="train-field">
                <span className="form-label">Début</span>
                <input type="time" className="field mono" value={form.timeStart} onChange={(e) => set("timeStart", e.target.value)} aria-label="Début" />
              </label>
              <label className="train-field">
                <span className="form-label">Fin</span>
                <input type="time" className="field mono" value={form.timeEnd} onChange={(e) => set("timeEnd", e.target.value)} aria-label="Fin" />
              </label>
            </div>
          )}
        </>
      )}

      <div className="train-field">
        <span className="form-label">Jours</span>
        <DayPicker value={form.days} onChange={(d) => set("days", d)} />
      </div>
      {scope === "trip" && <span className="form-hint">Surveillé de 3 h avant le départ jusqu'à l'arrivée.</span>}

      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-submit-row">
        <button type="submit" className="submit-btn" disabled={busy}>{alert ? "Enregistrer" : scope === "line" ? "Suivre la ligne" : "Créer l'alerte"}</button>
        {onCancel && <button type="button" className="cancel-btn" onClick={onCancel}>Annuler</button>}
        {alert && onDelete && <button type="button" className="cancel-btn danger-text" onClick={onDelete}>Supprimer l'alerte</button>}
      </div>
    </form>
  );
}
