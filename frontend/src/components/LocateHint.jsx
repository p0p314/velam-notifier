import Icon from "./Icon";

/** Ligne affichée quand le tri « proximité » est choisi mais qu'aucune position n'est connue. */
export default function LocateHint({ status, onLocate }) {
  if (status === "granted" || status === "unavailable") return null;
  return (
    <div className="locate-hint" role="status">
      {status === "locating" ? (
        <span>Localisation…</span>
      ) : (
        <>
          <span>Position non autorisée : stations triées par nom.</span>
          <button type="button" className="locate-btn" onClick={onLocate}>
            <Icon name="map-pin" size={15} /> Réessayer
          </button>
        </>
      )}
    </div>
  );
}
