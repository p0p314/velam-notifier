import Icon from "./Icon";

/**
 * Ligne affichée quand le tri « proximité » est choisi mais qu'aucune position
 * n'est connue : la localisation n'est demandée que sur clic, jamais au lancement.
 */
export default function LocateHint({ status, onLocate }) {
  if (status === "granted" || status === "unavailable") return null;
  return (
    <div className="locate-hint" role="status">
      {status === "locating" ? (
        <span>Localisation…</span>
      ) : status === "denied" ? (
        <span>Position non autorisée : stations triées par nom. Autorisez la localisation dans les réglages du téléphone.</span>
      ) : (
        <>
          <span>Stations triées par nom.</span>
          <button type="button" className="locate-btn" onClick={onLocate}>
            <Icon name="map-pin" size={15} /> Trier par proximité
          </button>
        </>
      )}
    </div>
  );
}
