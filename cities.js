// Villes de vélos en libre-service servies par la même API que Vélam (Cyclocity / JCDecaux,
// GBFS : https://api.cyclocity.fr/contracts/<ville>/gbfs/…). Liste tirée du catalogue GBFS
// officiel de MobilityData (systems.csv, producteur Cyclocity), restreinte aux villes à
// l'heure de Paris : les créneaux d'alerte sont évalués dans ALERT_TZ (Europe/Paris) —
// Dublin, Vilnius et Toyama en sont exclues tant que les alertes ne gèrent qu'un fuseau.
//
// Identifiants de stations : ceux d'Amiens restent tels quels (« 12 », données d'avant
// la v1.11 inchangées) ; ceux des autres villes sont préfixés (« lyon:12 ») — les numéros
// GBFS ne sont uniques que dans une ville. `stationCity` retrouve la ville d'un identifiant.

const DEFAULT_CITY = 'amiens';

const CITIES = [
  // id = identifiant du contrat Cyclocity ; center = centre-ville (carte, correspondances train ↔ vélo).
  { id: 'amiens',     name: 'Amiens',          system: 'Vélam',         country: 'FR', center: { lat: 49.8941, lon: 2.2957 },  website: 'https://velam.amiens.fr/fr/home' },
  { id: 'besancon',   name: 'Besançon',        system: 'VéloCité',      country: 'FR', center: { lat: 47.2380, lon: 6.0243 },  website: 'https://www.velocite.besancon.fr/' },
  { id: 'cergy',      name: 'Cergy-Pontoise',  system: 'VélO2',         country: 'FR', center: { lat: 49.0364, lon: 2.0631 },  website: 'https://www.velo2.cergypontoise.fr/' },
  { id: 'lyon',       name: 'Lyon',            system: "Vélo'v",        country: 'FR', center: { lat: 45.7640, lon: 4.8357 },  website: 'https://velov.grandlyon.com/' },
  { id: 'mulhouse',   name: 'Mulhouse',        system: 'VéloCité',      country: 'FR', center: { lat: 47.7508, lon: 7.3359 },  website: 'https://www.compte-mobilite.fr/' },
  { id: 'nancy',      name: 'Nancy',           system: "VélOstan'lib",  country: 'FR', center: { lat: 48.6921, lon: 6.1844 },  website: 'https://www.velostanlib.fr/' },
  { id: 'nantes',     name: 'Nantes',          system: 'Naolib',        country: 'FR', center: { lat: 47.2184, lon: -1.5536 }, website: 'https://velo.naolib.fr/' },
  { id: 'toulouse',   name: 'Toulouse',        system: 'VélÔToulouse',  country: 'FR', center: { lat: 43.6047, lon: 1.4442 },  website: 'https://www.velo.toulouse.fr/' },
  { id: 'bruxelles',  name: 'Bruxelles',       system: 'Villo!',        country: 'BE', center: { lat: 50.8503, lon: 4.3517 },  website: 'https://www.villo.be/' },
  { id: 'namur',      name: 'Namur',           system: 'Li Bia Velo',   country: 'BE', center: { lat: 50.4674, lon: 4.8720 },  website: 'https://www.libiavelo.be/' },
  { id: 'luxembourg', name: 'Luxembourg',      system: "Vel'OH!",       country: 'LU', center: { lat: 49.6116, lon: 6.1319 },  website: 'https://myveloh.lu/' },
  { id: 'seville',    name: 'Séville',         system: 'Sevici',        country: 'ES', center: { lat: 37.3891, lon: -5.9845 }, website: 'https://www.sevici.es/' },
  { id: 'valence',    name: 'Valence',         system: 'Valenbisi',     country: 'ES', center: { lat: 39.4699, lon: -0.3763 }, website: 'https://www.valenbisi.es/' },
  { id: 'ljubljana',  name: 'Ljubljana',       system: 'BicikeLJ',      country: 'SI', center: { lat: 46.0569, lon: 14.5058 }, website: 'https://www.bicikelj.si/' },
  { id: 'maribor',    name: 'Maribor',         system: 'MBajk',         country: 'SI', center: { lat: 46.5547, lon: 15.6459 }, website: 'https://www.mbajk.si/' },
  { id: 'lund',       name: 'Lund',            system: 'Lundahoj',      country: 'SE', center: { lat: 55.7047, lon: 13.1910 }, website: 'https://www.lundahoj.se/' },
  { id: 'lillestrom', name: 'Lillestrøm',      system: 'Bysykkel',      country: 'NO', center: { lat: 59.9560, lon: 11.0500 }, website: 'https://www.bysykkel.org/' },
];

const BY_ID = new Map(CITIES.map((c) => [c.id, c]));

const isCity = (id) => typeof id === 'string' && BY_ID.has(id);
const cityById = (id) => BY_ID.get(id) ?? BY_ID.get(DEFAULT_CITY);

/** Identifiant global d'une station GBFS de la ville `city`. */
const globalStationId = (city, rawId) => (city === DEFAULT_CITY ? String(rawId) : `${city}:${rawId}`);

/** Ville d'un identifiant de station (« lyon:12 » → lyon ; « 12 » → amiens). */
function stationCity(id) {
  const s = String(id ?? '');
  const i = s.indexOf(':');
  return i > 0 && isCity(s.slice(0, i)) ? s.slice(0, i) : DEFAULT_CITY;
}

/** Racine GBFS v2 d'une ville. */
const gbfsBase = (city) => `https://api.cyclocity.fr/contracts/${encodeURIComponent(city)}/gbfs/v2`;

module.exports = { CITIES, DEFAULT_CITY, isCity, cityById, globalStationId, stationCity, gbfsBase };
