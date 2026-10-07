// Module Trains — boucle d'alerte : déclenchement, idempotence (aucun doublon),
// paliers de retard, suppression, perturbations de ligne, données périmées.
// Base réelle, faux flux SNCF, faux web-push ; heure injectée.
const { resetDb, sncf, resetSncf, fakeSubscription } = require('./helpers');
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { getProvider } = require('../trains');
const { checkTrainAlerts, tripEvents, cleanAlertText } = require('../trains/alertLoop');
const {
  createUser, addSubscription, addTrainFavorite, createTrainAlert, setAlertsPause, recordTrainNotification, updateTrainAlert,
  setNotificationPrefs,
} = require('../db');
const { buildGtfs, tripUpdatesFeed, alertsFeed, area, LINES, tripId, parisTime } = require('./trainsFixture');

const START = '2026-10-05';
const D = '2026-10-07'; // mercredi
const T1 = tripId('843924', LINES.K44, 'LILLE', 'AMIENS', '2026-11-03');
const at = (hhmm, date = D) => new Date(parisTime(date, hhmm));

let sent;
webpush.sendNotification = async (sub, payload) => { sent.push(JSON.parse(payload)); };

const provider = getProvider();
let userId;
let favorite;

beforeEach(async () => {
  await resetDb();
  resetSncf();
  sent = [];
  await provider.schedule.loadFiles(buildGtfs({ start: START, days: 30 }));
  ({ id: userId } = await createUser(`u${Date.now()}`, 'hash'));
  await addSubscription(userId, fakeSubscription('tel'));
  const index = provider.schedule.getIndex();
  const j = (await provider.service.searchJourneys({ from: area('LILLE'), to: area('AMIENS'), date: D }, { now: +at('08:00') })).journeys[0];
  assert.ok(index && j.trainNumber === '843924');
  favorite = await addTrainFavorite(userId, provider.service.favoriteFromJourney(j.id));
  // La recherche ci-dessus a interrogé le temps réel : on repart de zéro.
  provider.realtime.reset();
  sncf.calls.tripUpdates = 0;
});

/** Temps réel du 16:53 (retard au départ en minutes, ou supprimé) publié à `when`. */
function rtFor(when, { delayMin = null, cancelled = false, alerts = [] } = {}) {
  // Nouveau flux publié : on oublie le précédent. Le cache des tests dure 1 ms d'horloge
  // réelle ; deux cycles dans la même milliseconde (machine rapide) reliraient sinon l'ancien.
  provider.realtime.reset();
  const updates = [];
  if (cancelled) updates.push({ tripId: 'OCESN843924F', startDate: D, relationship: 'CANCELED' });
  else if (delayMin !== null) updates.push({ tripId: T1, startDate: D, stops: [{ seq: 0, dep: delayMin * 60 }] });
  sncf.tripUpdates = tripUpdatesFeed(updates, +when);
  sncf.alerts = alertsFeed(alerts, +when);
}

const tripAlert = (fields = {}) => createTrainAlert(userId, {
  scope: 'trip', favorite_id: favorite.id, delay_threshold: 10, on_cancel: true, on_disruption: true, ...fields,
});

async function cycle(hhmm, rt = {}, date = D) {
  const when = at(hhmm, date);
  rtFor(when, rt);
  return checkTrainAlerts(when);
}

