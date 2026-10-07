// Jeu de données GTFS / GTFS-RT de test, calqué sur le format réel de l'export SNCF
// (trip_id « OCESN<numéro>F1187_F:TER:<ligne>::<UIC>:<UIC>:… », quais
// « StopPoint:OCETrain TER-<UIC> », gares « StopArea:OCE<UIC> », calendrier dans
// calendar_dates.txt uniquement, deux lignes « K44 » de régions différentes).
// Aucune donnée réseau : tout est construit ici.
const zlib = require('zlib');
const { encodeFeed } = require('../trains/gtfs/realtime');

const ST = {
  LILLE:   { uic: '87286005', name: 'Lille Flandres', lat: 50.636577, lon: 3.06987 },
  DOUAI:   { uic: '87345009', name: 'Douai', lat: 50.371, lon: 3.09 },
  ARRAS:   { uic: '87342014', name: 'Arras', lat: 50.286, lon: 2.781 },
  ALBERT:  { uic: '87313056', name: 'Albert', lat: 50.004, lon: 2.651 },
  AMIENS:  { uic: '87313874', name: 'Amiens', lat: 49.890584, lon: 2.308277 },
  LYON:    { uic: '87722025', name: 'Lyon Perrache', lat: 45.748, lon: 4.826 },
  VALENCE: { uic: '87761007', name: 'Valence Ville', lat: 44.928, lon: 4.893 },
};
const area = (k) => `StopArea:OCE${ST[k].uic}`;
const point = (k, brand = 'Train TER') => `StopPoint:OCE${brand}-${ST[k].uic}`;

const LINES = {
  K44: 'FR:Line::E597DAD9-42BF-4927-BEDB-0B05091BCBBE:',
  K44_LYON: 'FR:Line::29d0576e-eb5c-4cf1-b8fe-149eeaa6a347:',
  K45: 'FR:Line::11111111-2222-3333-4444-555555555555:',
};

