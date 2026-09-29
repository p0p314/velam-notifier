// Appareils connectés et export des données — logique pure (sans React).

const pad = (n) => String(n).padStart(2, "0");
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** « à l'instant », « aujourd'hui à 14:05 », « hier à 08:10 », « le 12/09 ». */
export function fmtLastSeen(ms, now = new Date()) {
  const d = new Date(ms);
  if (now - d < 2 * 60_000) return "à l'instant";
  if (sameDay(d, now)) return `aujourd'hui à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `hier à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `le ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${d.getFullYear() !== now.getFullYear() ? `/${d.getFullYear()}` : ""}`;
}

/** Nom du fichier d'export : velopulse-mes-donnees-AAAA-MM-JJ.json. */
export function exportFileName(now = new Date()) {
  return `velopulse-mes-donnees-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Propose le téléchargement d'un objet en fichier JSON lisible. */
export function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
