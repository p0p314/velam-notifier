// Nom lisible d'un appareil à partir de son user-agent (« iPhone · Safari »).
// Indicatif seulement : sert à reconnaître ses appareils dans les Paramètres.

const SYSTEMS = [
  [/iPhone/i, 'iPhone'],
  [/iPad/i, 'iPad'],
  [/Android/i, 'Android'],
  [/Windows/i, 'Windows'],
  [/Macintosh|Mac OS X/i, 'Mac'],
  [/CrOS/i, 'Chromebook'],
  [/Linux/i, 'Linux'],
];
// Ordre important : Edge / Opera / Samsung se déclarent aussi « Chrome », Chrome aussi « Safari ».
const BROWSERS = [
  [/Edg\//i, 'Edge'],
  [/OPR\/|Opera/i, 'Opera'],
  [/SamsungBrowser/i, 'Samsung Internet'],
  [/Firefox\/|FxiOS/i, 'Firefox'],
  [/Chrome\/|CriOS/i, 'Chrome'],
  [/Safari\//i, 'Safari'],
];

function describeDevice(userAgent) {
  const ua = userAgent ?? '';
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  if (!system && !browser) return 'Appareil inconnu';
  return [system, browser].filter(Boolean).join(' · ');
}

module.exports = { describeDevice };
