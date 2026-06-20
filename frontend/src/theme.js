// Palette et helpers partagés (thème sombre Vélam)

export const C = {
  bg: "#07090F", card: "#0C1422", border: "#15203A",
  elec: "#00C8FF", meca: "#FF9500",
  green: "#00D98B", amber: "#FFBB33", empty: "#2A3550",
  text: "#DDE6F5", muted: "#445270", dim: "#1C2A44",
};

export const bikeColor = (n) => (n === 0 ? C.empty : n <= 2 ? C.amber : C.green);

export function fmtTime(ts) {
  if (!ts || ts < 1_000_000_000) return null;
  return new Date(ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
