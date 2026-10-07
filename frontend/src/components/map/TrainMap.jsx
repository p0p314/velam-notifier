import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN, DEFAULT_CENTER, DEFAULT_ZOOM, mapStyleFor } from "../../lib/mapConfig";
import { routeGeoJSON, stationsGeoJSON, stopPopup, initialView } from "../../lib/trainMap";
import { esc, popupHTML } from "./StationMap";
import {
  TrainRoutesLayer, RailwayStationsLayer, BikeStationsLayer, createTrainPositionsLayer,
  bikeStationsGeoJSON, cssColor,
} from "./layers";

mapboxgl.accessToken = MAPBOX_TOKEN;

/** Popup d'une gare : nom, horaires prévus / estimés, retard, statut. */
function stopPopupHTML(p) {
  const rows = p.rows.map((r) => `<div class="tp-row"><span>${esc(r.label)}</span>
    <b class="${r.estimated ? "old" : ""}">${esc(r.scheduled)}</b>${r.estimated ? ` <b class="t-est">${esc(r.estimated)}</b>` : ""}</div>`).join("");
  return `<div class="sp">
    <div class="sp-name">${esc(p.name)}</div>
    ${p.status ? `<div class="tp-status">${esc(p.status)}</div>` : ""}
    ${rows ? `<div class="tp-rows">${rows}</div>` : ""}
    ${p.delay ? `<div class="tp-delay">${esc(p.delay)}</div>` : ""}
  </div>`;
}

/**
 * Carte d'un train : tracé (portion du voyageur en couleur de ligne), gares
 * cliquables, position du train si le fournisseur la publie, stations Vélam en
 * option. Les couches sont mises à jour en place (setData) et réinstallées après
 * un changement de thème. Méthodes exposées : fitRoute(), focusTrain().
 */
const TrainMap = forwardRef(function TrainMap({ route, journey, position, bikeStations = null, theme = "light" }, ref) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const trainLayer = useRef(null);
  const latest = useRef({});
  const framed = useRef(false);
  const [styleSeq, setStyleSeq] = useState(0); // incrémenté à chaque style chargé

  latest.current = { ...latest.current, route, journey, position };

  // ── Init unique ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current || !MAPBOX_TOKEN) return undefined;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: mapStyleFor(theme),
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM - 4,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true, className: "map-popup" });
    trainLayer.current = createTrainPositionsLayer();
    mapRef.current = map;

    map.on("style.load", () => setStyleSeq((n) => n + 1));
    map.on("load", () => map.resize());
    // Gares : popup au clic (lit les dernières données, pas de closure figée).
    map.on("click", "railway-stations", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const { journey: j, position: p, route: r } = latest.current;
      const html = stopPopupHTML(stopPopup(j, p?.progress ?? null, r, f.properties.index));
      popupRef.current.setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
    });
    map.on("click", "bike-stations", (e) => {
      const id = e.features?.[0]?.properties.id;
      const s = latest.current.bikes?.find((x) => String(x.station_id) === String(id));
      if (s) popupRef.current.setLngLat([s.lon, s.lat]).setHTML(popupHTML(s)).addTo(map);
    });
    for (const layer of ["railway-stations", "bike-stations"]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); trainLayer.current?.remove(); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Thème : nouveau fond, les couches GL sont réinstallées au style.load ──
  const styleRef = useRef(mapStyleFor(theme));
  useEffect(() => {
    const map = mapRef.current;
    const next = mapStyleFor(theme);
    if (!map || styleRef.current === next) return;
    styleRef.current = next;
    // Sans diff : un style rechargé entièrement émet « style.load » (couches
    // réinstallées) ; avec diff, Mapbox retirerait nos couches sans prévenir.
    map.setStyle(next, { diff: false });
  }, [theme]);

  // ── Tracé + gares ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleSeq || !route) return;
    const color = journey?.line?.color ? `#${journey.line.color}` : route.line?.color ? `#${route.line.color}` : cssColor("--accent", "#2C66E0");
    TrainRoutesLayer.apply(map, { geo: routeGeoJSON(route), color, approx: route.geometrySource === "stops" });
    RailwayStationsLayer.apply(map, { data: stationsGeoJSON(route, journey, position?.progress ?? null), color });
  }, [styleSeq, route, journey, position]);

  // ── Stations Vélam (facultatif) ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    latest.current.bikes = bikeStations;
    if (!map || !styleSeq) return;
    if (!bikeStations && !map.getLayer("bike-stations")) return;
    BikeStationsLayer.apply(map, { data: bikeStationsGeoJSON(bikeStations ?? []) });
  }, [styleSeq, bikeStations]);

  // ── Position du train ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const label = [journey?.line?.name, journey?.trainNumber && `n° ${journey.trainNumber}`].filter(Boolean).join(" ") || "Train";
    trainLayer.current?.update(map, position?.vehicle ?? null, { label });
  }, [position, journey]);

  // ── Cadrage initial (une fois) : le train s'il est localisé, sinon le trajet ─
  const frame = (view, animate = true) => {
    const map = mapRef.current;
    if (!map || !view) return;
    if (view.center) map.flyTo({ center: view.center, zoom: view.zoom, speed: 1.2, animate });
    else map.fitBounds(view.bounds, { padding: 48, maxZoom: 13, animate, duration: animate ? 700 : 0 });
  };
  useEffect(() => {
    if (framed.current || !route || !journey || !mapRef.current || !styleSeq) return;
    framed.current = true;
    frame(initialView(route, position), false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, journey, styleSeq]);

  useImperativeHandle(ref, () => ({
    fitRoute: () => frame(initialView(latest.current.route, null)),
    focusTrain: () => frame(initialView(latest.current.route, latest.current.position)),
  }));

  if (!MAPBOX_TOKEN) {
    return (
      <div className="map-missing-token">
        <div className="empty-title">Carte indisponible</div>
        <div className="empty-sub">Le token Mapbox (<code>VITE_MAPBOX_TOKEN</code>) n'est pas configuré.</div>
      </div>
    );
  }
  return <div ref={containerRef} className="map-container train-map" />;
});

export default TrainMap;
