// Choix des jours de la semaine (au moins un reste coché). Alertes vélos et trains.

const DAYS = [
  { label: "Lu", value: 1 }, { label: "Ma", value: 2 }, { label: "Me", value: 3 },
  { label: "Je", value: 4 }, { label: "Ve", value: 5 }, { label: "Sa", value: 6 },
  { label: "Di", value: 7 },
];

const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

export default function DayPicker({ value, onChange }) {
  const toggle = (day) => {
    if (value.includes(day) && value.length === 1) return;
    const next = value.includes(day) ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.sort((a, b) => a - b));
  };
  return (
    <div className="day-picker" role="group" aria-label="Jours">
      {DAYS.map(({ label, value: day }) => (
        <button key={day} type="button" aria-pressed={value.includes(day)} aria-label={DAY_NAMES[day - 1]}
          className={value.includes(day) ? "active" : ""} onClick={() => toggle(day)}>
          {label}
        </button>
      ))}
    </div>
  );
}