describe('alerte de trajet', () => {
  test('aucune alerte active : rien n\'est téléchargé', async () => {
    assert.equal(await checkTrainAlerts(at('16:30')), 'aucune_alerte');
    assert.equal(sncf.calls.tripUpdates, 0);
  });

  test('hors fenêtre (plus de 3 h avant le départ) : pas due, aucun appel temps réel', async () => {
    await tripAlert();
    assert.equal(await cycle('10:00', { delayMin: 30 }), 'aucune_due');
    assert.equal(sncf.calls.tripUpdates, 0);
    assert.equal(sent.length, 0);
  });

  test('jour où le train ne circule pas (samedi) : pas due', async () => {
    await tripAlert();
    assert.equal(await cycle('16:30', { delayMin: 30 }, '2026-10-10'), 'aucune_due');
  });

  test('jour exclu par l\'utilisateur : pas due', async () => {
    await tripAlert({ days: '1,2,4,5' }); // pas le mercredi
    assert.equal(await cycle('16:30', { delayMin: 30 }), 'aucune_due');
  });

  test('retard sous le seuil : rien', async () => {
    await tripAlert();
    assert.equal(await cycle('16:30', { delayMin: 5 }), 'verifiees');
    assert.equal(sent.length, 0);
  });

  test('retard ≥ seuil : une notification, puis aucun doublon pour le même retard', async () => {
    await tripAlert();
    await cycle('16:30', { delayMin: 12 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'K44 16:53 Lille Flandres → Amiens · +12 min');
    assert.equal(sent[0].body, 'Départ 17:05 au lieu de 16:53 · arrivée 18:22');
    assert.match(sent[0].url, /\/trains\/trajet\?id=/);
    await cycle('16:31', { delayMin: 12 });
    await cycle('16:32', { delayMin: 14 }); // même palier (10-19 min)
    assert.equal(sent.length, 1);
  });

  test('retard qui s\'aggrave d\'un palier (+10 min) : nouvelle notification', async () => {
    await tripAlert();
    await cycle('16:30', { delayMin: 12 });
    await cycle('16:40', { delayMin: 21 });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].title, 'K44 16:53 Lille Flandres → Amiens · +21 min');
  });

  test('retard qui disparaît : « retard résorbé », une seule fois', async () => {
    await tripAlert();
    await cycle('16:30', { delayMin: 12 });
    await cycle('16:40', { delayMin: 1 });
    await cycle('16:41', { delayMin: 0 });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].title, "K44 16:53 Lille Flandres → Amiens · À l'heure");
    assert.equal(sent[1].body, 'Retard rattrapé : départ 16:54, arrivée 18:11');
  });

  test('« retard résorbé » jamais envoyé sans retard notifié auparavant', async () => {
    await tripAlert();
    await cycle('16:30', { delayMin: 0 });
    assert.equal(sent.length, 0);
  });

  test('train supprimé : une notification, puis plus rien', async () => {
    await tripAlert();
    await cycle('16:00', { cancelled: true });
    await cycle('16:01', { cancelled: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'K44 16:53 Lille Flandres → Amiens · Supprimé');
    assert.equal(sent[0].body, 'Ce train ne circulera pas.');
  });

  test('suppression non suivie (on_cancel = false) : rien', async () => {
    await tripAlert({ on_cancel: false });
    await cycle('16:00', { cancelled: true });
    assert.equal(sent.length, 0);
  });

  test('sans donnée temps réel pour ce train : rien (jamais « supprimé » par défaut)', async () => {
    await tripAlert();
    assert.equal(await cycle('16:30'), 'verifiees');
    assert.equal(sent.length, 0);
  });

  test('temps réel indisponible ou trop ancien : cycle ignoré', async () => {
    await tripAlert();
    sncf.failRealtime = true;
    assert.equal(await checkTrainAlerts(at('16:30')), 'donnees_perimees');
    sncf.failRealtime = false;
    provider.realtime.reset();
    sncf.tripUpdates = tripUpdatesFeed([{ tripId: T1, startDate: D, stops: [{ seq: 0, dep: 1200 }] }], +at('16:00'));
    sncf.alerts = alertsFeed([], +at('16:00'));
    assert.equal(await checkTrainAlerts(at('16:30')), 'donnees_perimees');
    assert.equal(sent.length, 0);
  });

  test('perturbation sur le train : une notification par perturbation', async () => {
    await tripAlert({ delay_threshold: null, on_cancel: false });
    const alerts = [{ id: 'SA-1', header: 'Retard dû à un incident technique', tripId: 'OCESN843924F', effect: 'SIGNIFICANT_DELAYS' }];
    await cycle('16:00', { alerts });
    await cycle('16:01', { alerts });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'K44 16:53 Lille Flandres → Amiens · Perturbé');
    assert.equal(sent[0].body, 'Cause : incident technique\nRetard dû à un incident technique');
  });

  test('compte en pause : rien', async () => {
    await tripAlert();
    await setAlertsPause(userId, '2026-10-09');
    assert.equal(await cycle('16:30', { delayMin: 30 }), 'aucune_due');
    assert.equal(sent.length, 0);
  });

  test('notifications trains coupées pour le compte : rien (les vélos ne sont pas concernés)', async () => {
    await tripAlert();
    await setNotificationPrefs(userId, { bikes: false });
    await cycle('16:30', { delayMin: 30 });
    assert.equal(sent.length, 1);
    await setNotificationPrefs(userId, { trains: false });
    assert.equal(await cycle('16:50', { delayMin: 45 }), 'aucune_due');
    assert.equal(sent.length, 1);
  });

  test('alerte désactivée : rien', async () => {
    const a = await tripAlert();
    await updateTrainAlert(userId, a.id, { active: false });
    assert.equal(await cycle('16:30', { delayMin: 30 }), 'aucune_alerte');
  });

  test('train arrivé : plus aucune notification', async () => {
    await tripAlert();
    assert.equal(await cycle('18:30', { delayMin: 0 }), 'verifiees');
    provider.realtime.reset();
    sncf.tripUpdates = tripUpdatesFeed([{ tripId: T1, startDate: D, stops: [{ seq: 4, arr: 900 }] }], +at('18:40'));
    sncf.alerts = alertsFeed([], +at('18:40'));
    await checkTrainAlerts(at('18:40')); // arrivée estimée 18:25 dépassée
    assert.equal(sent.length, 0);
  });
});

