// Calculs géographiques légers (pas de dépendance) : distance et libellé.

/** Distance à vol d'oiseau (km) entre deux points { lat, lon }. Infinity si invalide. */
function distanceKm(a, b) {
  if (a?.lat == null || a?.lon == null || b?.lat == null || b?.lon == null) return Infinity;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** « 350 m » (arrondi à 10 m) sous 1 km, sinon « 1,2 km ». */
function fmtDistance(km) {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

module.exports = { distanceKm, fmtDistance };