/** trip_id au format SNCF. */
function tripId(number, line, from, to, endDate, mode = 'F', brand = 'TER') {
  return `OCESN${number}${mode}1187_${mode}:${brand}:${line}::${ST[from].uic}:${ST[to].uic}:6:1810:${endDate.replace(/-/g, '')}`;
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const compact = (ymd) => ymd.replace(/-/g, '');
const weekday = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`).getUTCDay(); return d >= 1 && d <= 5; };

/**
 * Dataset SNCF simulé, en service du `start` (AAAA-MM-JJ) pendant `days` jours.
 * `variant` : 'v1' (référence), 'v2' (nouvelle version : trip_id changés, 16:53 → 16:55),
 * 'renumbered' (le 16:53 change de numéro de train).
 */
function buildGtfs({ start, days = 30, variant = 'v1', shapes = false } = {}) {
  const end = addDays(start, days - 1);
  const suffix = variant === 'v1' ? end : addDays(end, 7);
  const n1 = variant === 'renumbered' ? '843950' : '843924';
  const t1Dep = variant === 'v2' ? '16:55:00' : '16:53:00';

  const trips = [
    // [trip_id, route, service, headsign (numéro, zéros de tête possibles), direction, stops]
    {
      id: tripId(n1, LINES.K44, 'LILLE', 'AMIENS', suffix), route: LINES.K44, service: 'WEEK', headsign: n1, dir: 1,
      stops: [['LILLE', t1Dep, t1Dep], ['DOUAI', '17:12:00', '17:14:00'], ['ARRAS', '17:27:00', '17:29:00'],
        ['ALBERT', '17:55:00', '17:56:00'], ['AMIENS', '18:10:00', '18:10:00']],
    },
    {
      id: tripId('843925', LINES.K44, 'AMIENS', 'LILLE', suffix), route: LINES.K44, service: 'WEEK', headsign: '843925', dir: 0,
      stops: [['AMIENS', '07:00:00', '07:00:00'], ['ALBERT', '07:14:00', '07:15:00'], ['ARRAS', '07:40:00', '07:42:00'],
        ['DOUAI', '07:55:00', '07:57:00'], ['LILLE', '08:17:00', '08:17:00']],
    },
    {
      id: tripId('848908', LINES.K45, 'LILLE', 'AMIENS', suffix), route: LINES.K45, service: 'ALL', headsign: '848908', dir: 1,
      stops: [['LILLE', '17:53:00', '17:53:00'], ['ARRAS', '18:25:00', '18:27:00'], ['AMIENS', '19:10:00', '19:10:00']],
    },
    {
      // Car TER (mode routier « _R: ») sur la ligne K44.
      id: tripId('843990', LINES.K44, 'LILLE', 'AMIENS', suffix, 'R', 'CTE'), route: LINES.K44, service: 'ALL', headsign: '843990', dir: 1,
      brand: 'Car TER',
      stops: [['LILLE', '21:00:00', '21:00:00'], ['AMIENS', '22:30:00', '22:30:00']],
    },
    {
      // Train de nuit : arrivée après minuit (heure GTFS > 24:00).
      id: tripId('843998', LINES.K44, 'LILLE', 'AMIENS', suffix), route: LINES.K44, service: 'ALL', headsign: '843998', dir: 1,
      stops: [['LILLE', '23:50:00', '23:50:00'], ['ARRAS', '24:20:00', '24:21:00'], ['AMIENS', '24:55:00', '24:55:00']],
    },
    {
      // L'autre « K44 » (Auvergne-Rhône-Alpes).
      id: tripId('886000', LINES.K44_LYON, 'LYON', 'VALENCE', suffix), route: LINES.K44_LYON, service: 'ALL', headsign: '0886000', dir: 0,
      stops: [['LYON', '10:00:00', '10:00:00'], ['VALENCE', '11:05:00', '11:05:00']],
    },
  ];

  const csv = (header, rows) => [header, ...rows.map((r) => r.join(','))].join('\r\n') + '\r\n';
  const stopsRows = [];
  for (const k of Object.keys(ST)) {
    stopsRows.push([area(k), ST[k].name, '', ST[k].lat, ST[k].lon, '', '', '1', '']);
    stopsRows.push([point(k), ST[k].name, '', ST[k].lat, ST[k].lon, '', '', '0', area(k)]);
    stopsRows.push([point(k, 'Car TER'), ST[k].name, '', ST[k].lat, ST[k].lon, '', '', '0', area(k)]);
  }
  const cal = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    cal.push(['ALL', compact(d), '1']);
    if (weekday(d)) cal.push(['WEEK', compact(d), '1']);
  }
  const stopTimes = [];
  // Ordre volontairement mélangé (le fichier n'est pas garanti trié).
  for (const t of [...trips].reverse()) {
    t.stops.forEach(([k, arr, dep], i) => {
      // Comme la SNCF : pas de descente au départ, pas de montée au terminus.
      stopTimes.push([t.id, arr, dep, point(k, t.brand), i, '', i === t.stops.length - 1 ? '1' : '0', i === 0 ? '1' : '0', '']);
    });
  }
  return {
    'agency.txt': csv('agency_id,agency_name,agency_url,agency_timezone,agency_lang', [['1187', 'SNCF VOYAGEURS', 'http://www.sncf.com', 'Europe/Paris', 'fr']]),
    'feed_info.txt': csv('feed_id,feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version',
      [['0', 'SNCF', 'http://www.sncf.com', 'fr', compact(start), compact(end), `${start}-${variant}`]]),
    'routes.txt': csv('route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color', [
      [LINES.K44, '1187', 'K44', 'Lille Flandres - Amiens', '', '2', '', 'BF005F', 'FFFFFF'],
      [LINES.K44_LYON, '1187', 'K44', 'Lyon Perrache - Valence', '', '2', '', 'BF005F', 'FFFFFF'],
      [LINES.K45, '1187', 'K45', 'Lille Flandres - Amiens', '', '2', '', '0749FF', 'FFFFFF'],
    ]),
    'stops.txt': '﻿' + csv('stop_id,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station', stopsRows),
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\r\n',
    'calendar_dates.txt': csv('service_id,date,exception_type', cal),
    'trips.txt': csv('route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id',
      trips.map((t, i) => [t.route, t.service, t.id, t.headsign, t.dir, '', shapes && i === 0 ? 'SHP_K44' : ''])),
    // Tracé (variante « shapes ») : points volontairement dans le désordre, un tracé
    // non utilisé (ignoré) et un point invalide.
    ...(shapes ? {
      'shapes.txt': csv('shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled', [
        ['SHP_K44', ST.AMIENS.lat, ST.AMIENS.lon, 50, ''],
        ['SHP_K44', ST.LILLE.lat, ST.LILLE.lon, 1, ''],
        ['SHP_K44', 50.5, 3.08, 5, ''],
        ['SHP_K44', ST.DOUAI.lat, ST.DOUAI.lon, 10, ''],
        ['SHP_K44', 'x', 'y', 11, ''],
        ['SHP_K44', ST.ARRAS.lat, ST.ARRAS.lon, 20, ''],
        ['SHP_K44', ST.ALBERT.lat, ST.ALBERT.lon, 40, ''],
        ['SHP_UNUSED', 1, 1, 1, ''],
        ['SHP_UNUSED', 2, 2, 2, ''],
      ]),
    } : {}),
    'stop_times.txt': csv('trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,shape_dist_traveled', stopTimes),
  };
}

/** Archive ZIP (deflate) d'un ensemble de fichiers — pour tester le lecteur et le téléchargement. */
function zipFiles(files, { store = [] } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const method = store.includes(name) ? 0 : 8;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // CRC non vérifié par le lecteur
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

// ── GTFS-RT ───────────────────────────────────────────────────────────────────

const header = (ts) => ({ gtfsRealtimeVersion: '2.0', incrementality: 'FULL_DATASET', timestamp: Math.floor(ts / 1000) });

/**
 * Trip Updates encodés. `updates` : [{ tripId, startDate (AAAA-MM-JJ), relationship,
 * delay, stops: [{ seq, stopId, arr, dep, skipped, time }] }] (retards en secondes).
 */
function tripUpdatesFeed(updates, ts = Date.now()) {
  return encodeFeed({
    header: header(ts),
    entity: updates.map((u, i) => ({
      id: u.entityId ?? `tu-${i}`,
      tripUpdate: {
        trip: {
          tripId: u.tripId,
          ...(u.startDate ? { startDate: compact(u.startDate) } : {}),
          ...(u.relationship ? { scheduleRelationship: u.relationship } : {}),
        },
        ...(u.delay !== undefined ? { delay: u.delay } : {}),
        stopTimeUpdate: (u.stops ?? []).map((s) => ({
          ...(s.seq !== undefined ? { stopSequence: s.seq } : {}),
          ...(s.stopId ? { stopId: s.stopId } : {}),
          ...(s.arr !== undefined ? { arrival: { delay: s.arr } } : {}),
          ...(s.dep !== undefined ? { departure: { delay: s.dep } } : {}),
          ...(s.depTime !== undefined ? { departure: { time: Math.floor(s.depTime / 1000) } } : {}),
          ...(s.skipped ? { scheduleRelationship: 'SKIPPED' } : {}),
        })),
      },
    })),
  });
}

/** Service Alerts encodées. `alerts` : [{ id, header, description, effect, routeId, tripId, stopId, start, end }]. */
function alertsFeed(alerts, ts = Date.now()) {
  const tr = (text) => (text ? { translation: [{ text: `${text} (en)`, language: 'en' }, { text, language: 'fr' }] } : undefined);
  return encodeFeed({
    header: header(ts),
    entity: alerts.map((a) => ({
      id: a.id,
      alert: {
        activePeriod: a.start || a.end ? [{ ...(a.start ? { start: Math.floor(a.start / 1000) } : {}), ...(a.end ? { end: Math.floor(a.end / 1000) } : {}) }] : [],
        informedEntity: [{
          ...(a.routeId ? { routeId: a.routeId } : {}),
          ...(a.stopId ? { stopId: a.stopId } : {}),
          ...(a.tripId ? { trip: { tripId: a.tripId } } : {}),
        }],
        cause: a.cause ?? 'TECHNICAL_PROBLEM',
        effect: a.effect ?? 'SIGNIFICANT_DELAYS',
        headerText: tr(a.header),
        descriptionText: tr(a.description),
      },
    })),
  });
}

/**
 * Positions de véhicules (VehiclePosition) encodées. `vehicles` : [{ tripId, routeId,
 * startDate, startTime, directionId, vehicleId, lat, lon, bearing, speed, timestamp (ms),
 * stopId, seq, status }].
 */
function vehiclesFeed(vehicles, ts = Date.now()) {
  return encodeFeed({
    header: header(ts),
    entity: vehicles.map((v, i) => ({
      id: v.entityId ?? `vp-${i}`,
      vehicle: {
        ...(v.tripId || v.routeId ? {
          trip: {
            ...(v.tripId ? { tripId: v.tripId } : {}),
            ...(v.routeId ? { routeId: v.routeId } : {}),
            ...(v.startDate ? { startDate: compact(v.startDate) } : {}),
            ...(v.startTime ? { startTime: v.startTime } : {}),
            ...(v.directionId !== undefined ? { directionId: v.directionId } : {}),
          },
        } : {}),
        ...(v.vehicleId ? { vehicle: { id: v.vehicleId } } : {}),
        ...(v.lat !== undefined ? {
          position: {
            latitude: v.lat, longitude: v.lon,
            ...(v.bearing !== undefined ? { bearing: v.bearing } : {}),
            ...(v.speed !== undefined ? { speed: v.speed } : {}),
          },
        } : {}),
        ...(v.timestamp ? { timestamp: Math.floor(v.timestamp / 1000) } : {}),
        ...(v.stopId ? { stopId: v.stopId } : {}),
        ...(v.seq !== undefined ? { currentStopSequence: v.seq } : {}),
        ...(v.status ? { currentStatus: v.status } : {}),
      },
    })),
  });
}

/**
 * Flux SIRI Lite Estimated Timetable (XML) au format SIRI 2 : `journeys` = [{ number,
 * frameDate, datedRef, numberTag (false : pas de TrainNumberRef), calls: [{ uic,
 * aimedDep, aimedArr (ms), dep, arr (voies), recorded }] }]. `prefix` : espace de noms
 * préfixé (« siri: ») pour vérifier la tolérance du lecteur.
 */
function siriEtFeed(journeys, { prefix = '' } = {}) {
  const t = (name, v) => (v === undefined || v === null ? '' : `<${prefix}${name}>${v}</${prefix}${name}>`);
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  const call = (c, i) => {
    const tag = c.recorded ? 'RecordedCall' : 'EstimatedCall';
    return `<${prefix}${tag}>${t('StopPointRef', `FR:ScheduledStopPoint::${c.uic}:`)}${t('Order', i + 1)}`
      + `${t('AimedArrivalTime', iso(c.aimedArr))}${t('ArrivalPlatformName', c.arr)}`
      + `${t('AimedDepartureTime', iso(c.aimedDep))}${t('DeparturePlatformName', c.dep)}</${prefix}${tag}>`;
  };
  const evj = (j) => `<${prefix}EstimatedVehicleJourney>${t('LineRef', 'FR:Line::K44:')}`
    + `<${prefix}FramedVehicleJourneyRef>${t('DataFrameRef', j.frameDate)}${t('DatedVehicleJourneyRef', j.datedRef ?? `SNCF:VehicleJourney::${j.number}_F:LOC`)}</${prefix}FramedVehicleJourneyRef>`
    + (j.numberTag === false ? '' : `<${prefix}TrainNumbers>${t('TrainNumberRef', j.number)}</${prefix}TrainNumbers>`)
    + `<${prefix}RecordedCalls>${(j.calls ?? []).filter((c) => c.recorded).map(call).join('')}</${prefix}RecordedCalls>`
    + `<${prefix}EstimatedCalls>${(j.calls ?? []).filter((c) => !c.recorded).map(call).join('')}</${prefix}EstimatedCalls>`
    + `</${prefix}EstimatedVehicleJourney>`;
  const ns = prefix ? ` xmlns:${prefix.slice(0, -1)}="http://www.siri.org.uk/siri"` : ' xmlns="http://www.siri.org.uk/siri"';
  return `<?xml version="1.0" encoding="UTF-8"?><${prefix}Siri${ns} version="2.0"><${prefix}ServiceDelivery>`
    + `<${prefix}EstimatedTimetableDelivery><${prefix}EstimatedJourneyVersionFrame>${journeys.map(evj).join('\n')}`
    + `</${prefix}EstimatedJourneyVersionFrame></${prefix}EstimatedTimetableDelivery></${prefix}ServiceDelivery></${prefix}Siri>`;
}

/** Date locale (Europe/Paris) d'un instant. */
function parisDate(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Instant (ms) d'une heure locale de Paris « AAAA-MM-JJ HH:MM ». */
function parisTime(ymd, hhmm) {
  const guess = Date.parse(`${ymd}T${hhmm}:00Z`);
  for (const off of [1, 2]) {
    const ms = guess - off * 3600_000;
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
    if (local === hhmm) return ms;
  }
  throw new Error(`heure introuvable ${ymd} ${hhmm}`);
}

module.exports = {
  ST, LINES, area, point, tripId, buildGtfs, zipFiles, tripUpdatesFeed, alertsFeed, vehiclesFeed, siriEtFeed, addDays, parisDate, parisTime,
};