describe('alerte de ligne', () => {
  const lineAlert = (fields = {}) => createTrainAlert(userId, {
    scope: 'line', provider: 'sncf', line_id: LINES.K44, line_name: 'K44', line_long_name: 'Lille Flandres - Amiens',
    on_disruption: true, on_cancel: true, ...fields,
  });

  test('perturbation importante sur la ligne : une seule notification par perturbation', async () => {
    await lineAlert();
    const alerts = [
      { id: 'W', header: 'Travaux : trains remplacés par des cars entre Arras et Amiens', routeId: LINES.K44, effect: 'MODIFIED_SERVICE' },
      { id: 'INFO', header: 'Ascenseur en panne', routeId: LINES.K44, effect: 'ACCESSIBILITY_ISSUE' },
      { id: 'OTHER', header: 'Autre ligne', routeId: LINES.K45, effect: 'NO_SERVICE' },
    ];
    await cycle('09:00', { alerts });
    await cycle('09:01', { alerts });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'Ligne K44 · Perturbation');
    assert.match(sent[0].body, /Travaux/);
  });

  test('perturbation désignant un train de la ligne (identifiant interne) : notifiée', async () => {
    await lineAlert({ on_cancel: false });
    await cycle('09:00', { alerts: [{ id: 'TR', header: 'Train 843924 supprimé', tripId: 'OCESN843924F', effect: 'NO_SERVICE' }] });
    assert.equal(sent.length, 1);
  });

  test('train de la ligne supprimé : notifié une fois', async () => {
    await lineAlert({ on_disruption: false });
    await cycle('09:00', { cancelled: true });
    await cycle('09:30', { cancelled: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'Ligne K44 · Train supprimé');
    assert.equal(sent[0].body, '16:53 Lille Flandres → Amiens (n° 843924) ne circulera pas.');
  });

  test('hors créneau horaire : pas due', async () => {
    await lineAlert({ time_start: '06:00', time_end: '08:00' });
    assert.equal(await cycle('09:00', { cancelled: true }), 'aucune_due');
    assert.equal(sent.length, 0);
  });
});

describe('idempotence', () => {
  test('journal : un même événement ne peut être enregistré qu\'une fois', async () => {
    const a = await createTrainAlert(userId, { scope: 'trip', favorite_id: favorite.id, on_cancel: true });
    assert.equal(await recordTrainNotification(userId, a.id, 'cancel:2026-10-07', 'cancel'), true);
    assert.equal(await recordTrainNotification(userId, a.id, 'cancel:2026-10-07', 'cancel'), false);
    assert.equal(await recordTrainNotification(userId, a.id, 'cancel:2026-10-08', 'cancel'), true);
  });

  test('tripEvents (pur) : clés d\'événement datées et par palier', () => {
    const base = { serviceDate: D, realtime: true, status: 'delayed', alerts: [], departureDelay: 23, arrivalDelay: 25 };
    const ev = tripEvents({ delay_threshold: 10, on_cancel: true, on_disruption: false }, base);
    assert.deepEqual(ev.map((e) => e.key), [`delay:${D}:20`]);
    const theoretical = tripEvents({ delay_threshold: 10, on_cancel: true }, { ...base, realtime: false, status: 'scheduled' });
    assert.deepEqual(theoretical, []);
  });
});

describe('texte des notifications', () => {
  test('texte SNCF : lignes génériques et liens retirés, longueur bornée', () => {
    assert.equal(cleanAlertText({
      header: 'Trafic perturbé entre Arras et Amiens',
      description: "Plus d'informations : https://www.ter.sncf.com/hauts-de-france\nTrafic perturbé entre Arras et Amiens",
    }), 'Trafic perturbé entre Arras et Amiens');
    assert.equal(cleanAlertText({ header: "Plus d'informations :", description: null }), null);
    assert.equal(cleanAlertText({ header: 'x'.repeat(300) }).length, 140);
  });
});
