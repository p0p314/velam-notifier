import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  MAPBOX_TOKEN, DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE,
  bikeCountForType, availabilityLevel,
} from "../../lib/mapConfig";

mapboxgl.accessToken = MAPBOX_TOKEN;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Contenu HTML du popup station (nom, vélos dispo, places, détail par type). */
function popupHTML(s) {
  const offline = s.is_renting === false;
  const elec = s.electrical ?? 0;
  const meca = s.mechanical ?? 0;
  const total = elec + meca;
  const docks = s.docks_available ?? 0;
  if (offline) {
    return `<div class="sp"><div class="sp-name">${esc(s.name)}</div>
      <div class="sp-off">Hors service</div></div>`;
  }
  return `<div class="sp">
    <div class="sp-name">${esc(s.name)}</div>
    ${s.address ? `<div class="sp-addr">${esc(s.address)}</div>` : ""}
    <div class="sp-total"><b>${total}</b> vélo${total !== 1 ? "s" : ""} · <b>${docks}</b> place${docks !== 1 ? "s" : ""}</div>
    <div class="sp-rows">
      <span class="sp-chip elec"><i></i> ${elec} élec.</span>
      <span class="sp-chip meca"><i></i> ${meca} méca.</span>
    </div>
  </div>`;
}

/**
 * Carte Mapbox des stations. Composant contrôlé par `stations` (déjà filtrées)
 * et `filterType` (couleur des markers). Markers diffés (créés une fois, mis à
 * jour en place) → pas de recréation à chaque rafraîchissement API.
 */
export default function StationMap({ stations, filterType = "all" }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // station_id → { marker, el, station }
  const popupRef = useRef(null);

  // ── Init unique ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current || !MAPBOX_TOKEN) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    // Bouton « Me géolocaliser » natif : permissions + marker utilisateur + fallback.
    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      showUserHeading: true,
      showAccuracyCircle: true,
    }), "top-right");

    popupRef.current = new mapboxgl.Popup({ offset: 18, closeButton: true, className: "map-popup" });
    mapRef.current = map;

    // La carte fige la taille du canvas à l'init : si le conteneur n'a pas encore
    // sa largeur finale (navbar fixe + contenu centré desktop, rotation mobile…),
    // on force un recalcul au load et à chaque changement de taille du conteneur.
    map.on("load", () => map.resize());
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); map.remove(); mapRef.current = null; markersRef.current.clear(); };
  }, []);

  // ── Synchro des markers (création / mise à jour / suppression) ─────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set();

    for (const s of stations) {
      if (s.lat == null || s.lon == null) continue;
      seen.add(s.station_id);
      const count = bikeCountForType(s, filterType);
      const level = availabilityLevel(count, s.is_renting === false);

      let entry = markersRef.current.get(s.station_id);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.classList.add("map-marker");
        entry = { el, station: s };
        // Lit toujours la dernière station via l'objet entry (pas de closure obsolète).
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const st = entry.station;
          popupRef.current.setLngLat([st.lon, st.lat]).setHTML(popupHTML(st)).addTo(map);
          map.flyTo({ center: [st.lon, st.lat], zoom: Math.max(map.getZoom(), 14), speed: 0.8 });
        });
        entry.marker = new mapboxgl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
        markersRef.current.set(s.station_id, entry);
      }

      entry.station = s;
      entry.marker.setLngLat([s.lon, s.lat]);
      // classList (pas className=) pour ne PAS écraser la classe `mapboxgl-marker`
      // ajoutée par Mapbox — sinon le marker perd son ancrage absolu et dérive.
      entry.el.classList.remove("level-ok", "level-warn", "level-danger", "level-off");
      entry.el.classList.add(`level-${level}`);
      entry.el.textContent = level === "off" ? "" : String(count);
      entry.el.setAttribute("aria-label", `${s.name} : ${count} vélo(s) disponible(s)`);
    }

    // Retire les markers absents du jeu courant (filtrés ou disparus).
    for (const [id, entry] of markersRef.current) {
      if (!seen.has(id)) { entry.marker.remove(); markersRef.current.delete(id); }
    }
  }, [stations, filterType]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="map-missing-token">
        <div className="empty-title">Carte indisponible</div>
        <div className="empty-sub">Le token Mapbox (<code>VITE_MAPBOX_TOKEN</code>) n'est pas configuré.</div>
      </div>
    );
  }

  return <div ref={containerRef} className="map-container" />;
}
