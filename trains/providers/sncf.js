// Fournisseur SNCF (TER, Intercités, TGV) — données ouvertes du Point d'Accès National
// (transport.data.gouv.fr, jeu « Réseau SNCF TGV, Intercités et TER », licence ODbL).
//
// Ce fichier regroupe TOUTES les particularités du flux SNCF ; le reste du module est
// du GTFS / GTFS-RT générique. Conventions constatées dans les données publiées
// (export du 2026-10-06) et documentées par la communauté (orhazal/sncf-gtfs-toolkit) :
//  - calendrier entièrement dans calendar_dates.txt (calendar.txt vide) ;
//  - trip_id = « OCE » + réseau (SN, SA, EA, LO, BO) + numéro de train + F|R + « <RICS>_<F|R>:<marque>:<ligne>::<origine>:<destination>:… :<fin de période> »,
//    ex. OCESN843940F1187_F:TER:FR:Line::E597DAD9-…::87286005:87313874:7:2026:20270320 ;
//    il change donc à chaque période / version du dataset (cf. favoris) ;
//  - numéro de train = trip_headsign (zéros de tête retirés) ;
//  - stop_id de quai « StopPoint:OCE<marque>-<UIC 8 chiffres> », gare « StopArea:OCE<UIC> » ;
//  - aucun tracé : pas de shapes.txt, shape_id vide pour tous les trajets (tracé de gare
//    en gare, approximatif) ; aucun flux de positions (VehiclePosition) publié ;
//  - le GTFS-RT désigne parfois un train par son identifiant interne court
//    « OCESN843940F » (préfixe des trip_id statiques de ce train), avec start_date.

const GTFS_URL = 'https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip';
const TRIP_UPDATES_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates';
const SERVICE_ALERTS_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts';

// Identifiant interne d'un train (préfixe des trip_id statiques).
const SHORT_ID = /^OCE[A-Z]{2}\d+[FR]/;
// Marque, lue dans le trip_id (« …_F:TER:… ») ; libellés = marques des quais (stops.txt).
const BRANDS = {
  TER: 'TER', CTE: 'Car TER', OUI: 'TGV INOUI', OGO: 'OUIGO', TRN: 'OUIGO Train Classique',
  IC: 'Intercités', ICN: 'Intercités de nuit', LYR: 'TGV Lyria', ICE: 'ICE', TT: 'Tram-train',
  NAV: 'Navette', NA: 'Navette', CRE: 'Car à réservation',
};

const conventions = {
  timezone: 'Europe/Paris',
  /** Numéro commercial du train : le trip_headsign, sans zéros de tête. */
  trainNumber: (trip) => (trip.trip_headsign || '').replace(/^0+(?=\d)/, ''),
  /** Identifiant interne utilisé par le GTFS-RT SNCF pour ce trajet. */
  realtimeAliases: (tripId) => {
    const m = SHORT_ID.exec(tripId);
    return m ? [m[0]] : [];
  },
  /** Car (mode routier, `_R:` dans le trip_id) ou train (`_F:`). */
  isRoad: (trip) => /_R:/.test(trip.trip_id),
  /** Code UIC (8 chiffres) d'une gare ou d'un quai. */
  stationCode: (stopId) => /(\d{8})$/.exec(stopId)?.[1] ?? null,
  /** Marque commerciale (TER, TGV INOUI…) lue dans le trip_id. */
  brand: (tripId) => BRANDS[/_[FR]:([A-Z]+):/.exec(tripId)?.[1]] ?? null,
};

/** Configuration du fournisseur ; URL surchargeables par l'environnement (miroir, tests). */
function sncfConfig(env = process.env) {
  return {
    id: 'sncf',
    name: 'SNCF (TER, Intercités, TGV)',
    attribution: 'Données SNCF Voyageurs — transport.data.gouv.fr (ODbL)',
    gtfsUrl: env.TRAINS_GTFS_URL || GTFS_URL,
    tripUpdatesUrl: env.TRAINS_RT_TRIP_UPDATES_URL || TRIP_UPDATES_URL,
    serviceAlertsUrl: env.TRAINS_RT_ALERTS_URL || SERVICE_ALERTS_URL,
    // Positions des trains : la SNCF ne publie AUCUN flux GTFS-RT VehiclePosition (seuls
    // Trip Updates et Service Alerts existent sur le PAN). Activable si une source apparaît.
    vehiclePositionsUrl: env.TRAINS_RT_VEHICLES_URL || null,
    conventions,
  };
}

module.exports = { sncfConfig, conventions, GTFS_URL, TRIP_UPDATES_URL, SERVICE_ALERTS_URL };
