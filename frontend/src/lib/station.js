// Logique métier station partagée par les composants (statut + seuils).
// Source unique de vérité : évite la triplication de `statusOf` et le seuil « 2 »
// dispersé dans plusieurs fichiers.

// Seuil « faible disponibilité » : au plus 2 vélos → signal visuel (pastille warn,
// compteur `low`). Un seul endroit à ajuster.
export const LOW_BIKES = 2;

/** « 75 min », « 2 h », « 3 j ». */
export function fmtAge(min) {
  if (min < 120) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} j`;
}

// Seuil de péremption des disponibilités (identique au serveur : gbfs.js).
export const STALE_AFTER_MIN = 5;

/**
 * Texte du bandeau de fraîcheur.
 *  - offline  : l'appareil n'a plus de réseau ;
 *  - server   : le serveur VéloPulse ne répond pas ;
 *  - upstream : le flux Vélam ne répond plus / répond mal à notre serveur,
 *               ou ses données ont au moins STALE_AFTER_MIN minutes.
 * `when` : heure lisible des données affichées (null si aucune).
 */
export function bannerText(reason, lastUpd, when, now = Date.now()) {
  const data = when ? `données de ${when}` : "aucune donnée enregistrée";
  if (reason === "offline") return `Hors ligne — ${data}`;
  if (reason === "server") return `Serveur injoignable — ${data}`;
  const age = lastUpd ? Math.floor((now - lastUpd.getTime()) / 60_000) : null;
  if (age !== null && age >= STALE_AFTER_MIN) {
    return `Disponibilités non mises à jour depuis ${fmtAge(age)} — ${data}`;
  }
  return `Données Vélam momentanément indisponibles — ${data}`;
}

/** « 2 vélos indisponibles » (en panne / réservés à la maintenance), ou null. */
export function disabledNote(s) {
  const n = s.bikes_disabled ?? 0;
  return n > 0 ? `${n} vélo${n > 1 ? "s" : ""} indisponible${n > 1 ? "s" : ""}` : null;
}

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
