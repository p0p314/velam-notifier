// Logique métier station partagée par les composants (statut + seuils).
// Source unique de vérité : évite la triplication de `statusOf` et le seuil « 2 »
// dispersé dans plusieurs fichiers.

// Seuil « faible disponibilité » : au plus 2 vélos → signal visuel (pastille warn,
// compteur `low`). Un seul endroit à ajuster.
export const LOW_BIKES = 2;

/** Décompte par type + total (tolère les champs absents). */
export function bikeCounts(s) {
  const elec = s.electrical ?? 0;
  const meca = s.mechanical ?? 0;
  return { elec, meca, total: elec + meca };
}

/**
 * Statut d'une station pour la pastille d'état.
 *  - closed : hors service
 *  - warn   : faible disponibilité (≤ LOW_BIKES vélos)
 *  - open   : disponible
 * `labelLong` : variante détaillée (fiche station) ; `label` : variante compacte.
 */
export function stationStatus(s) {
  if (s.is_renting === false) {
    return { cls: "closed", label: "Hors service", labelLong: "Hors service" };
  }
  if (bikeCounts(s).total <= LOW_BIKES) {
    return { cls: "warn", label: "Faible", labelLong: "Faible disponibilité" };
  }
  return { cls: "open", label: "Ouverte", labelLong: "Ouverte" };
}
