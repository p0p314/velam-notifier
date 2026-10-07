// Couches de la carte unifiée (vélos + trains). Chaque couche sait s'installer sur
// une carte Mapbox, se mettre à jour (setData, sans recréation) et se réinstaller
// après un changement de style (thème clair / sombre : setStyle efface les couches).
//
//   TrainRoutesLayer      tracé du trajet + portion du voyageur
//   RailwayStationsLayer  gares du trajet (cliquables)
//   TrainPositionsLayer   position du train (marker DOM : survit à setStyle)
//   BikeStationsLayer     stations Vélam (cercles colorés selon la disponibilité)
//
// La carte des stations (StationMap) garde ses markers DOM numérotés ; ces couches
// GL servent la carte d'un train et préparent une carte commune.
import mapboxgl from "mapbox-gl";
import { emptyFC } from "../../lib/trainMap";
import { bikeCountForType, availabilityLevel } from "../../lib/mapConfig";

/** Couleur d'une variable CSS du thème courant (Mapbox n'accepte pas var(--x)). */
export function cssColor(name, fallback) {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function upsertSource(map, id, data) {
  const src = map.getSource(id);
  if (src) src.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

function upsertLayer(map, layer, paint) {
  if (!map.getLayer(layer.id)) map.addLayer(layer);
  else for (const [k, v] of Object.entries(paint ?? {})) map.setPaintProperty(layer.id, k, v);
}

export const TrainRoutesLayer = {
  ids: ["train-route-full", "train-route-segment"],
  /** `geo` : { full, segment } (routeGeoJSON) ; `approx` : tracé de gare en gare (pointillés). */
  apply(map, { geo, color, approx }) {
    upsertSource(map, "train-route-full", geo?.full ?? emptyFC());
    upsertSource(map, "train-route-segment", geo?.segment ?? emptyFC());
    const muted = cssColor("--neutral-bar", "#8A8A82");
    const fullPaint = { "line-color": muted, "line-width": 3, "line-opacity": 0.55 };
    const segPaint = { "line-color": color, "line-width": 5 };
    upsertLayer(map, {
      id: "train-route-full", type: "line", source: "train-route-full",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { ...fullPaint, ...(approx ? { "line-dasharray": [1.5, 1.5] } : {}) },
    }, fullPaint);
    upsertLayer(map, {
      id: "train-route-segment", type: "line", source: "train-route-segment",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { ...segPaint, ...(approx ? { "line-dasharray": [2, 1] } : {}) },
    }, segPaint);
  },
};

export const RailwayStationsLayer = {
  ids: ["railway-stations", "railway-stations-label"],
  apply(map, { data, color }) {
    upsertSource(map, "railway-stations", data ?? emptyFC());
    // Libellés sur une source distincte : si les polices ne se chargent pas, seule
    // cette couche échoue, les gares restent affichées et cliquables.
    upsertSource(map, "railway-stations-label", data ?? emptyFC());
    const surface = cssColor("--surface", "#FFFFFF");
    const muted = cssColor("--neutral-bar", "#8A8A82");
    const danger = cssColor("--danger", "#C0413B");
    const accent = cssColor("--accent", "#2C66E0");
    const text = cssColor("--text", "#1B1B19");
    const paint = {
      "circle-radius": ["case", ["get", "key"], 7, ["==", ["get", "state"], "next"], 6.5, 5],
      "circle-color": ["match", ["get", "state"], "passed", muted, "skipped", surface, "next", accent, surface],
      "circle-stroke-width": ["case", ["get", "key"], 3, 2],
      "circle-stroke-color": ["match", ["get", "state"], "passed", muted, "skipped", danger, "next", surface, color],
    };
    upsertLayer(map, { id: "railway-stations", type: "circle", source: "railway-stations", paint }, paint);
    const labelPaint = { "text-color": text, "text-halo-color": surface, "text-halo-width": 1.5 };
    upsertLayer(map, {
      id: "railway-stations-label", type: "symbol", source: "railway-stations-label",
      layout: {
        "text-field": ["get", "label"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top",
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
      },
      paint: labelPaint,
    }, labelPaint);
  },
};

export const BikeStationsLayer = {
  ids: ["bike-stations"],
  /** Données GeoJSON des stations (bikeStationsGeoJSON) ; null = couche masquée. */
  apply(map, { data }) {
    upsertSource(map, "bike-stations", data ?? emptyFC());
    const colors = {
      ok: cssColor("--ok", "#16835A"), warn: cssColor("--warn", "#B26B0B"),
      danger: cssColor("--danger", "#C0413B"), off: cssColor("--text-3", "#8A8A82"),
    };
    const paint = {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 8],
      "circle-color": ["match", ["get", "level"], "ok", colors.ok, "warn", colors.warn, "danger", colors.danger, colors.off],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#FFFFFF",
    };
    // Sous les gares : les gares restent cliquables au-dessus.
    const before = map.getLayer("railway-stations") ? "railway-stations" : undefined;
    if (!map.getLayer("bike-stations")) map.addLayer({ id: "bike-stations", type: "circle", source: "bike-stations", paint }, before);
    else for (const [k, v] of Object.entries(paint)) map.setPaintProperty("bike-stations", k, v);
  },
};

/** Stations Vélam → GeoJSON (niveau de disponibilité comme les markers de la carte Vélos). */
export function bikeStationsGeoJSON(stations, type = "all") {
  if (!stations?.length) return emptyFC();
  return {
    type: "FeatureCollection",
    features: stations.filter((s) => s.lat != null && s.lon != null).map((s) => ({
      type: "Feature",
      properties: { id: s.station_id, level: availabilityLevel(bikeCountForType(s, type), s.is_renting === false) },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    })),
  };
}

/**
 * Position du train : marker DOM (pastille + flèche orientée selon le cap), grisé
 * quand la position est ancienne. Mis à jour en place, jamais recréé.
 */
export function createTrainPositionsLayer() {
  let marker = null;
  let el = null;
  return {
    update(map, vehicle, { label = "Train" } = {}) {
      if (!vehicle) {
        marker?.remove();
        marker = null;
        return;
      }
      if (!marker) {
        el = document.createElement("div");
        el.className = "train-marker";
        el.innerHTML = '<span class="train-marker-arrow" aria-hidden="true"></span><span class="train-marker-dot" aria-hidden="true"></span>';
        marker = new mapboxgl.Marker({ element: el }).setLngLat([vehicle.lon, vehicle.lat]).addTo(map);
      }
      marker.setLngLat([vehicle.lon, vehicle.lat]);
      el.classList.toggle("stale", !!vehicle.stale);
      const arrow = el.querySelector(".train-marker-arrow");
      arrow.style.display = vehicle.bearing == null ? "none" : "";
      if (vehicle.bearing != null) arrow.style.transform = `rotate(${vehicle.bearing}deg)`;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", vehicle.stale ? `${label} — position ancienne` : `${label} — position actuelle`);
    },
    remove() { marker?.remove(); marker = null; },
  };
}
