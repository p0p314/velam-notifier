// Villes de vélos (même API que Vélam) — COPIE de cities.js (backend), gardée identique
// par test/cities.test.js. Une ville choisie par compte (user.city) ; seule celle-ci est
// affichée et interrogée. Identifiants de stations : Amiens tels quels, autres villes
// préfixées (« lyon:12 »).

export const DEFAULT_CITY = "amiens";

export const CITIES = [
  {id: "amiens", name: "Amiens", system: "Vélam", country: "FR", center: {lat: 49.8941, lon: 2.2957}, website: "https://velam.amiens.fr/fr/home"},
  {id: "besancon", name: "Besançon", system: "VéloCité", country: "FR", center: {lat: 47.238, lon: 6.0243}, website: "https://www.velocite.besancon.fr/"},
  {id: "cergy", name: "Cergy-Pontoise", system: "VélO2", country: "FR", center: {lat: 49.0364, lon: 2.0631}, website: "https://www.velo2.cergypontoise.fr/"},
  {id: "lyon", name: "Lyon", system: "Vélo'v", country: "FR", center: {lat: 45.764, lon: 4.8357}, website: "https://velov.grandlyon.com/"},
  {id: "mulhouse", name: "Mulhouse", system: "VéloCité", country: "FR", center: {lat: 47.7508, lon: 7.3359}, website: "https://www.compte-mobilite.fr/"},
  {id: "nancy", name: "Nancy", system: "VélOstan'lib", country: "FR", center: {lat: 48.6921, lon: 6.1844}, website: "https://www.velostanlib.fr/"},
  {id: "nantes", name: "Nantes", system: "Naolib", country: "FR", center: {lat: 47.2184, lon: -1.5536}, website: "https://velo.naolib.fr/"},
  {id: "toulouse", name: "Toulouse", system: "VélÔToulouse", country: "FR", center: {lat: 43.6047, lon: 1.4442}, website: "https://www.velo.toulouse.fr/"},
  {id: "bruxelles", name: "Bruxelles", system: "Villo!", country: "BE", center: {lat: 50.8503, lon: 4.3517}, website: "https://www.villo.be/"},
  {id: "namur", name: "Namur", system: "Li Bia Velo", country: "BE", center: {lat: 50.4674, lon: 4.872}, website: "https://www.libiavelo.be/"},
  {id: "luxembourg", name: "Luxembourg", system: "Vel'OH!", country: "LU", center: {lat: 49.6116, lon: 6.1319}, website: "https://myveloh.lu/"},
  {id: "seville", name: "Séville", system: "Sevici", country: "ES", center: {lat: 37.3891, lon: -5.9845}, website: "https://www.sevici.es/"},
  {id: "valence", name: "Valence", system: "Valenbisi", country: "ES", center: {lat: 39.4699, lon: -0.3763}, website: "https://www.valenbisi.es/"},
  {id: "ljubljana", name: "Ljubljana", system: "BicikeLJ", country: "SI", center: {lat: 46.0569, lon: 14.5058}, website: "https://www.bicikelj.si/"},
  {id: "maribor", name: "Maribor", system: "MBajk", country: "SI", center: {lat: 46.5547, lon: 15.6459}, website: "https://www.mbajk.si/"},
  {id: "lund", name: "Lund", system: "Lundahoj", country: "SE", center: {lat: 55.7047, lon: 13.191}, website: "https://www.lundahoj.se/"},
  {id: "lillestrom", name: "Lillestrøm", system: "Bysykkel", country: "NO", center: {lat: 59.956, lon: 11.05}, website: "https://www.bysykkel.org/"},
];

const BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export const isCity = (id) => typeof id === "string" && BY_ID.has(id);
export const cityById = (id) => BY_ID.get(id) ?? BY_ID.get(DEFAULT_CITY);

/** Ville d'un identifiant de station (« lyon:12 » → lyon ; « 12 » → amiens). */
export function stationCity(id) {
  const s = String(id ?? "");
  const i = s.indexOf(":");
  return i > 0 && isCity(s.slice(0, i)) ? s.slice(0, i) : DEFAULT_CITY;
}

/** Ville choisie par l'utilisateur (Amiens par défaut). */
export const userCity = (user) => (isCity(user?.city) ? user.city : DEFAULT_CITY);

/** Pays (libellés), pour grouper la liste. */
export const COUNTRIES = { FR: "France", BE: "Belgique", LU: "Luxembourg", ES: "Espagne", SI: "Slovénie", SE: "Suède", NO: "Norvège" };
