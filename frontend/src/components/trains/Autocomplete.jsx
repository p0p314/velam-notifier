import { useId, useState } from "react";
import Icon from "../Icon";
import { useSuggestions } from "../../trainHooks";

/**
 * Champ avec suggestions servies par le backend (gares ou lignes du GTFS, jamais
 * une liste en dur). `value` : élément choisi ({ id, name, … }) ou null ; taper
 * efface le choix. Clavier : ↑ ↓ pour parcourir, Entrée pour choisir, Échap pour fermer.
 */
export default function Autocomplete({ kind, label, placeholder, value, onChange, renderItem, icon = "search" }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const editing = value === null;
  const { items, loading } = useSuggestions(kind, text, { enabled: editing && open });

  const choose = (item) => {
    onChange(item);
    setText("");
    setOpen(false);
  };
  const onKeyDown = (e) => {
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[active] ?? items[0]); }
    else if (e.key === "Escape") setOpen(false);
  };

  const shown = open && editing && text.trim().length >= 2;
  return (
    <div className="ac">
      <div className="search-box ac-box">
        <Icon name={icon} />
        <input
          className="search-input"
          role="combobox"
          aria-label={label}
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={editing ? text : value.name}
          onChange={(e) => { if (!editing) onChange(null); setText(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        {!editing && (
          <button type="button" className="ac-clear" aria-label={`Effacer ${label.toLowerCase()}`} onClick={() => { onChange(null); setText(""); }}>
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
      {shown && (
        <ul className="ac-list" role="listbox" id={listId} aria-label={label}>
          {items.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === active}
              className={"ac-item" + (i === active ? " active" : "")}
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(item)}>
              {renderItem ? renderItem(item) : item.name}
            </li>
          ))}
          {!items.length && <li className="ac-empty">{loading ? "Recherche…" : "Aucun résultat"}</li>}
        </ul>
      )}
    </div>
  );
}
