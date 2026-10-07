import Icon from "../Icon";
import { SORTS, STATUS_FILTERS, PAST_FILTERS, DEFAULT_FILTERS, filterOptions } from "../../lib/trains";

function Select({ label, value, onChange, options, all }) {
  return (
    <label className="train-field">
      <span className="form-label">{label}</span>
      <div className="select-wrap select-inset">
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
          {all && <option value="">{all}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Icon name="chevron-down" size={15} />
      </div>
    </label>
  );
}

/**
 * Filtres et tri des résultats (appliqués sur l'appareil : les trains d'une journée
 * sont déjà chargés). Les listes proposées ne contiennent que les valeurs présentes.
 */
export default function TrainFilters({ journeys, value, onChange, onDone, count }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const opts = filterOptions(journeys);
  return (
    <div className="controls-sheet train-filters">
      <div className="form-title">Filtrer et trier</div>
      <div className="train-search-when">
        <label className="train-field">
          <span className="form-label">Départ après</span>
          <input type="time" className="field mono" value={value.minTime} onChange={(e) => set("minTime", e.target.value)} aria-label="Heure minimale" />
        </label>
        <label className="train-field">
          <span className="form-label">Départ avant</span>
          <input type="time" className="field mono" value={value.maxTime} onChange={(e) => set("maxTime", e.target.value)} aria-label="Heure maximale" />
        </label>
      </div>
      <Select label="Trains passés" value={value.past} onChange={(v) => set("past", v)} options={PAST_FILTERS} />
      <Select label="État" value={value.status} onChange={(v) => set("status", v)} options={STATUS_FILTERS} />
      {opts.lines.length > 1 && <Select label="Ligne" value={value.line} onChange={(v) => set("line", v)} options={opts.lines} all="Toutes les lignes" />}
      {opts.from.length > 1 && <Select label="Gare de départ" value={value.from} onChange={(v) => set("from", v)} options={opts.from} all="Toutes" />}
      {opts.to.length > 1 && <Select label="Gare d'arrivée" value={value.to} onChange={(v) => set("to", v)} options={opts.to} all="Toutes" />}
      <Select label="Trier par" value={value.sort} onChange={(v) => set("sort", v)} options={SORTS} />
      <div className="form-submit-row">
        {onDone && <button type="button" className="submit-btn" onClick={onDone}>Voir {count} train{count !== 1 ? "s" : ""}</button>}
        <button type="button" className="cancel-btn" onClick={() => onChange(DEFAULT_FILTERS)}>Réinitialiser</button>
      </div>
    </div>
  );
}
