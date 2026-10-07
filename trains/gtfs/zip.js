// Lecture d'une archive ZIP (dataset GTFS) sans dépendance : répertoire central +
// décompression en flux (zlib natif). Un fichier de l'archive n'est jamais chargé
// entier en mémoire : stop_times.txt du flux SNCF fait ~85 Mo décompressé.
const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;   // fin du répertoire central
const CDIR_SIG = 0x02014b50;   // entrée du répertoire central
const LOCAL_SIG = 0x04034b50;  // en-tête local d'un fichier

/** Localise la fin du répertoire central (commentaire d'archive ≤ 64 Ko). */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('ZIP invalide : fin du répertoire central introuvable');
}

/**
 * Entrées de l'archive : { name, method, compressedSize, size, offset }.
 * Les archives ZIP64 (> 4 Go ou > 65 535 fichiers) ne sont pas prises en charge :
 * un dataset GTFS en est très loin.
 */
function listEntries(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff || count === 0xffff) throw new Error('ZIP64 non pris en charge');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CDIR_SIG) throw new Error('ZIP invalide : répertoire central corrompu');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Données compressées d'une entrée (après son en-tête local). */
function rawData(buf, entry) {
  const p = entry.offset;
  if (buf.readUInt32LE(p) !== LOCAL_SIG) throw new Error(`ZIP invalide : en-tête local de ${entry.name}`);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  return buf.subarray(start, start + entry.compressedSize);
}

/**
 * Flux lisible du contenu décompressé d'une entrée (méthodes 0 « stored » et
 * 8 « deflate », les seules utilisées en pratique).
 */
function entryStream(buf, entry) {
  const data = rawData(buf, entry);
  const { Readable } = require('stream');
  if (entry.method === 0) return Readable.from([data]);
  if (entry.method !== 8) throw new Error(`ZIP : méthode de compression ${entry.method} non prise en charge (${entry.name})`);
  const inflate = zlib.createInflateRaw();
  inflate.end(data);
  return inflate;
}

/**
 * Ouvre une archive en mémoire. Les noms sont ramenés au nom de fichier (certains
 * producteurs placent les .txt dans un sous-dossier).
 */
function openZip(buf) {
  const entries = new Map();
  for (const e of listEntries(buf)) {
    if (e.name.endsWith('/')) continue;
    entries.set(e.name.split('/').pop(), e);
  }
  return {
    has: (name) => entries.has(name),
    names: () => [...entries.keys()],
    stream: (name) => entryStream(buf, entries.get(name)),
  };
}

module.exports = { openZip };
