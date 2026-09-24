// Heure « métier » des alertes. Les horaires (HH:MM, jours) sont saisis en heure
// locale d'Amiens ; le serveur (Render) tourne en UTC → tout est évalué dans ALERT_TZ.

const ALERT_TZ = process.env.ALERT_TZ || 'Europe/Paris';

const ISO_DAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * Heure courante dans le fuseau des alertes : { hhmm, isoDay (1=lundi…7), date }.
 * Corrige le décalage UTC qui faisait déclencher les alertes avec +1/+2 h.
 */
function nowInTz(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ALERT_TZ, hour12: false,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = get('hour');
  if (hour === '24') hour = '00'; // certains environnements rendent minuit en "24"
  return {
    hhmm:   `${hour}:${get('minute')}`,
    isoDay: ISO_DAY[get('weekday')],
    date:   `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** Gère aussi les créneaux qui passent minuit (start > end). */
function inWindow(now, start, end) {
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

/** Ajoute `n` jours à une date YYYY-MM-DD (calcul calendaire, sans fuseau). */
function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { ALERT_TZ, nowInTz, inWindow, addDays };
