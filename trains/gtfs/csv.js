// Lecture CSV en flux (RFC 4180 : guillemets, virgules et sauts de ligne échappés,
// BOM UTF-8). Appelle `onRow(row)` pour chaque ligne, `row` étant un objet
// { colonne: valeur } — seules les colonnes demandées (`columns`) sont extraites,
// pour limiter les allocations sur les gros fichiers (stop_times.txt).

/**
 * Découpe une ligne CSV complète en champs. `line` ne contient pas de saut de
 * ligne hors guillemets (garanti par l'appelant).
 */
function splitLine(line) {
  if (line.indexOf('"') === -1) return line.split(',');
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Nombre de guillemets d'une chaîne (une ligne est complète si ce nombre est pair). */
function quoteCount(s) {
  let n = 0;
  for (let i = s.indexOf('"'); i !== -1; i = s.indexOf('"', i + 1)) n++;
  return n;
}

/**
 * Lit un flux CSV. `columns` : colonnes à extraire (les absentes valent '').
 * Résout quand le flux est terminé ; rejette sur erreur de flux.
 */
function parseCsvStream(stream, columns, onRow) {
  return new Promise((resolve, reject) => {
    let header = null;
    let indexes = null;
    let rest = '';
    let pending = ''; // ligne entamée dont un champ entre guillemets contient un saut de ligne
    let first = true;

    const handle = (rawLine) => {
      let line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (pending) { line = pending + '\n' + line; pending = ''; }
      if (line.indexOf('"') !== -1 && quoteCount(line) % 2 === 1) { pending = line; return; }
      if (first) {
        first = false;
        if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
        header = splitLine(line).map((h) => h.trim());
        indexes = columns.map((c) => header.indexOf(c));
        return;
      }
      if (line === '') return;
      const f = splitLine(line);
      const row = {};
      for (let i = 0; i < columns.length; i++) {
        const idx = indexes[i];
        row[columns[i]] = idx === -1 ? '' : (f[idx] ?? '').trim();
      }
      onRow(row);
    };

    stream.setEncoding?.('utf8');
    let failed = false;
    stream.on('data', (chunk) => {
      if (failed) return;
      try {
        const text = rest + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        let start = 0;
        for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', start)) {
          handle(text.slice(start, nl));
          start = nl + 1;
        }
        rest = text.slice(start);
      } catch (err) {
        // Jamais d'exception hors de la promesse (elle ferait tomber le serveur).
        failed = true;
        stream.destroy?.();
        reject(err);
      }
    });
    stream.on('end', () => {
      if (failed) return;
      try {
        if (rest || pending) handle(rest);
        resolve(header ?? []);
      } catch (err) { reject(err); }
    });
    stream.on('error', reject);
  });
}

/** Variante synchrone pour un petit texte (tests, petits fichiers). */
function parseCsvText(text, columns) {
  const rows = [];
  const { Readable } = require('stream');
  return parseCsvStream(Readable.from([text]), columns, (r) => rows.push(r)).then(() => rows);
}

module.exports = { parseCsvStream, parseCsvText, splitLine };
