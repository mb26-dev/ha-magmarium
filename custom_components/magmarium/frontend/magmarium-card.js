/*
 * Magmarium card - active volcanoes on a living globe.
 * https://github.com/mb26-dev/ha-magmarium
 */

import { DEG, ecef, viewFrame, sunDirection, loadEarth, renderEarth } from "./magmarium-earth.js";
import { LEVEL_COLORS, rgba, drawVolcano, drawPulse, AshPlume, Ejecta } from "./magmarium-art.js";
import { defineMapCards } from "./magmarium-maps.js";
import { ecoMode, setEco, reportSlow, onEcoChange, storedEco, perf } from "./magmarium-perf.js";

const VERSION = "0.2.1b1";
const LEVEL_NAMES = { 0: "Unknown", 1: "Normal", 2: "Advisory", 3: "Watch", 4: "Warning" };
const FILTERS = [
  ["all", "All"],
  ["erupting", "Erupting"],
  ["ash", "Ash clouds"],
  ["elevated", "Elevated"],
];
// Quick-select regions: key, chip label, view [lat, lon, zoom], box [latMin, latMax, lonMin, lonMax].
// A box whose lonMin is larger than lonMax crosses the antimeridian.
const REGIONS = [
  ["indonesia", "Indonesia", [-2.5, 118.0, 2.7], [-11.5, 6.5, 94, 142]],
  ["philippines", "Philippines", [12.0, 123.0, 4.2], [4, 21.5, 116, 128]],
  ["japan", "Japan", [35.5, 137.5, 3.6], [24, 46, 128, 147]],
  ["kamchatka", "Kamchatka & Kurils", [52.5, 157.5, 3.4], [43, 62, 145, 168]],
  ["alaska", "Alaska & Aleutians", [57.0, -160.0, 2.6], [50, 66, 165, -140]],
  ["cascades", "Cascades", [45.0, -121.5, 4.6], [38, 52, -126, -116]],
  ["hawaii", "Hawaii", [19.6, -155.6, 8.0], [18, 23, -161, -154]],
  ["central_america", "Mexico & Central America", [15.0, -92.0, 3.0], [7, 23, -106, -82]],
  ["caribbean", "Caribbean", [15.0, -62.0, 5.0], [11, 19, -66, -59]],
  ["andes", "Andes", [-20.0, -71.0, 1.9], [-56, 6, -82, -64]],
  ["iceland", "Iceland", [64.8, -18.5, 6.0], [62, 67.5, -25, -12]],
  ["atlantic", "Azores & Canaries", [32.0, -22.0, 2.8], [13, 42, -32, -12]],
  ["mediterranean", "Italy & Mediterranean", [39.5, 18.0, 3.6], [34, 46, -10, 32]],
  ["east_africa", "East Africa", [3.0, 36.0, 2.6], [-12, 17, 28, 44]],
  ["melanesia", "PNG & Vanuatu", [-8.5, 156.0, 2.8], [-22, 0, 140, 172]],
  ["new_zealand", "New Zealand & Tonga", [-30.0, 178.0, 2.4], [-48, -14, 165, -172]],
];
const PRESETS = {
  world: [12.0, 115.0, 1.0],
  ring_of_fire: [10.0, 160.0, 1.0],
  europe: [41.0, 15.0, 3.0],
  ...Object.fromEntries(REGIONS.map(([key, , view]) => [key, view])),
};

function inBox(lat, lon, box) {
  const [la0, la1, lo0, lo1] = box;
  if (lat < la0 || lat > la1) return false;
  return lo0 <= lo1 ? lon >= lo0 && lon <= lo1 : lon >= lo0 || lon <= lo1;
}
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 14;
const DATA_REFRESH_MS = 3 * 60 * 1000;
const EARTH_RETRY_MS = 90 * 1000;
const SUN_REFRESH_MS = 60 * 1000;
const MAX_EARTH_PIXELS = 1.6e6;
const HOUR = 3600 * 1000;
const TSUNAMI_NAMES = { 4: "Tsunami warning", 3: "Tsunami watch", 2: "Tsunami advisory", 1: "Tsunami information" };
const TSUNAMI_COLORS = { 4: "255,59,59", 3: "255,140,40", 2: "255,214,60", 1: "120,190,255" };

/** point at a great-circle distance (km) and bearing (deg) from lat/lon */
function destPoint(lat, lon, km, bearingDeg) {
  const d = km / 6371;
  const b = bearingDeg * DEG;
  const p1 = lat * DEG;
  const l1 = lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / DEG, l2 / DEG];
}

function tsunamiTitle(e) {
  return TSUNAMI_NAMES[e.level] || "Tsunami";
}
// animated tsunami marker (artwork by mb26-dev), served next to the card
const TSUNAMI_ICON = new URL(`./tsunami-marker.svg?v=${VERSION}`, import.meta.url).href;
const FIRE_ICON = new URL(`./fire-marker.svg?v=${VERSION}`, import.meta.url).href;
const QUAKE_ICON = new URL(`./quake-marker.svg?v=${VERSION}`, import.meta.url).href;
/** earthquake colour by magnitude (same scale as the earthquake card) */
function quakeRgb(m) {
  if (m >= 7) return "217,70,239";
  if (m >= 6) return "239,68,68";
  if (m >= 5) return "249,115,22";
  if (m >= 4) return "245,158,11";
  return "250,204,21";
}
/** wildfire colour by radiative power (MW) */
const fireRgb = (mw) => (mw >= 100 ? "239,68,68" : mw >= 30 ? "249,115,22" : mw >= 8 ? "245,158,11" : "250,204,21");
const REPLAY_HOURS_PER_SECOND = 12;
const OFFICIAL_NAMES = { usgs: "USGS", imo: "Icelandic Met Office", jma: "Japan Meteorological Agency" };
const CAM_SOURCES = { usgs: "USGS", geonet: "GeoNet", jma: "JMA", magma: "MAGMA Indonesia" };
const CAM_REFRESH_MS = 5 * 60 * 1000;

const ICONS = {
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  minus: "M19 13H5v-2h14v2z",
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14A8.2 8.2 0 0 1 4 12c0-.69.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.08 16zm2.95-8H5.08a7.99 7.99 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM2 13h2a1 1 0 0 0 0-2H2a1 1 0 0 0 0 2zm18 0h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2zM11 2v2a1 1 0 0 0 2 0V2a1 1 0 0 0-2 0zm0 18v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0zM5.99 4.58a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41L5.99 4.58zm12.37 12.37a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41l-1.06-1.06zm1.06-10.96a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06zM7.05 18.36a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06z",
  night: "M12.3 22A10.3 10.3 0 0 1 9.4 1.8a1 1 0 0 1 1.2 1.3 8.3 8.3 0 0 0 10.3 10.3 1 1 0 0 1 1.3 1.2A10.3 10.3 0 0 1 12.3 22z",
  rotate: "M12 6v3l4-4-4-4v3a8 8 0 0 0-6.76 12.26l1.46-1.46A6 6 0 0 1 12 6zm6.76 1.74-1.46 1.46A6 6 0 0 1 12 18v-3l-4 4 4 4v-3a8 8 0 0 0 6.76-12.26z",
  full: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  unfull: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
  history: "M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  play: "M8 5v14l11-7z",
  leaf: "M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
};

function svg(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function rel(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function utc(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "1218 UTC" -> "12:18 UTC" and no repeated sentences (also for notices cached by older versions) */
function tidyNotice(text) {
  if (!text) return "";
  const t = String(text).replace(/\b([01]\d|2[0-3])([0-5]\d)(\s*(?:UTC|UT|local|LT|WIB|WITA|WIT)\b)/g, "$1:$2$3");
  const seen = new Set();
  return t.trim().split(/(?<=[.!?])\s+/).filter((s) => {
    const k = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (k && seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(" ");
}

function wikiUrl(title, name) {
  if (title) {
    // titles from older versions arrive percent-encoded: decode first, then encode exactly once
    let plain = String(title);
    try {
      if (plain.includes("%")) plain = decodeURIComponent(plain);
    } catch (_err) {
      // a literal % in a title: keep it as it is
    }
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(plain.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":")}`;
  }
  return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(`${name} volcano`)}`;
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

function fmtInt(n) {
  return Number(n).toLocaleString("en-US");
}

function distKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const COMPASS_NAMES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
function compass(deg) {
  if (deg == null) return "";
  return COMPASS_NAMES[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; background: #03050a; border-radius: var(--ha-card-border-radius, 12px); }
  .stage { position: relative; width: 100%; overflow: hidden; user-select: none; -webkit-user-select: none;
    font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); color: #f3f1ee; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  canvas.fx { touch-action: none; cursor: grab; }
  canvas.fx.dragging { cursor: grabbing; }
  .top { position: absolute; top: 10px; left: 12px; right: 12px; pointer-events: none; display: flex; flex-direction: column; gap: 7px; }
  .title { display: flex; align-items: baseline; gap: 8px; min-width: 0; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
  .title b { font-size: 16px; letter-spacing: .4px; font-weight: 650; flex: 0 0 auto; }
  .title b span { color: #ffab4a; }
  .title .sub { font-size: 12px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; pointer-events: auto; padding-bottom: 2px; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex: 0 0 auto; font-size: 11.5px; padding: 4px 10px; border-radius: 14px; cursor: pointer;
    background: rgba(12,14,20,.62); border: 1px solid rgba(255,255,255,.12); color: #e9e6e2;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); white-space: nowrap; }
  .chip.on { background: rgba(255,150,50,.24); border-color: rgba(255,171,74,.75); color: #fff; }
  .chip .n { opacity: .7; margin-left: 4px; }
  .regions .chip { font-size: 11px; padding: 3px 9px; background: rgba(12,14,20,.5); }
  .regions .chip.quiet { color: #b9b4ad; }
  .regions .chip .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 0.5px; }
  .regions .chip.on { background: rgba(255,150,50,.24); border-color: rgba(255,171,74,.75); color: #fff; }
  .legend { position: absolute; left: 10px; bottom: 10px; pointer-events: none; font-size: 10.5px;
    background: rgba(8,10,16,.58); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 6px 9px;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); max-width: calc(100% - 70px); }
  .legend .row { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: -0.5px; }
  .legend .st { margin-top: 4px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .legend .st.bad { color: #ffb4a8; opacity: .95; }
  .controls { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
  .controls button, .info .x { width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,.14);
    background: rgba(12,14,20,.66); color: #eee; display: flex; align-items: center; justify-content: center; cursor: pointer;
    padding: 0; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .controls button.on { border-color: rgba(255,171,74,.8); color: #ffab4a; }
  .controls button.eco.on { border-color: rgba(120,220,140,.8); color: #7ee08a; }
  .controls svg, .info .x svg { width: 18px; height: 18px; fill: currentColor; }
  .info { position: absolute; top: 74px; right: 54px; width: 300px; max-height: calc(100% - 96px); overflow-y: auto;
    background: rgba(10,12,18,.82); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 12px 14px;
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-size: 12.5px; line-height: 1.45; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
  .stage.has-regions .info { top: 104px; max-height: calc(100% - 126px); }
  .stage:fullscreen { height: 100vh !important; border-radius: 0; }
  .stage.pseudo-full { position: fixed; inset: 0; width: 100vw; height: 100vh !important; height: 100dvh !important; z-index: 9999; }
  .info.hidden { display: none; }
  .replay { position: absolute; left: 10px; right: 54px; bottom: 10px; display: none; align-items: center; gap: 8px;
    background: rgba(8,10,16,.78); border: 1px solid rgba(255,171,74,.45); border-radius: 12px; padding: 7px 10px;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); font-size: 11.5px; }
  .stage.replaying .replay { display: flex; }
  .stage.replaying .legend { display: none; }
  .replay button { width: 28px; height: 28px; flex: 0 0 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,.18);
    background: rgba(255,150,50,.2); color: #ffd3a0; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
  .replay button svg { width: 16px; height: 16px; fill: currentColor; }
  .replay input[type=range] { flex: 1 1 auto; min-width: 60px; accent-color: #ff9b3d; }
  .replay .when { flex: 0 0 auto; text-align: right; line-height: 1.25; white-space: nowrap; }
  .replay .when b { color: #ffcf9a; font-weight: 650; }
  .replay .when span { opacity: .7; font-size: 10.5px; }
  .info .x { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; }
  .info h3 { margin: 0 34px 2px 0; font-size: 16px; font-weight: 650; line-height: 1.25; }
  .info .where { opacity: .72; font-size: 11.5px; margin-bottom: 8px; }
  .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
  .badge { font-size: 10.5px; font-weight: 650; letter-spacing: .4px; padding: 2px 8px; border-radius: 10px; color: #111; white-space: nowrap; }
  .badge.soft { background: rgba(255,255,255,.1); color: #eee; font-weight: 500; letter-spacing: 0; }
  .line { display: flex; gap: 8px; align-items: flex-start; margin: 6px 0; }
  .line .ic { flex: 0 0 18px; text-align: center; }
  .line .tx { flex: 1 1 auto; min-width: 0; }
  .muted { opacity: .65; font-size: 11px; }
  .notice { margin-top: 8px; padding: 8px 10px; background: rgba(255,255,255,.05); border-radius: 8px; font-size: 12px; max-height: 150px; overflow-y: auto; }
  .links { margin-top: 9px; display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; }
  .links a { color: #ffb965; text-decoration: none; }
  .links a:hover { text-decoration: underline; }
  .cam { margin: 8px 0 4px; border-radius: 8px; overflow: hidden; position: relative; background: #000; }
  .cam a { display: block; color: #fff; text-decoration: none; }
  .cam img { display: block; width: 100%; height: auto; max-height: 200px; object-fit: cover; }
  .cam .tag { position: absolute; left: 0; right: 0; bottom: 0; padding: 16px 8px 5px; font-size: 10.5px;
    background: linear-gradient(transparent, rgba(0,0,0,.8)); display: flex; justify-content: space-between; gap: 6px; }
  .cam .live { color: #ff6b5a; font-weight: 700; letter-spacing: .4px; }
  .msg { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); font-size: 13px; opacity: .8; pointer-events: none; text-align: center; }
  @media (max-width: 520px) {
    .info { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 58%; }
    .stage.info-open .legend, .stage.info-open .controls { display: none; }
    .controls button { width: 31px; height: 31px; }
    .title b { font-size: 15px; }
  }
`;

class MagmariumCard extends HTMLElement {
  static getStubConfig() {
    return { center: "home", zoom: 2.4 };
  }

  static getConfigElement() {
    return document.createElement("magmarium-card-editor");
  }

  setConfig(config) {
    this._config = {
      title: "Magmarium",
      height: 460,
      center: "home",
      regions: true,
      rotate: false,
      daylight: true,
      show_all: true,
      weekly_ash: true,
      wind_tracks: true,
      ash_areas: true,
      quakes: true,
      tsunami: true,
      thermal: true,
      fires: true,
      replay: true,
      cams: true,
      labels: true,
      performance: "auto",
      ...(config || {}),
    };
    if (this._stage) this._stage.style.height = `${this._height()}px`;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    if (first) {
      this._initView();
      this._loadData();
      this._loadEarth();
    }
  }

  getCardSize() {
    return Math.ceil(this._height() / 50);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, min_rows: 5 };
  }

  _height() {
    const h = Number(this._config?.height);
    return Number.isFinite(h) && h >= 200 ? h : 460;
  }

  // ------------------------------------------------------------------ setup

  _build() {
    this._built = true;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="stage">
          <canvas class="stars"></canvas>
          <canvas class="earth"></canvas>
          <!-- id "slider": hass-swipe-navigation leaves gestures on #slider alone, so dragging the globe does not switch views -->
          <canvas class="fx" id="slider"></canvas>
          <div class="msg">Loading volcano data...</div>
          <div class="top">
            <div class="title"><b></b><span class="sub"></span></div>
            <div class="chips"></div>
            <div class="chips regions"></div>
          </div>
          <div class="legend"><div class="row"></div><div class="st"></div></div>
          <div class="controls">
            <button class="zin" title="Zoom in">${svg(ICONS.plus)}</button>
            <button class="zout" title="Zoom out">${svg(ICONS.minus)}</button>
            <button class="home" title="Back to start view">${svg(ICONS.home)}</button>
            <button class="world" title="Whole globe">${svg(ICONS.globe)}</button>
            <button class="light" title="Daylight or real day and night">${svg(ICONS.sun)}</button>
            <button class="rot" title="Rotate">${svg(ICONS.rotate)}</button>
            <button class="eco" title="Eco mode for wall tablets">${svg(ICONS.leaf)}</button>
            <button class="hist" title="Replay the last 90 days">${svg(ICONS.history)}</button>
            <button class="full" title="Fullscreen">${svg(ICONS.full)}</button>
          </div>
          <div class="replay">
            <button class="rplay" title="Play">${svg(ICONS.play)}</button>
            <input class="rrange" type="range" min="0" max="1000" step="1" value="1000">
            <div class="when"><b class="rdate"></b><br><span class="rsum"></span></div>
          </div>
          <div class="info hidden"></div>
        </div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._stage = $(".stage");
    this._stage.style.height = `${this._height()}px`;
    this._cStars = $("canvas.stars");
    this._cEarth = $("canvas.earth");
    this._cFx = $("canvas.fx");
    this._msg = $(".msg");
    this._titleEl = $(".title b");
    this._subEl = $(".title .sub");
    this._chipsEl = $(".chips:not(.regions)");
    this._regionsEl = $(".chips.regions");
    for (const row of [this._chipsEl, this._regionsEl]) this._scrollable(row);
    this._legendRow = $(".legend .row");
    this._legendSt = $(".legend .st");
    this._info = $(".info");
    this._titleEl.innerHTML = this._titleHtml();

    this._filter = "all";
    this._showAll = this._config.show_all !== false;
    this._rotate = !!this._config.rotate;
    this._daylight = this._storedDaylight();
    this._plumes = new Map();
    this._ejecta = new Map();
    this._volcanoes = [];
    this._catalog = [];
    this._pointers = new Map();
    this._vel = { lat: 0, lon: 0 };
    this._lastInput = 0;
    this._t = 0;
    this._earth = null;
    this._earthDirty = true;
    this._hqAt = 0;
    this._lastSun = 0;
    this._labelsDrawn = [];

    $(".zin").addEventListener("click", () => this._zoomBy(1.6));
    $(".zout").addEventListener("click", () => this._zoomBy(1 / 1.6));
    $(".home").addEventListener("click", () => {
      const c = this._config.center;
      const region = typeof c === "string" && REGIONS.some((r) => r[0] === c) ? c : null;
      const [lat, lon, zoom] = this._startView();
      this._flyTo(lat, lon, zoom, null, region);
    });
    $(".world").addEventListener("click", () => this._flyTo(this._view.lat, this._view.lon, 1.0));
    this._lightBtn = $(".light");
    this._showLight();
    this._lightBtn.addEventListener("click", () => {
      this._daylight = !this._daylight;
      try {
        localStorage.setItem("magmarium-daylight", this._daylight ? "1" : "0");
      } catch (e) {
        /* storage not available: the choice lasts for this view */
      }
      this._showLight();
      this._earthDirty = true;
    });
    this._eco = ecoMode(this._config.performance);
    this._ecoBtn = $(".eco");
    this._showEco();
    this._ecoBtn.addEventListener("click", () => setEco(!this._eco));
    this._ecoOff = onEcoChange(() => this._applyEco());
    this._rotBtn = $(".rot");
    this._rotBtn.classList.toggle("on", this._rotate);
    this._rotBtn.addEventListener("click", () => {
      this._rotate = !this._rotate;
      this._rotBtn.classList.toggle("on", this._rotate);
      this._lastInput = 0;
    });
    this._histBtn = $(".hist");
    this._histBtn.style.display = this._config.replay === false ? "none" : "";
    this._histBtn.addEventListener("click", () => this._toggleReplay());
    this._rPlay = $(".rplay");
    this._rRange = $(".rrange");
    this._rDate = $(".rdate");
    this._rSum = $(".rsum");
    this._rPlay.addEventListener("click", () => this._setPlaying(!this._replay?.playing));
    this._rRange.addEventListener("input", () => {
      if (!this._replay) return;
      this._setPlaying(false);
      this._replay.t = this._replay.t0 + (this._replay.t1 - this._replay.t0) * (Number(this._rRange.value) / 1000);
      this._replayState(true);
    });
    this._fullBtn = $(".full");
    this._fullBtn.addEventListener("click", () => this._toggleFull());
    this._onFullChange = () => this._syncFull();
    document.addEventListener("fullscreenchange", this._onFullChange);
    this._onKey = (e) => {
      if (e.key === "Escape" && this._pseudoFull) this._setPseudoFull(false);
    };
    document.addEventListener("keydown", this._onKey);
    this._renderChips();

    const fx = this._cFx;
    fx.addEventListener("pointerdown", (e) => this._onDown(e));
    fx.addEventListener("pointermove", (e) => this._onMove(e));
    fx.addEventListener("pointerup", (e) => this._onUp(e));
    fx.addEventListener("pointercancel", (e) => this._onUp(e, true));
    fx.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
    fx.addEventListener("dblclick", (e) => this._onDouble(e));
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this._stage);
    this._io = new IntersectionObserver((entries) => {
      this._visible = entries.some((en) => en.isIntersecting);
      this._loop();
    });
    this._io.observe(this._stage);
    this._onVis = () => this._loop();
    document.addEventListener("visibilitychange", this._onVis);
  }

  connectedCallback() {
    if (this._built) {
      if (!this._ecoOff && this._ecoBtn) {
        this._ecoOff = onEcoChange(() => this._applyEco());
        this._applyEco();
      }
      this._ro?.observe(this._stage);
      this._io?.observe(this._stage);
      if (this._hass) {
        this._loadData();
        if (!this._earth) this._loadEarth();
      }
      this._loop();
    }
  }

  disconnectedCallback() {
    this._visible = false;
    this._ecoOff?.();
    this._ecoOff = null;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._io?.disconnect();
    this._ro?.disconnect();
    clearTimeout(this._dataTimer);
    clearTimeout(this._earthTimer);
    if (this._pseudoFull) this._setPseudoFull(false);
  }

  // ------------------------------------------------------------------ fullscreen

  _isFull() {
    return !!this._pseudoFull || (!!document.fullscreenElement && document.fullscreenElement === this);
  }

  _toggleFull() {
    if (this._pseudoFull) {
      this._setPseudoFull(false);
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    const el = this._stage;
    if (document.fullscreenEnabled && el.requestFullscreen) {
      // real fullscreen; browsers without it (iOS, some app webviews) get a full window overlay
      el.requestFullscreen().catch(() => this._setPseudoFull(true));
    } else {
      this._setPseudoFull(true);
    }
  }

  _setPseudoFull(on) {
    this._pseudoFull = on;
    this._stage.classList.toggle("pseudo-full", on);
    this._syncFull();
  }

  _syncFull() {
    const full = this._isFull();
    this._fullBtn.innerHTML = svg(full ? ICONS.unfull : ICONS.full);
    this._fullBtn.title = full ? "Exit fullscreen" : "Fullscreen";
    this._fullBtn.classList.toggle("on", full);
    setTimeout(() => this._resize(), 60);
  }

  /** chip rows scroll sideways with the mouse wheel and by dragging, not only by touch */
  _scrollable(row) {
    row.addEventListener(
      "wheel",
      (e) => {
        if (row.scrollWidth <= row.clientWidth) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!d) return;
        e.preventDefault();
        row.scrollLeft += d;
      },
      { passive: false }
    );
    let drag = null;
    row.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || row.scrollWidth <= row.clientWidth) return;
      drag = { x: e.clientX, left: row.scrollLeft, moved: 0 };
    });
    row.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      row.scrollLeft = drag.left - dx;
    });
    let draggedAt = 0;
    // swallow the click that ends a drag so it does not trigger a chip
    row.addEventListener(
      "click",
      (ev) => {
        if (performance.now() - draggedAt < 250) ev.stopPropagation();
      },
      { capture: true }
    );
    row.addEventListener("pointerup", () => {
      if (drag && drag.moved > 5) draggedAt = performance.now();
      drag = null;
    });
    row.addEventListener("pointerleave", () => (drag = null));
  }

  _titleHtml() {
    const title = String(this._config.title ?? "Magmarium");
    if (title === "Magmarium") return "Magma<span>rium</span>";
    return esc(title);
  }

  _startView() {
    const c = this._config.center;
    const userZoom = Number(this._config.zoom);
    const z = clamp(Number.isFinite(userZoom) && userZoom > 0 ? userZoom : 2.4, ZOOM_MIN, ZOOM_MAX);
    if (Array.isArray(c) && c.length >= 2) return [Number(c[0]), Number(c[1]), z];
    if (typeof c === "string" && PRESETS[c]) {
      const p = PRESETS[c];
      return [p[0], p[1], Number.isFinite(userZoom) && userZoom > 0 ? z : p[2]];
    }
    const lat = this._hass?.config?.latitude ?? 0;
    const lon = this._hass?.config?.longitude ?? 110;
    return [lat, lon, z];
  }

  _initView() {
    const [lat, lon, zoom] = this._startView();
    this._view = { lat, lon, zoom };
    const c = this._config.center;
    this._region = typeof c === "string" && REGIONS.some((r) => r[0] === c) ? c : null;
  }

  _resize() {
    const r = this._stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this._w = r.width;
    this._h = r.height;
    this._dpr = Math.min(window.devicePixelRatio || 1, perf(this._eco).maxDpr);
    const fx = this._cFx;
    fx.width = Math.round(this._w * this._dpr);
    fx.height = Math.round(this._h * this._dpr);
    this._drawStars();
    this._earthDirty = true;
    this._loop();
  }

  _drawStars() {
    const c = this._cStars;
    c.width = Math.round(this._w * this._dpr);
    c.height = Math.round(this._h * this._dpr);
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height;
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#0b1222");
    bg.addColorStop(0.6, "#05070f");
    bg.addColorStop(1, "#010205");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = Math.round((W * H) / (2600 * this._dpr * this._dpr));
    for (let i = 0; i < n; i++) {
      const x = rnd() * W, y = rnd() * H;
      const m = rnd();
      const r = (m > 0.97 ? 1.3 : m > 0.85 ? 0.9 : 0.55) * this._dpr;
      const tint = rnd();
      ctx.fillStyle = tint > 0.9 ? `rgba(255,214,170,${0.35 + m * 0.5})` : tint > 0.8 ? `rgba(180,200,255,${0.35 + m * 0.5})` : `rgba(255,255,255,${0.25 + m * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ data

  async _loadData() {
    clearTimeout(this._dataTimer);
    try {
      const resp = await this._hass.fetchWithAuth("/api/magmarium/volcanoes");
      if (resp.status === 503) {
        this._msg.textContent = "Magmarium is collecting the first volcano reports...";
        this._dataTimer = setTimeout(() => this._loadData(), 15000);
        return;
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this._setData(await resp.json());
      this._msg.textContent = "";
    } catch (err) {
      this._msg.textContent = this._data
        ? ""
        : `Volcano data not available (${err.message}). Is the Magmarium integration set up?`;
    }
    this._dataTimer = setTimeout(() => this._loadData(), DATA_REFRESH_MS);
  }

  async _loadEarth() {
    clearTimeout(this._earthTimer);
    try {
      this._earth = await loadEarth(this._hass);
      this._earthDirty = true;
      this._loop();
    } catch (_err) {
      // images are still being downloaded by the integration: try again later
      this._earthTimer = setTimeout(() => this._loadEarth(), EARTH_RETRY_MS);
    }
  }

  /** used by the preview page and by tests */
  setPreviewData(data, earth) {
    if (earth) {
      this._earth = earth;
      this._earthDirty = true;
    }
    if (data) this._setData(data);
    this._msg.textContent = "";
  }

  _setData(data) {
    this._data = data;
    const weeklyAsh = this._config.weekly_ash !== false;
    this._volcanoes = (data.volcanoes || [])
      .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
      .map((v) => {
        const er = v.eruption;
        let erupt = 0;
        if (er && er.source === "vona") erupt = clamp(1 - (er.age_min || 0) / (24 * 60) * 0.6, 0.4, 1);
        else if (er) erupt = 0.45;
        return { ...v, p: ecef(v.lat, v.lon), erupt };
      });
    this._catalog = (data.catalog || [])
      .filter((r) => Number.isFinite(r[2]) && Number.isFinite(r[3]))
      .map((r) => ({ name: r[0], country: r[1], lat: r[2], lon: r[3], elev: r[4], number: r[5], wiki: r[6] || null, p: ecef(r[2], r[3]) }));
    this._sigmets = (data.sigmets || [])
      .filter((a) => Array.isArray(a.poly) && a.poly.length >= 3)
      .map((a) => ({ ...a, pts: a.poly.map(([la, lo]) => ecef(la, lo)), fpts: Array.isArray(a.forecast_poly) && a.forecast_poly.length >= 3 ? a.forecast_poly.map(([la, lo]) => ecef(la, lo)) : null, c: ecef(a.poly.reduce((t, q) => t + q[0], 0) / a.poly.length, a.poly.reduce((t, q) => t + q[1], 0) / a.poly.length) }));
    this._tsunami = (data.tsunami || [])
      .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon))
      .map((e) => ({ ...e, name: e.region || "Tsunami", p: ecef(e.lat, e.lon), ms: new Date(e.time).getTime() }));
    // wildfire clusters around home: lat, lon, detections, MW, peak MW, last pass, first pass, km, bearing, cell
    this._fires = (data.fires || []).map((f) => ({
      lat: f[0], lon: f[1], count: f[2], mw: f[3], max: f[4], time: f[5], first: f[6], km: f[7], cell: f[9], p: ecef(f[0], f[1]),
    }));
    this._quakes = (data.quakes || []).map((q) => ({
      lat: q[0], lon: q[1], mag: q[2], depth: q[3], time: q[4], place: q[5], url: q[6], volcano: q[7], p: ecef(q[0], q[1]), ms: new Date(q[4]).getTime(),
    }));

    const keepPlumes = new Set();
    for (const v of this._volcanoes) {
      if (!v.ash) continue;
      if (v.ash.source !== "vona" && !weeklyAsh) continue;
      keepPlumes.add(v.id);
      const ash = { ...v.ash, elev: v.elev };
      if (ash.toward_deg == null && v.wind && v.wind.toward_deg != null) {
        // no drift in the report: use the forecast wind at the plume height
        ash.toward_deg = v.wind.toward_deg;
        ash.dir_source = "wind";
      }
      const existing = this._plumes.get(v.id);
      if (existing) existing.update(ash);
      else this._plumes.set(v.id, new AshPlume(v.id, ash));
    }
    for (const id of [...this._plumes.keys()]) if (!keepPlumes.has(id)) this._plumes.delete(id);
    const keepEj = new Set();
    for (const v of this._volcanoes) {
      const er = v.eruption;
      if (er && er.source === "vona" && (er.age_min ?? 9999) <= 360) {
        keepEj.add(v.id);
        if (!this._ejecta.has(v.id)) this._ejecta.set(v.id, new Ejecta(v.id));
      }
    }
    for (const id of [...this._ejecta.keys()]) if (!keepEj.has(id)) this._ejecta.delete(id);

    this._renderChips();
    this._renderHeader();
    this._renderLegend();
    if (this._selected) this._renderInfo();
    this._loop();
  }

  _counts() {
    const vs = this._volcanoes;
    return {
      erupting: vs.filter((v) => v.erupting).length,
      ash: vs.filter((v) => v.ash && v.ash.source === "vona").length,
      elevated: vs.filter((v) => v.level >= 2).length,
      all: vs.length,
    };
  }

  _renderHeader() {
    const c = this._counts();
    const parts = [];
    if (c.erupting) parts.push(`${c.erupting} erupting`);
    if (c.ash) parts.push(`${c.ash} ash cloud${c.ash === 1 ? "" : "s"}`);
    parts.push(`${c.elevated} elevated`);
    this._subEl.textContent = parts.join(" · ");
  }

  _renderChips() {
    const c = this._counts ? this._counts() : { all: 0 };
    const chips = FILTERS.map(([key, label]) => {
      const n = c[key];
      return `<span class="chip ${this._filter === key ? "on" : ""}" data-f="${key}">${label}${n != null ? `<span class="n">${n}</span>` : ""}</span>`;
    });
    chips.push(`<span class="chip ${this._showAll ? "on" : ""}" data-t="all">All known volcanoes</span>`);
    this._chipsEl.innerHTML = chips.join("");
    this._chipsEl.querySelectorAll(".chip").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.dataset.f) {
          this._filter = el.dataset.f;
          this._renderChips();
        } else if (el.dataset.t) {
          this._showAll = !this._showAll;
          this._renderChips();
        }
      });
    });
    this._renderRegions();
  }

  _regionList() {
    const cfg = this._config.regions;
    if (cfg === false) return [];
    if (Array.isArray(cfg)) {
      const wanted = cfg.map((k) => String(k).toLowerCase());
      return wanted.map((k) => REGIONS.find((r) => r[0] === k)).filter(Boolean);
    }
    return REGIONS;
  }

  _regionStats(box) {
    let active = 0;
    let top = 0;
    for (const v of this._volcanoes || []) {
      if (!inBox(v.lat, v.lon, box)) continue;
      if (v.level >= 2 || v.erupting) active += 1;
      const rank = v.erupting ? Math.max(v.level, 3) : v.level;
      if (rank > top) top = rank;
    }
    let known = 0;
    for (const c of this._catalog || []) if (inBox(c.lat, c.lon, box)) known += 1;
    return { active, top, known };
  }

  _renderRegions() {
    if (!this._regionsEl) return;
    const list = this._regionList();
    this._regionsEl.style.display = list.length ? "" : "none";
    this._stage.classList.toggle("has-regions", list.length > 0);
    if (!list.length) return;
    const html = list.map(([key, label, , box]) => {
      const st = this._regionStats(box);
      const color = st.top >= 2 ? LEVEL_COLORS[st.top] : null;
      const dot = color ? `<span class="dot" style="background:${color}"></span>` : "";
      const n = st.active ? `<span class="n">${st.active}</span>` : "";
      const cls = ["chip", this._region === key ? "on" : "", st.active ? "" : "quiet"].filter(Boolean).join(" ");
      const title = `${label}: ${st.active} active, ${st.known} known volcanoes`;
      return `<span class="${cls}" data-r="${key}" title="${esc(title)}">${dot}${esc(label)}${n}</span>`;
    });
    this._regionsEl.innerHTML = html.join("");
    this._regionsEl.querySelectorAll(".chip").forEach((el) => {
      el.addEventListener("click", () => this._goRegion(el.dataset.r));
    });
  }

  _topPad() {
    return this._stage && this._stage.classList.contains("has-regions") ? 84 : 52;
  }

  _goRegion(key) {
    const r = REGIONS.find((x) => x[0] === key);
    if (!r) return;
    const [lat, lon, zoom] = r[2];
    if (this._selected) {
      this._selected = null;
      this._renderInfo();
    }
    this._flyTo(lat, lon, zoom, null, key);
    const el = this._regionsEl.querySelector(`[data-r="${key}"]`);
    el?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  _setRegion(key) {
    if (this._region === key) return;
    this._region = key;
    if (!this._regionsEl) return;
    this._regionsEl.querySelectorAll(".chip").forEach((el) => el.classList.toggle("on", el.dataset.r === key));
  }

  _renderLegend() {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const v of this._volcanoes) if (counts[v.level] != null) counts[v.level] += 1;
    this._legendRow.innerHTML = [4, 3, 2, 1]
      .map((l) => `<span><i style="background:${LEVEL_COLORS[l]}"></i>${LEVEL_NAMES[l]} ${counts[l]}</span>`)
      .join("");
    const src = this._data?.sources || {};
    const bad = Object.entries(src).filter(([k, s]) => s.enabled && s.error && k !== "catalog");
    const updated = this._data?.updated ? rel(new Date(this._data.updated * 1000).toISOString()) : "";
    if (bad.length) {
      const FEED_NAMES = { wind: "Wind data", usgs: "USGS", imo: "IMO", jma: "JMA", sigmet: "SIGMETs", quakes: "Earthquakes", wiki: "Wikipedia", cams: "Cameras", tsunami: "Tsunami", thermal: "NASA FIRMS", fires: "Wildfires" };
      const names = bad.map(([k]) => (k.startsWith("magma") ? "MAGMA" : FEED_NAMES[k] || "Weekly report"));
      this._legendSt.textContent = `${[...new Set(names)].join(", ")} not reachable · last data shown`;
      this._legendSt.classList.add("bad");
    } else {
      this._legendSt.textContent = updated ? `Updated ${updated}` : "";
      this._legendSt.classList.remove("bad");
    }
  }

  _visibleByFilter(v) {
    switch (this._filter) {
      case "erupting":
        return v.erupting;
      case "ash":
        return !!(v.ash && (v.ash.source === "vona" || this._config.weekly_ash !== false));
      case "elevated":
        return v.level >= 2;
      default:
        return true;
    }
  }

  // ------------------------------------------------------------------ geometry

  _R() {
    return this._view.zoom * Math.min(this._w, this._h) * 0.42;
  }

  _frame() {
    return viewFrame(this._view.lat, this._view.lon);
  }

  _project(p, G, R) {
    return {
      x: this._w / 2 + R * dot(p, G.east),
      y: this._h / 2 - R * dot(p, G.north),
      z: dot(p, G.view),
    };
  }

  _unproject(sx, sy) {
    const R = this._R();
    const x = (sx - this._w / 2) / R;
    const y = (this._h / 2 - sy) / R;
    const q = x * x + y * y;
    if (q >= 1) return null;
    const z = Math.sqrt(1 - q);
    const G = this._frame();
    const n = [0, 1, 2].map((i) => x * G.east[i] + y * G.north[i] + z * G.view[i]);
    return { lat: Math.asin(clamp(n[2], -1, 1)) / DEG, lon: Math.atan2(n[1], n[0]) / DEG };
  }

  /** screen direction of a compass bearing at a point (for the ash drift) */
  _screenDir(v, G, bearing) {
    const la = v.lat * DEG, lo = v.lon * DEG;
    const e = [-Math.sin(lo), Math.cos(lo), 0];
    const n = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    const ex = dot(e, G.east), ey = -dot(e, G.north);
    const nx = dot(n, G.east), ny = -dot(n, G.north);
    const b = bearing * DEG;
    let dx = Math.sin(b) * ex + Math.cos(b) * nx;
    let dy = Math.sin(b) * ey + Math.cos(b) * ny;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    // keep some of the foreshortening near the limb, but never collapse
    const k = Math.max(0.45, Math.min(1, len)) / len;
    dx *= k;
    dy *= k;
    return [dx, dy];
  }

  // ------------------------------------------------------------------ interaction

  _markInput() {
    this._lastInput = performance.now();
    this._fly = null;
  }

  _pos(e) {
    const r = this._cFx.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onDown(e) {
    try {
      this._cFx.setPointerCapture?.(e.pointerId);
    } catch (_err) {
      // synthetic or already released pointers cannot be captured
    }
    const pos = this._pos(e);
    this._pointers.set(e.pointerId, pos);
    this._markInput();
    this._vel = { lat: 0, lon: 0 };
    if (this._pointers.size === 1) {
      this._drag = { x: pos.x, y: pos.y, sx: pos.x, sy: pos.y, t: performance.now(), moved: 0 };
      this._cFx.classList.add("dragging");
    } else if (this._pointers.size === 2) {
      const [a, b] = [...this._pointers.values()];
      this._pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this._view.zoom };
      this._drag = null;
    }
  }

  _onMove(e) {
    if (!this._pointers.has(e.pointerId)) return;
    const pos = this._pos(e);
    this._pointers.set(e.pointerId, pos);
    if (this._pinch && this._pointers.size >= 2) {
      const [a, b] = [...this._pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this._setZoom(this._pinch.zoom * (d / this._pinch.d));
      this._markInput();
      return;
    }
    if (!this._drag) return;
    const dx = pos.x - this._drag.x;
    const dy = pos.y - this._drag.y;
    this._drag.x = pos.x;
    this._drag.y = pos.y;
    this._drag.moved += Math.abs(dx) + Math.abs(dy);
    if (this._drag.moved >= 7) this._setRegion(null);
    const R = this._R();
    const now = performance.now();
    const dt = Math.max(1, now - (this._drag.lt || now - 16)) / 1000;
    this._drag.lt = now;
    const dLon = (-dx / R / Math.max(0.3, Math.cos(this._view.lat * DEG))) / DEG;
    const dLat = (dy / R) / DEG;
    this._view.lon += dLon;
    this._view.lat = clamp(this._view.lat + dLat, -85, 85);
    this._vel = { lat: dLat / dt, lon: dLon / dt };
    this._earthDirty = true;
    this._markInput();
    this._loop();
  }

  _onUp(e, cancel) {
    const pos = this._pos(e);
    this._pointers.delete(e.pointerId);
    this._cFx.classList.remove("dragging");
    if (this._pointers.size < 2) this._pinch = null;
    if (this._drag && !cancel) {
      const quick = performance.now() - this._drag.t < 450;
      if (this._drag.moved < 7 && quick) this._tap(pos.x, pos.y);
      else if (performance.now() - (this._drag.lt || 0) > 80) this._vel = { lat: 0, lon: 0 };
    }
    this._drag = null;
    this._markInput();
    this._hqAt = performance.now() + 160;
    this._loop();
  }

  _onWheel(e) {
    e.preventDefault();
    this._setZoom(this._view.zoom * Math.exp(-e.deltaY * 0.0016));
    this._markInput();
    this._hqAt = performance.now() + 220;
  }

  _onDouble(e) {
    const pos = this._pos(e);
    const ll = this._unproject(pos.x, pos.y);
    if (ll) this._flyTo(ll.lat, ll.lon, this._view.zoom * 2);
  }

  _setZoom(z) {
    const nz = clamp(z, ZOOM_MIN, ZOOM_MAX);
    if (nz !== this._view.zoom) {
      this._view.zoom = nz;
      this._earthDirty = true;
      this._loop();
    }
  }

  _zoomBy(f) {
    this._flyTo(this._view.lat, this._view.lon, this._view.zoom * f, 450, this._region);
  }

  _flyTo(lat, lon, zoom, ms, region) {
    this._setRegion(region || null);
    const from = { ...this._view };
    let dLon = ((lon - from.lon + 540) % 360) - 180;
    const to = { lat: clamp(lat, -85, 85), lon: from.lon + dLon, zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX) };
    const dist = Math.hypot(to.lat - from.lat, dLon);
    const duration = ms || clamp(700 + dist * 12, 700, 1800);
    this._fly = { from, to, t0: performance.now(), duration, bump: Math.min(1.4, dist / 55) };
    this._vel = { lat: 0, lon: 0 };
    this._lastInput = performance.now();
    this._loop();
  }

  _tap(x, y) {
    // several markers under the finger (a volcano and a quake on top of each other):
    // every further tap on the same spot moves on to the next one
    const cands = this._hitList(x, y);
    let hit = cands[0] || null;
    const last = this._lastTap;
    if (hit && this._selected && last && Math.hypot(last.x - x, last.y - y) < 14 && cands.length > 1) {
      const i = cands.findIndex((c) => this._sameHit(c, this._selected));
      if (i >= 0) hit = cands[(i + 1) % cands.length];
    }
    this._lastTap = { x, y };
    if (hit) {
      this._selected = hit;
      this._renderInfo();
      const v = hit.v;
      if (hit.kind === "volcano") {
        this._flyTo(v.lat, v.lon, Math.max(this._view.zoom, 3.2));
      }
    } else if (this._selected) {
      this._selected = null;
      this._renderInfo();
    }
  }

  _hitTest(x, y) {
    return this._hitList(x, y)[0] || null;
  }

  /** everything under a tap, the marker hit most squarely first (tsunami alerts always first), ash areas last */
  _hitList(x, y) {
    const order = { tsunami: 0, volcano: 1, quake: 1, fire: 1, catalog: 2 };
    const seen = new Map();
    for (const h of this._hits || []) {
      if (!(h.kind in order)) continue;
      const d = Math.hypot(h.x - x, h.y - y);
      if (d > h.r) continue;
      // one entry per marker (a quake has its ring and its icon as hit areas)
      const key = `${h.kind}:${this._hitKey(h)}`;
      const prev = seen.get(key);
      if (!prev || d < prev.d) seen.set(key, { ...h, d });
    }
    // closeness relative to the size of the marker: a tap right on a small quake ring
    // wins over the edge of the large volcano tap area around it
    const list = [...seen.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.d / a.r - b.d / b.r);
    // official ash areas are large: a tap anywhere inside opens them
    for (const h of this._hits || []) {
      if (h.kind === "sigmet" && pointInPoly(x, y, h.pts)) list.push(h);
    }
    return list;
  }

  _hitKey(h) {
    const v = h.v || {};
    return v.id ?? v.url ?? v.number ?? `${v.lat},${v.lon},${v.time ?? v.ms ?? ""}`;
  }

  _sameHit(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.v === b.v) return true;
    return this._hitKey(a) === this._hitKey(b);
  }

  // ------------------------------------------------------------------ info panel

  _renderInfo() {
    const sel = this._selected;
    this._stage.classList.toggle("info-open", !!sel);
    if (!sel) {
      this._info.classList.add("hidden");
      this._info.innerHTML = "";
      return;
    }
    let v = sel.v;
    if (sel.kind === "volcano") v = this._volcanoes.find((x) => x.id === sel.v.id) || sel.v;
    const home = this._data?.home;
    const dist = home && Number.isFinite(home[0]) ? distKm(home[0], home[1], v.lat, v.lon) : null;
    if (sel.kind === "tsunami") {
      this._renderTsunamiInfo(v, dist);
      return;
    }
    if (sel.kind === "fire") {
      this._renderFireInfo(v, dist);
      return;
    }
    const parts = [];
    const title = sel.kind === "volcano" ? v.local || v.name : v.name;
    parts.push(`<button class="x" title="Close">${svg(ICONS.close)}</button>`);
    parts.push(`<h3>${esc(title)}</h3>`);
    const where = [v.province, v.country].filter(Boolean).join(", ");
    const alias = sel.kind === "volcano" && v.local && v.local !== v.name ? ` · GVP: ${esc(v.name)}` : "";
    parts.push(`<div class="where">${esc(where)}${alias}</div>`);

    if (sel.kind === "quake") {
      this._renderQuakeInfo(v, dist);
      return;
    }
    if (sel.kind === "sigmet") {
      this._renderSigmetInfo(v);
      return;
    }
    if (sel.kind !== "volcano") {
      parts.push(`<div class="line"><span class="ic">⛰</span><span class="tx">${v.elev != null ? `${fmtInt(v.elev)} m` : "Elevation unknown"}${dist != null ? ` · ${fmtInt(Math.round(dist))} km from home` : ""}</span></div>`);
      parts.push(`<div class="muted">No current activity report for this volcano.</div>`);
      parts.push(this._camHtml(v.number ? `gvp:${v.number}` : null));
      const cl = [`<a href="${esc(wikiUrl(v.wiki, v.name))}" target="_blank" rel="noopener">Wikipedia</a>`];
      if (v.number) cl.push(`<a href="https://volcano.si.edu/volcano.cfm?vn=${encodeURIComponent(v.number)}" target="_blank" rel="noopener">Global Volcanism Program</a>`);
      parts.push(`<div class="links">${cl.join("")}</div>`);
      this._info.innerHTML = parts.join("");
      this._info.classList.remove("hidden");
      this._info.querySelector(".x").addEventListener("click", () => {
        this._selected = null;
        this._renderInfo();
      });
      return;
    }

    const badges = [];
    badges.push(`<span class="badge" style="background:${LEVEL_COLORS[v.level]}">${esc(LEVEL_NAMES[v.level].toUpperCase())}</span>`);
    if (v.alert) badges.push(`<span class="badge soft">${esc(v.alert)}</span>`);
    if (v.color) badges.push(`<span class="badge soft">VONA ${esc(v.color)}</span>`);
    parts.push(`<div class="badges">${badges.join("")}</div>`);

    if (v.official) {
      const o = v.official;
      parts.push(`<div class="line"><span class="ic">🏛</span><span class="tx">${esc(o.alert || "")}<div class="muted">${esc(OFFICIAL_NAMES[o.source] || o.source)}${o.time ? ` · ${esc(rel(o.time))}` : ""}</div></span></div>`);
    }
    if (v.eruption) {
      const txt = v.eruption.source === "vona"
        ? `Eruption reported ${esc(rel(v.eruption.time))}`
        : v.eruption.source === "sigmet"
          ? "Ash eruption in an official SIGMET"
          : "Eruptive activity in the current weekly report";
      parts.push(`<div class="line"><span class="ic">🔥</span><span class="tx">${txt}</span></div>`);
    }
    if (v.ash) {
      const a = v.ash;
      const bits = [];
      if (a.top_m != null) bits.push(`top ${fmtInt(a.top_m)} m a.s.l.`);
      if (a.above_summit_m != null) bits.push(`${fmtInt(a.above_summit_m)} m above summit`);
      if (a.toward_deg != null) bits.push(`drifting ${compass(a.toward_deg)}`);
      if (a.intensity) bits.push(esc(a.intensity));
      const when = a.source === "vona" ? `observed ${esc(rel(a.time))}` : a.source === "sigmet" ? "official ash area (SIGMET)" : "reported in the weekly report";
      parts.push(`<div class="line"><span class="ic">☁</span><span class="tx">Ash cloud${bits.length ? ` · ${bits.join(" · ")}` : ""}<div class="muted">${when}</div></span></div>`);
    }
    for (const sg of v.sigmets || []) {
      parts.push(`<div class="line"><span class="ic">✈</span><span class="tx">Ash SIGMET ${esc(sg.fir || "")}${sg.top_m != null ? ` · up to ${fmtInt(sg.top_m)} m` : ""}<div class="muted">${sg.to ? `valid until ${esc(utc(sg.to))}` : ""}</div></span></div>`);
    }
    if (v.thermal) {
      const th = v.thermal;
      parts.push(`<div class="line"><span class="ic">🔥</span><span class="tx">Thermal anomaly · ${th.count} hotspot${th.count === 1 ? "" : "s"} · ${fmtInt(th.frp_mw)} MW<div class="muted">${esc(th.source)} satellite pass ${esc(rel(th.time))} · NASA FIRMS</div></span></div>`);
    }
    if (v.quakes_7d) {
      parts.push(`<div class="line"><span class="ic">〰</span><span class="tx">${v.quakes_7d} earthquake${v.quakes_7d === 1 ? "" : "s"} within 30 km in 7 days${v.quake_max != null ? ` · strongest M${v.quake_max}` : ""}<div class="muted">USGS; small volcanic quakes are often not in this catalogue</div></span></div>`);
    }
    if (v.wind) {
      const w = v.wind;
      const drift = w.track && w.track.length > 1 ? distKm(w.track[0][0], w.track[0][1], w.track[w.track.length - 1][0], w.track[w.track.length - 1][1]) : null;
      const bits = [`${fmtInt(Math.round(w.speed_kmh))} km/h toward ${compass(w.toward_deg)}`];
      if (drift != null) bits.push(`about ${fmtInt(Math.round(drift))} km in ${w.track.length - 1} h`);
      const used = v.ash && v.ash.toward_deg == null ? " · used for the plume" : "";
      parts.push(`<div class="line"><span class="ic">💨</span><span class="tx">Wind at ${w.alt_km} km (${w.level_hpa} hPa): ${bits.join(", ")}${used}<div class="muted">Forecast drift shown dashed · simulation from Open-Meteo winds, not an official ash forecast</div></span></div>`);
    }
    parts.push(this._camHtml(v.id));
    const meta = [];
    if (v.elev != null) meta.push(`${fmtInt(v.elev)} m`);
    if (dist != null) meta.push(`${fmtInt(Math.round(dist))} km from home`);
    if (meta.length) parts.push(`<div class="line"><span class="ic">⛰</span><span class="tx">${meta.join(" · ")}</span></div>`);

    const n = v.notice;
    if (n) {
      const head = n.kind === "vona"
        ? `VONA ${esc(n.color || "")} · ${esc(utc(n.time))} (${esc(rel(n.time))})`
        : `Weekly report ${esc(n.period || "")}`;
      parts.push(`<div class="notice"><div class="muted">${head}</div>${esc(tidyNotice(n.text))}</div>`);
    } else if (v.weekly) {
      parts.push(`<div class="notice"><div class="muted">Weekly report ${esc(v.weekly.period || "")}</div>${esc(v.weekly.text || "")}</div>`);
    }

    const links = [];
    if (n && n.url && n.kind === "vona") links.push(`<a href="${esc(n.url)}" target="_blank" rel="noopener">VONA notice</a>`);
    if (v.report) links.push(`<a href="${esc(v.report)}" target="_blank" rel="noopener">MAGMA report</a>`);
    if (v.weekly) links.push(`<a href="https://volcano.si.edu/reports_weekly.cfm" target="_blank" rel="noopener">Weekly report</a>`);
    if (v.official && v.official.url) links.push(`<a href="${esc(v.official.url)}" target="_blank" rel="noopener">${esc(OFFICIAL_NAMES[v.official.source] || "Official notice")}</a>`);
    links.push(`<a href="${esc(wikiUrl(v.wiki, v.name))}" target="_blank" rel="noopener">Wikipedia</a>`);
    if (v.number) links.push(`<a href="https://volcano.si.edu/volcano.cfm?vn=${encodeURIComponent(v.number)}" target="_blank" rel="noopener">Global Volcanism Program</a>`);
    if (links.length) parts.push(`<div class="links">${links.join("")}</div>`);

    this._info.innerHTML = parts.join("");
    this._info.classList.remove("hidden");
    this._info.querySelector(".x").addEventListener("click", () => {
      this._selected = null;
      this._renderInfo();
    });
  }

  /** official live camera: the newest image of the first camera, links to the others */
  _camHtml(id) {
    if (!id || this._config.cams === false) return "";
    const cams = (this._data?.cams || {})[id];
    if (!cams || !cams.length) return "";
    const live = cams.find((c) => c[2]);
    const parts = [];
    if (live) {
      const [src, name, img, page] = live;
      const url = `${img}${img.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / CAM_REFRESH_MS)}`;
      parts.push(`<div class="cam"><a href="${esc(page)}" target="_blank" rel="noopener" title="Open the camera page"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.cam').remove()"><span class="tag"><span><span class="live">● LIVE</span> ${esc(name)}</span><span>${esc(CAM_SOURCES[src] || src)}</span></span></a></div>`);
    }
    const others = cams.filter((c) => c !== live);
    if (others.length) {
      const links = others.map(([src, name, , page]) => `<a href="${esc(page)}" target="_blank" rel="noopener">${esc(src === "jma" || src === "magma" ? `${CAM_SOURCES[src]}: ${name}` : name)}</a>`);
      parts.push(`<div class="line"><span class="ic">📷</span><span class="tx">${live ? "More cameras" : "Live cameras"}<div class="links" style="margin-top:3px">${links.join("")}</div></span></div>`);
    }
    return parts.join("");
  }

  _infoShell(title, where, body) {
    this._info.innerHTML = `<button class="x" title="Close">${svg(ICONS.close)}</button><h3>${esc(title)}</h3><div class="where">${esc(where)}</div>${body}`;
    this._info.classList.remove("hidden");
    this._info.querySelector(".x").addEventListener("click", () => {
      this._selected = null;
      this._renderInfo();
    });
  }

  _renderQuakeInfo(q, dist) {
    const lines = [];
    lines.push(`<div class="line"><span class="ic">〰</span><span class="tx">Magnitude ${q.mag}${q.depth != null ? ` · depth ${q.depth} km` : ""}<div class="muted">${esc(utc(q.time))} (${esc(rel(q.time))})</div></span></div>`);
    if (q.volcano) lines.push(`<div class="line"><span class="ic">⛰</span><span class="tx">Within 30 km of ${esc(q.volcano)}</span></div>`);
    if (dist != null) lines.push(`<div class="line"><span class="ic">📍</span><span class="tx">${fmtInt(Math.round(dist))} km from home</span></div>`);
    if (q.url) lines.push(`<div class="links"><a href="${esc(q.url)}" target="_blank" rel="noopener">USGS event page</a></div>`);
    this._infoShell("Earthquake", q.place || "", lines.join(""));
  }

  _renderFireInfo(f, dist) {
    const lines = [];
    const col = fireRgb(f.mw);
    const kind = f.mw >= 100 ? "Intense" : f.mw >= 30 ? "Strong" : f.mw >= 8 ? "Moderate" : "Small";
    lines.push(`<div class="line"><span class="ic">🔥</span><span class="tx"><b style="color:rgb(${col})">${kind} fire · ${f.mw} MW</b><div class="muted">${f.count} satellite detection${f.count === 1 ? "" : "s"} · peak pixel ${f.max} MW</div></span></div>`);
    lines.push(`<div class="line"><span class="ic">🛰</span><span class="tx">Last seen ${esc(utc(f.time))} (${esc(rel(f.time))})${f.first && f.first !== f.time ? `<div class="muted">first seen ${esc(utc(f.first))}</div>` : ""}</span></div>`);
    if (dist != null) lines.push(`<div class="line"><span class="ic">📍</span><span class="tx">${fmtInt(Math.round(dist))} km from home</span></div>`);
    lines.push(`<div class="muted" style="margin-top:8px">VIIRS hotspots of NASA FIRMS grouped into one fire${f.cell >= 0.5 ? " (far from home: a 50 km area)" : ""}. Satellites pass about twice a day, clouds can hide fires.</div>`);
    lines.push(`<div class="links"><a href="https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${f.lon.toFixed(3)},${f.lat.toFixed(3)},10.0z" target="_blank" rel="noopener">NASA FIRMS map</a></div>`);
    this._infoShell("Wildfire", `${f.lat.toFixed(2)}°, ${f.lon.toFixed(2)}°`, lines.join(""));
  }

  _renderTsunamiInfo(e, dist) {
    const lines = [];
    const col = TSUNAMI_COLORS[e.level] || TSUNAMI_COLORS[1];
    lines.push(`<div class="line"><span class="ic">🌊</span><span class="tx"><b style="color:rgb(${col})">${esc(tsunamiTitle(e))}</b>${e.mag ? ` · earthquake M${e.mag}` : ""}<div class="muted">${esc(utc(e.time))} (${esc(rel(e.time))})</div></span></div>`);
    if (e.bulletin) lines.push(`<div class="line"><span class="ic">📄</span><span class="tx">${esc(e.bulletin)}</span></div>`);
    if (dist != null) lines.push(`<div class="line"><span class="ic">📍</span><span class="tx">${fmtInt(Math.round(dist))} km from home</span></div>`);
    lines.push(`<div class="muted" style="margin-top:8px">Official bulletin of ${esc((e.sources || []).join(", "))}. The rings only mark the event, they are not a forecast of the wave. Always follow your local authorities.</div>`);
    if (e.url) lines.push(`<div class="links"><a href="${esc(e.url)}" target="_blank" rel="noopener">Official bulletin</a></div>`);
    this._infoShell(tsunamiTitle(e), e.region || "", lines.join(""));
  }

  _renderSigmetInfo(a) {
    const lines = [];
    const vol = a.volcano ? `Ash from ${esc(a.volcano)}` : "Volcanic ash";
    const bits = [];
    if (a.base_m != null && a.top_m != null) bits.push(`${fmtInt(a.base_m)} to ${fmtInt(a.top_m)} m`);
    if (a.toward_deg != null) bits.push(`moving ${compass(a.toward_deg)}${a.speed_kmh ? ` at ${a.speed_kmh} km/h` : ""}`);
    lines.push(`<div class="line"><span class="ic">✈</span><span class="tx">${vol}${bits.length ? ` · ${bits.join(" · ")}` : ""}<div class="muted">${a.from ? `from ${esc(utc(a.from))} ` : ""}${a.to ? `until ${esc(utc(a.to))}` : ""}</div></span></div>`);
    if (a.forecast_poly) lines.push(`<div class="line"><span class="ic">🕒</span><span class="tx">Forecast position at the end of the validity<div class="muted">shown as the faint dotted area</div></span></div>`);
    if (a.raw) lines.push(`<div class="notice"><div class="muted">SIGMET text</div>${esc(a.raw)}</div>`);
    lines.push(`<div class="muted" style="margin-top:8px">Official volcanic ash area for aviation, issued by the meteorological watch office of the flight information region.</div>`);
    lines.push(`<div class="links"><a href="https://aviationweather.gov/gfa/#sigmet" target="_blank" rel="noopener">AviationWeather.gov</a></div>`);
    this._infoShell("Volcanic ash SIGMET", a.fir || "", lines.join(""));
  }

  // ------------------------------------------------------------------ replay

  async _toggleReplay() {
    if (this._replay) {
      this._replay = null;
      this._stage.classList.remove("replaying");
      this._histBtn.classList.remove("on");
      this._loop();
      return;
    }
    this._histBtn.classList.add("on");
    if (!this._history) {
      try {
        const resp = await this._hass.fetchWithAuth("/api/magmarium/history");
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        this._history = await resp.json();
      } catch (err) {
        this._histBtn.classList.remove("on");
        this._msg.textContent = `History not available (${err.message})`;
        setTimeout(() => (this._msg.textContent = ""), 4000);
        return;
      }
    }
    const events = (this._history.events || []).map((e) => ({ ...e, ms: new Date(e.t).getTime(), p: ecef(e.lat, e.lon) }));
    const t1 = Date.now();
    const t0 = t1 - (this._history.days || 90) * 24 * HOUR;
    this._replay = { events, t0, t1, t: t0, playing: false, plumes: new Map(), ejecta: new Map(), vols: [], lastT: null };
    this._stage.classList.add("replaying");
    if (this._selected) {
      this._selected = null;
      this._renderInfo();
    }
    this._replayState(true);
    this._setPlaying(true);
  }

  _setPlaying(on) {
    if (!this._replay) return;
    if (on && this._replay.t >= this._replay.t1 - HOUR) this._replay.t = this._replay.t0;
    this._replay.playing = on;
    this._rPlay.innerHTML = svg(on ? ICONS.pause : ICONS.play);
    this._rPlay.title = on ? "Pause" : "Play";
    this._loop();
  }

  /** volcano state at the replay time: eruptions of the last 24 h, ash clouds of the last 4 h */
  _replayState(force) {
    const r = this._replay;
    if (!r) return;
    if (!force && r.lastT != null && Math.abs(r.t - r.lastT) < 0.25 * HOUR) return;
    r.lastT = r.t;
    const from = r.t - 24 * HOUR;
    const byId = new Map();
    for (const e of r.events) {
      if (e.ms > r.t) break;
      if (e.ms < from) continue;
      let st = byId.get(e.id);
      if (!st) {
        st = { e, erupt: 0, ash: null, n: 0 };
        byId.set(e.id, st);
      }
      st.e = e;
      st.n += 1;
      const ageH = (r.t - e.ms) / HOUR;
      if (e.eruption) st.erupt = Math.max(st.erupt, Math.max(0.4, 1 - ageH / 24 * 0.6));
      if (e.ash && ageH <= 4) st.ash = { e, ageH };
      else if (!e.ash && st.ash && e.ms > st.ash.e.ms) st.ash = null;
    }
    const current = new Map(this._volcanoes.map((v) => [v.id, v]));
    const vols = [];
    const keepP = new Set();
    const keepE = new Set();
    let eruptions = 0;
    let clouds = 0;
    for (const [id, st] of byId) {
      const base = current.get(id);
      const e = st.e;
      const colorLevel = { GREEN: 1, YELLOW: 2, ORANGE: 3, RED: 4 }[String(e.color || "").toUpperCase()] || 2;
      const v = {
        ...(base || { id, name: e.name, local: e.name, lat: e.lat, lon: e.lon, elev: e.elev, p: e.p, country: "Indonesia" }),
        level: colorLevel,
        erupt: st.erupt,
        erupting: st.erupt > 0,
        ash: st.ash ? { source: "vona" } : null,
        wind: null,
      };
      vols.push(v);
      if (st.erupt > 0) eruptions += 1;
      if (st.ash) {
        clouds += 1;
        keepP.add(id);
        const ash = {
          source: "vona",
          intensity: st.ash.e.intensity,
          color: st.ash.e.ash_color,
          top_m: st.ash.e.top_m,
          above_summit_m: st.ash.e.above_summit_m,
          toward_deg: st.ash.e.toward_deg,
          elev: v.elev,
          strength: Math.max(0.3, 1 - 0.7 * st.ash.ageH / 4),
        };
        const pl = r.plumes.get(id);
        if (pl) pl.update(ash);
        else r.plumes.set(id, new AshPlume(id, ash));
      }
      if (st.erupt > 0 && (r.t - e.ms) / HOUR <= 6 && e.eruption) {
        keepE.add(id);
        if (!r.ejecta.has(id)) r.ejecta.set(id, new Ejecta(id));
      }
    }
    for (const id of [...r.plumes.keys()]) if (!keepP.has(id)) r.plumes.delete(id);
    for (const id of [...r.ejecta.keys()]) if (!keepE.has(id)) r.ejecta.delete(id);
    r.vols = vols;
    const d = new Date(r.t);
    this._rDate.textContent = d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
    this._rSum.textContent = `${eruptions} erupting · ${clouds} ash cloud${clouds === 1 ? "" : "s"} · VONA, Indonesia`;
    this._rRange.value = String(Math.round(((r.t - r.t0) / (r.t1 - r.t0)) * 1000));
  }

  // ------------------------------------------------------------------ animation

  _loop() {
    if (this._raf || !this._w) return;
    if (this._visible === false || document.hidden) return;
    this._last = performance.now();
    const tick = (ts) => {
      this._raf = null;
      if (this._visible === false || document.hidden || !this.isConnected) return;
      this._frameStep(ts);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _frameStep(ts) {
    const dt = Math.min(0.06, Math.max(0, (ts - this._last) / 1000));
    // about 30 frames per second are plenty and keep wall panels cool, 15 in eco mode
    const P = perf(this._eco);
    if (ts - (this._lastDraw || 0) < P.frameMs) return;
    this._lastDraw = ts;
    const work0 = performance.now();
    this._last = ts;
    this._t += dt;
    const v = this._view;
    let moving = false;

    if (this._fly) {
      const f = this._fly;
      const u = clamp((ts - f.t0) / f.duration, 0, 1);
      const e = ease(u);
      v.lat = f.from.lat + (f.to.lat - f.from.lat) * e;
      v.lon = f.from.lon + (f.to.lon - f.from.lon) * e;
      const lz = Math.log(f.from.zoom) + (Math.log(f.to.zoom) - Math.log(f.from.zoom)) * e;
      v.zoom = clamp(Math.exp(lz) / (1 + f.bump * Math.sin(Math.PI * e)), ZOOM_MIN, ZOOM_MAX);
      moving = true;
      if (u >= 1) {
        this._fly = null;
        this._hqAt = ts + 120;
      }
    } else if (!this._drag && !this._pinch && (Math.abs(this._vel.lat) > 0.05 || Math.abs(this._vel.lon) > 0.05)) {
      v.lat = clamp(v.lat + this._vel.lat * dt, -85, 85);
      v.lon += this._vel.lon * dt;
      const k = Math.exp(-dt * 3.2);
      this._vel.lat *= k;
      this._vel.lon *= k;
      moving = true;
      if (Math.abs(this._vel.lat) <= 0.05 && Math.abs(this._vel.lon) <= 0.05) this._hqAt = ts + 120;
    } else if (this._rotate && !this._drag && !this._selected && ts - this._lastInput > 6000) {
      v.lon += (4 / Math.max(1, v.zoom)) * dt;
      moving = true;
    }
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon) || !Number.isFinite(v.zoom)) {
      const [lat, lon, zoom] = this._startView();
      Object.assign(v, { lat, lon, zoom });
      this._vel = { lat: 0, lon: 0 };
    }
    if (v.lon > 180) v.lon -= 360;
    if (v.lon < -180) v.lon += 360;

    const interacting = moving || !!this._drag || !!this._pinch;
    if (interacting) this._earthDirty = true;
    const now = Date.now();
    if (now - this._lastSun > SUN_REFRESH_MS) {
      this._sun = sunDirection(now);
      this._lastSun = now;
      this._earthDirty = true;
    }
    if (this._earthDirty) {
      this._renderEarth(interacting ? P.earthMoving : P.earthScale);
      this._earthDirty = false;
      this._earthLow = interacting;
      if (interacting) this._hqAt = Math.max(this._hqAt, ts + 180);
    } else if (this._earthLow && ts >= this._hqAt && !interacting) {
      this._renderEarth(P.earthScale);
      this._earthLow = false;
    }

    const rp = this._replay;
    if (rp && rp.playing) {
      rp.t = Math.min(rp.t1, rp.t + dt * REPLAY_HOURS_PER_SECOND * HOUR);
      this._replayState(false);
      if (rp.t >= rp.t1) this._setPlaying(false);
    }
    const plumes = rp ? rp.plumes : this._plumes;
    const ejecta = rp ? rp.ejecta : this._ejecta;
    for (const p of plumes.values()) p.step(dt);
    for (const e of ejecta.values()) e.step(dt, this._t);
    this._drawFx();
    this._watchSpeed(performance.now() - work0);
  }

  /** auto mode: a globe that needs too long per frame switches to eco by itself */
  _watchSpeed(ms) {
    if (this._eco || storedEco() !== null) return;
    const opt = String(this._config.performance || "auto").toLowerCase();
    if (opt !== "auto") return;
    this._speed = this._speed == null ? ms : this._speed * 0.95 + ms * 0.05;
    this._frames = (this._frames || 0) + 1;
    if (this._frames > 90 && this._speed > 28) reportSlow();
  }

  /** eco mode for weak wall tablets: switched by the leaf button or detected in auto mode */
  _applyEco() {
    const eco = ecoMode(this._config.performance);
    if (eco === this._eco) return this._showEco();
    this._eco = eco;
    this._showEco();
    this._resize();
  }

  _showEco() {
    if (!this._ecoBtn) return;
    this._ecoBtn.classList.toggle("on", !!this._eco);
    const chosen = storedEco() !== null;
    this._ecoBtn.title = this._eco
      ? `Eco mode${chosen ? "" : " (automatic)"}: lighter animation for wall tablets. Tap for full quality`
      : "Full quality. Tap for eco mode (lighter animation for wall tablets)";
  }

  /** daylight mode: the last choice in this browser, otherwise the card option */
  _storedDaylight() {
    try {
      const v = localStorage.getItem("magmarium-daylight");
      if (v === "1" || v === "0") return v === "1";
    } catch (e) {
      /* storage not available */
    }
    return this._config.daylight !== false;
  }

  _showLight() {
    if (!this._lightBtn) return;
    this._lightBtn.innerHTML = svg(this._daylight ? ICONS.sun : ICONS.night);
    this._lightBtn.title = this._daylight ? "Daylight (switch to real day and night)" : "Real day and night (switch to daylight)";
  }

  /** how dark a point is: 0 in daylight mode, otherwise from the real sun */
  _nightAt(p, sun) {
    return this._daylight ? 0 : smooth(0.08, -0.14, dot(p, sun));
  }

  _renderEarth(quality) {
    if (!this._w) return;
    let scale = this._dpr * quality;
    const maxPx = Math.min(MAX_EARTH_PIXELS, perf(this._eco).maxEarthPx);
    const px = this._w * this._h * scale * scale;
    if (px > maxPx) scale *= Math.sqrt(maxPx / px);
    const W = Math.max(1, Math.round(this._w * scale));
    const H = Math.max(1, Math.round(this._h * scale));
    const R = this._R() * (W / this._w);
    renderEarth(this._cEarth, this._earth, this._frame(), this._sun || sunDirection(Date.now()), W, H, R, this._daylight);
  }

  _drawTrack(ctx, w, G, R, strong, t) {
    const pts = w.track.map(([lat, lon]) => this._project(ecef(lat, lon), G, R));
    if (pts.every((p) => p.z <= 0.02)) return;
    const a = strong ? 0.85 : 0.55;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // soft glow underneath
    ctx.strokeStyle = `rgba(20,16,12,${0.35 * a})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      if (p.z <= 0.02) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    // marching dashes show the direction of travel
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -((t * 14) % 12);
    ctx.strokeStyle = `rgba(214,206,196,${a})`;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.setLineDash([]);
    // hourly ticks
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.z <= 0.02) continue;
      ctx.fillStyle = `rgba(214,206,196,${a * (i === pts.length - 1 ? 1 : 0.7)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === pts.length - 1 ? 2.6 : 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // arrow head and time label at the end
    const n = pts.length;
    const e = pts[n - 1], b = pts[n - 2];
    if (e.z > 0.02 && b.z > 0.02) {
      const ang = Math.atan2(e.y - b.y, e.x - b.x);
      if (Number.isFinite(ang) && Math.hypot(e.x - b.x, e.y - b.y) > 2) {
        ctx.fillStyle = `rgba(230,222,212,${a})`;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(ang) * 7, e.y + Math.sin(ang) * 7);
        ctx.lineTo(e.x + Math.cos(ang + 2.5) * 6, e.y + Math.sin(ang + 2.5) * 6);
        ctx.lineTo(e.x + Math.cos(ang - 2.5) * 6, e.y + Math.sin(ang - 2.5) * 6);
        ctx.closePath();
        ctx.fill();
      }
      if (strong) {
        ctx.font = "600 10px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
        ctx.textBaseline = "middle";
        const text = `+${n - 1} h`;
        ctx.fillStyle = "rgba(6,8,14,0.6)";
        const tw = ctx.measureText(text).width;
        ctx.fillRect(e.x + 8, e.y - 7, tw + 8, 14);
        ctx.fillStyle = "#e6ded4";
        ctx.fillText(text, e.x + 12, e.y);
      }
    }
    ctx.restore();
  }

  _drawFx() {
    const ctx = this._cFx.getContext("2d");
    const dpr = this._dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._cFx.width, this._cFx.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = this._w, H = this._h;
    const G = this._frame();
    const R = this._R();
    const sun = this._sun || sunDirection(Date.now());
    const zoom = this._view.zoom;
    const t = this._t;
    const hits = [];

    // atmosphere around the disk
    const cx = W / 2, cy = H / 2;
    if (R < Math.hypot(W, H)) {
      const g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
      g.addColorStop(0, "rgba(120,180,255,0.38)");
      g.addColorStop(0.35, "rgba(80,140,255,0.14)");
      g.addColorStop(1, "rgba(60,120,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
      ctx.arc(cx, cy, R * 0.98, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
    }

    const zf = clamp(Math.pow(zoom, 0.55), 0.85, 3.6);

    // catalogue volcanoes without a current report: grow with the zoom so a
    // quiet region still reads as a chain of volcanoes
    const quiet = [];
    const activeIds = new Set(this._volcanoes.map((v) => v.number).filter(Boolean));
    const catS = 2.3 * clamp(Math.pow(zoom, 0.62), 0.8, 3.6);
    if (this._showAll && this._filter === "all") {
      for (const c of this._catalog) {
        if (c.number && activeIds.has(c.number)) continue;
        const pr = this._project(c.p, G, R);
        if (pr.z <= 0.04 || pr.x < -10 || pr.x > W + 10 || pr.y < -10 || pr.y > H + 10) continue;
        const a = smooth(0.04, 0.2, pr.z) * (zoom >= 3 ? 0.95 : 0.8);
        drawVolcano(ctx, pr.x, pr.y, catS, { minor: true, alpha: a });
        hits.push({ kind: "catalog", v: c, x: pr.x, y: pr.y - catS * 0.7, r: Math.max(9, catS * 2.4) });
        quiet.push({ c, pr });
      }
    }

    const rp = this._replay;
    const plumesMap = rp ? rp.plumes : this._plumes;
    const ejectaMap = rp ? rp.ejecta : this._ejecta;

    // official volcanic ash areas (SIGMETs)
    if (!rp && this._config.ash_areas !== false && this._filter !== "elevated") {
      for (const a of this._sigmets || []) {
        const pts = a.pts.map((q) => this._project(q, G, R));
        if (pts.every((q) => q.z <= 0.02)) continue;
        const sel = this._selected && this._selected.kind === "sigmet" && this._selected.v === a;
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
        if (a.fpts) {
          // forecast position of the ash cloud at the end of the validity: faint and dotted
          const fp = a.fpts.map((q) => this._project(q, G, R));
          ctx.save();
          ctx.beginPath();
          fp.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.closePath();
          ctx.fillStyle = `rgba(150,130,120,${sel ? 0.16 : 0.08})`;
          ctx.fill();
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = sel ? "rgba(255,190,120,0.7)" : "rgba(235,215,195,0.45)";
          ctx.lineWidth = 1.1;
          ctx.stroke();
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.fillStyle = `rgba(150,130,120,${(sel ? 0.34 : 0.2) + 0.06 * pulse})`;
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -t * 6;
        ctx.strokeStyle = sel ? "rgba(255,190,120,0.95)" : "rgba(235,215,195,0.75)";
        ctx.lineWidth = sel ? 2 : 1.3;
        ctx.stroke();
        ctx.setLineDash([]);
        const c = this._project(a.c, G, R);
        if (c.z > 0.05 && zoom >= 2.2) {
          ctx.font = "600 9.5px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(240,228,214,0.85)";
          ctx.fillText(`VA SIGMET${a.top_m != null ? ` · ${fmtInt(Math.round(a.top_m / 100) / 10)} km` : ""}`, c.x, c.y);
          ctx.textAlign = "start";
        }
        ctx.restore();
        hits.push({ kind: "sigmet", v: a, pts, x: c.x, y: c.y, r: 0 });
      }
    }

    // earthquakes of the last 7 days: rings, volcanic ones in orange, fresh ones pulse
    const quakeIcons = [];
    if (!rp && this._config.quakes !== false && this._filter === "all") {
      const nowMs = Date.now();
      const quakeCand = [];
      for (const q of this._quakes || []) {
        const pr = this._project(q.p, G, R);
        if (pr.z <= 0.03 || pr.x < -20 || pr.x > W + 20 || pr.y < -20 || pr.y > H + 20) continue;
        const ageH = (nowMs - q.ms) / HOUR;
        const fade = clamp(1 - ageH / (7 * 24), 0.25, 1) * smooth(0.03, 0.15, pr.z);
        const r0 = (1.2 + Math.max(0, q.mag - 2) * 1.5) * clamp(Math.pow(zoom, 0.4), 0.8, 2.2);
        const col = q.volcano ? "255,150,60" : "150,190,255";
        ctx.strokeStyle = `rgba(${col},${0.8 * fade})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, r0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(${col},${0.35 * fade})`;
        ctx.fill();
        if (ageH < 6) {
          const k = (t * 0.6 + (q.ms % 1000) / 1000) % 1;
          ctx.strokeStyle = `rgba(${col},${(1 - k) * 0.7 * fade})`;
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, r0 + k * r0 * 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        hits.push({ kind: "quake", v: q, x: pr.x, y: pr.y, r: Math.max(8, r0 + 3) });
        // the strong and fresh ones get the shaking quake marker
        const sel = this._selected && this._selected.kind === "quake" && this._selected.v === q;
        if (sel || (q.mag >= 4.5 && ageH < 48) || (q.mag >= 6 && ageH < 7 * 24)) {
          quakeCand.push({ q, pr, fade, sel, score: (sel ? 100 : 0) + q.mag * 2 - ageH / 24 });
        }
      }
      const s = clamp(24 + zoom * 3, 28, 46);
      const maxIcons = Math.round(clamp(zoom * 2, 3, 10));
      quakeCand.sort((a, b) => b.score - a.score);
      for (const it of quakeCand) {
        if (quakeIcons.length >= maxIcons) break;
        if (quakeIcons.some((o) => Math.hypot(o.pr.x - it.pr.x, o.pr.y - it.pr.y) < s * 0.8)) continue;
        quakeIcons.push({ ...it, s });
      }
      if (quakeIcons.length && !this._quakeImg) {
        this._quakeImg = new Image();
        this._quakeImg.src = QUAKE_ICON;
      }
    }

    // tsunami bulletins in force: waves rolling out from the epicentre in the colour of the alert
    const tsuLabels = [];
    if (!rp && this._config.tsunami !== false) {
      for (const e of this._tsunami || []) {
        const pr = this._project(e.p, G, R);
        const col = TSUNAMI_COLORS[e.level] || TSUNAMI_COLORS[1];
        const maxKm = e.level >= 4 ? 1600 : e.level >= 2 ? 1100 : 600;
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.12 + i / 3) % 1;
          const km = 40 + k * maxKm;
          ctx.strokeStyle = `rgba(${col},${(1 - k) * (e.level >= 2 ? 0.85 : 0.55)})`;
          ctx.lineWidth = e.level >= 2 ? 2.2 : 1.4;
          ctx.beginPath();
          let pen = false;
          for (let b = 0; b <= 360; b += 6) {
            const [la, lo] = destPoint(e.lat, e.lon, km, b);
            const q = this._project(ecef(la, lo), G, R);
            if (q.z <= 0.02) {
              pen = false;
              continue;
            }
            if (pen) ctx.lineTo(q.x, q.y);
            else ctx.moveTo(q.x, q.y);
            pen = true;
          }
          ctx.stroke();
        }
        if (pr.z > 0.03) {
          if (!this._tsuImg) {
            this._tsuImg = new Image();
            this._tsuImg.src = TSUNAMI_ICON;
          }
          const s = clamp(44 * Math.pow(zoom, 0.35), 38, 76) * smooth(0.03, 0.2, pr.z);
          const pulse = 0.6 + 0.4 * Math.sin(t * 4);
          // ground ring in the colour of the alert, the wave marker on top of it
          ctx.strokeStyle = `rgba(${col},${0.95 * pulse})`;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.ellipse(pr.x, pr.y, s * 0.42, s * 0.13, 0, 0, Math.PI * 2);
          ctx.stroke();
          // marker and label are drawn last, above the volcanoes and their names
          tsuLabels.push({ x: pr.x, y: pr.y, s, col, text: `${tsunamiTitle(e).toUpperCase()}${e.mag ? ` M${e.mag}` : ""}` });
          hits.push({ kind: "tsunami", v: e, x: pr.x, y: pr.y - s * 0.3, r: s * 0.5 });
        }
      }
    }

    // wildfires around home (NASA FIRMS): glowing embers, the strongest get the flame marker
    const fireIcons = [];
    if (!rp && this._config.fires !== false && this._fires?.length) {
      const kmPx = R / 6371;
      const ranked = [];
      for (const f of this._fires) {
        const pr = this._project(f.p, G, R);
        if (pr.z < 0.02) continue;
        const ageH = (Date.now() - new Date(f.time).getTime()) / HOUR;
        const fade = clamp(1 - Math.max(0, ageH - 12) / 48, 0.35, 1) * smooth(0.02, 0.15, pr.z);
        const cellR = f.cell ? f.cell * 111 * kmPx * 0.5 : 0;
        const r = Math.max(clamp(1.6 + Math.sqrt(f.mw) * 0.35 * Math.min(2, zoom * 0.4), 1.6, 14), Math.min(cellR, 26)) * (1 + 0.1 * Math.sin(t * 3 + f.lat * 7));
        const col = fireRgb(f.mw);
        const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, r * 2.2);
        g.addColorStop(0, `rgba(${col},${0.9 * fade})`);
        g.addColorStop(0.4, `rgba(${col},${0.4 * fade})`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        hits.push({ kind: "fire", v: f, x: pr.x, y: pr.y, r: Math.max(7, r * 1.4) });
        ranked.push({ f, pr, fade });
      }
      // flame markers: strongest first, never overlapping, more of them when zoomed in
      const s = clamp(16 + zoom * 3, 20, 40);
      const maxIcons = Math.round(clamp(zoom * 3, 4, 16));
      ranked.sort((a, b) => b.f.mw - a.f.mw);
      for (const it of ranked) {
        if (fireIcons.length >= maxIcons) break;
        if (it.f.mw < 5 && zoom < 3) continue;
        if (fireIcons.some((o) => Math.hypot(o.pr.x - it.pr.x, o.pr.y - it.pr.y) < s * 0.8)) continue;
        fireIcons.push({ ...it, s });
      }
      if (fireIcons.length && !this._fireImg) {
        this._fireImg = new Image();
        this._fireImg.src = FIRE_ICON;
      }
    }

    // active volcanoes, back to front
    const items = [];
    for (const v of rp ? rp.vols : this._volcanoes) {
      if (!this._visibleByFilter(v)) continue;
      const pr = this._project(v.p, G, R);
      if (pr.z <= 0.02) continue;
      if (pr.x < -150 || pr.x > W + 150 || pr.y < -60 || pr.y > H + 220) continue;
      items.push({ v, pr });
    }
    items.sort((a, b) => a.pr.y - b.pr.y);
    const sizeFor = (v) => {
      const base = v.level >= 4 ? 7.6 : v.level === 3 ? 6.8 : v.level === 2 ? 5.8 : v.level === 1 ? 4.7 : 4.4;
      return base * zf * (v.erupting ? 1.08 : 1);
    };

    // simulated ash drift along the forecast winds, on the ground below the cones
    if (this._config.wind_tracks !== false) {
      for (const { v } of items) {
        const w = v.wind;
        if (!w || !w.track || w.track.length < 2) continue;
        const sel = this._selected && this._selected.kind === "volcano" && this._selected.v.id === v.id;
        if (!sel && !plumesMap.has(v.id)) continue;
        this._drawTrack(ctx, w, G, R, sel, t);
      }
    }

    // satellite hotspots at the summit (NASA FIRMS): a hot glow on the ground, brighter with more radiative power
    if (this._config.thermal !== false) {
      for (const { v, pr } of items) {
        if (!v.thermal) continue;
        const ageH = (Date.now() - new Date(v.thermal.time).getTime()) / HOUR;
        const power = clamp(Math.log10(1 + (v.thermal.frp_mw || 0)) / 2.5, 0.25, 1);
        const fade = clamp(1 - ageH / 48, 0.35, 1) * smooth(0.02, 0.18, pr.z);
        const r = sizeFor(v) * (2.2 + power * 2.2) * (1 + 0.08 * Math.sin(t * 3 + v.lat));
        const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, r);
        g.addColorStop(0, `rgba(255,90,20,${0.75 * power * fade})`);
        g.addColorStop(0.5, `rgba(255,60,0,${0.32 * power * fade})`);
        g.addColorStop(1, "rgba(255,40,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(pr.x, pr.y, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const { v, pr } of items) {
      const s = sizeFor(v);
      const alpha = smooth(0.02, 0.18, pr.z);
      const night = this._nightAt(v.p, sun);
      if (v.level >= 4 || (v.level >= 3 && v.erupt > 0.5)) drawPulse(ctx, pr.x, pr.y, s, v.level, t + (v.lat % 1), alpha);
      drawVolcano(ctx, pr.x, pr.y, s, {
        level: v.level,
        erupting: v.erupt,
        night,
        t,
        alpha,
        selected: this._selected && this._selected.kind === "volcano" && this._selected.v.id === v.id,
      });
      hits.push({ kind: "volcano", v, x: pr.x, y: pr.y - s * 0.7, r: Math.max(16, s * 2.2) });
    }

    // ash plumes and glowing ejecta above the cones
    for (const { v, pr } of items) {
      const s = sizeFor(v);
      const alpha = smooth(0.02, 0.18, pr.z);
      const night = this._nightAt(v.p, sun);
      const craterY = pr.y - s * 1.45;
      const ej = ejectaMap.get(v.id);
      if (ej) ej.draw(ctx, pr.x, craterY, s, night, alpha);
      const plume = plumesMap.get(v.id);
      if (plume) {
        const dir = plume.dirDeg != null ? this._screenDir(v, G, plume.dirDeg) : null;
        const pzf = clamp(Math.pow(zoom, 0.5), 0.9, 3.0);
        plume.draw(ctx, pr.x, craterY, s, pzf, dir, night, v.erupt, t, alpha, clamp(zoom / 2.5, 0.4, 2.4) * perf(this._eco).lod);
      }
    }

    // labels
    if (this._config.labels !== false) {
      ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
      ctx.textBaseline = "middle";
      const placed = [];
      const ranked = items.slice().sort((a, b) => (b.v.level + (b.v.erupting ? 2 : 0)) - (a.v.level + (a.v.erupting ? 2 : 0)));
      for (const { v, pr } of ranked) {
        const sel = this._selected && this._selected.kind === "volcano" && this._selected.v.id === v.id;
        const show = sel || v.level >= 3 || v.erupting || (v.ash && v.ash.source === "vona") || (zoom >= 3 && v.level >= 2) || zoom >= 6;
        if (!show) continue;
        const s = sizeFor(v);
        const text = v.local || v.name;
        const tw = ctx.measureText(text).width;
        const lx = pr.x + s * 1.5 + 4;
        const ly = pr.y - s * 0.55;
        const rect = [lx - 4, ly - 8, tw + 8, 16];
        if (rect[0] + rect[2] > W - 4 || ly < this._topPad()) continue;
        if (placed.some((r) => rect[0] < r[0] + r[2] && rect[0] + rect[2] > r[0] && rect[1] < r[1] + r[3] && rect[1] + rect[3] > r[1])) continue;
        placed.push(rect);
        const alpha = smooth(0.1, 0.3, pr.z);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(6,8,14,0.62)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(rect[0], rect[1], rect[2], rect[3], 8);
        else ctx.rect(rect[0], rect[1], rect[2], rect[3]);
        ctx.fill();
        ctx.fillStyle = v.level >= 2 ? rgba(LEVEL_COLORS[v.level], 1) : "#f1efe9";
        ctx.fillText(text, lx, ly + 0.5);
        ctx.globalAlpha = 1;
      }
      // quiet volcanoes get muted names once a region is zoomed in
      if (zoom >= 4.5 && quiet.length) {
        ctx.font = "500 10.5px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
        const maxLabels = zoom >= 8 ? 60 : 30;
        let count = 0;
        const ordered = quiet.slice().sort((a, b) => (b.c.elev || 0) - (a.c.elev || 0));
        for (const { c, pr } of ordered) {
          if (count >= maxLabels) break;
          const text = c.name;
          const tw = ctx.measureText(text).width;
          const lx = pr.x + catS * 1.3 + 3;
          const ly = pr.y - catS * 0.5;
          const rect = [lx - 3, ly - 7, tw + 6, 14];
          if (rect[0] + rect[2] > W - 48 || ly < this._topPad() + 4 || ly > H - 40) continue;
          if (placed.some((r) => rect[0] < r[0] + r[2] && rect[0] + rect[2] > r[0] && rect[1] < r[1] + r[3] && rect[1] + rect[3] > r[1])) continue;
          placed.push(rect);
          count += 1;
          ctx.globalAlpha = smooth(0.15, 0.35, pr.z) * 0.85;
          ctx.fillStyle = "rgba(6,8,14,0.5)";
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(rect[0], rect[1], rect[2], rect[3], 7);
          else ctx.rect(rect[0], rect[1], rect[2], rect[3]);
          ctx.fill();
          ctx.fillStyle = "#cfcac3";
          ctx.fillText(text, lx, ly + 0.5);
          ctx.globalAlpha = 1;
        }
      }
    }
    for (const it of fireIcons) {
      const img = this._fireImg;
      const col = fireRgb(it.f.mw);
      const ring = 1 + 0.08 * Math.sin(t * 4 + it.f.lon * 5);
      ctx.globalAlpha = it.fade;
      ctx.strokeStyle = `rgba(${col},.95)`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(it.pr.x, it.pr.y, it.s * 0.42 * ring, it.s * 0.14 * ring, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (img && img.complete && img.naturalWidth) {
        const h = it.s * (1 + 0.05 * Math.sin(t * 9 + it.f.lat * 13));
        ctx.drawImage(img, it.pr.x - it.s / 2, it.pr.y - h * (115 / 128), it.s, h);
      }
      ctx.globalAlpha = 1;
    }
    for (const it of quakeIcons) {
      const img = this._quakeImg;
      const col = quakeRgb(it.q.mag);
      const ring = 1 + 0.08 * Math.sin(t * 4 + it.q.lon * 5);
      ctx.globalAlpha = Math.max(it.fade, 0.6);
      ctx.strokeStyle = `rgba(${col},.95)`;
      ctx.lineWidth = it.sel ? 2.4 : 1.8;
      ctx.beginPath();
      ctx.ellipse(it.pr.x, it.pr.y, it.s * 0.42 * ring, it.s * 0.14 * ring, 0, 0, Math.PI * 2);
      ctx.stroke();
      // the icon stands above the epicentre: it is a tap target of its own
      hits.push({ kind: "quake", v: it.q, x: it.pr.x, y: it.pr.y - it.s * 0.4, r: it.s * 0.42 });
      if (img && img.complete && img.naturalWidth) {
        // the marker stands on its foot (y = 96 of 128) and trembles a little
        const shake = Math.sin(t * 40 + it.q.lat) * 0.8;
        ctx.drawImage(img, it.pr.x - it.s / 2 + shake, it.pr.y - it.s * (96 / 128), it.s, it.s);
      }
      if (zoom >= 1.4 || it.sel) {
        const text = `M${it.q.mag.toFixed(1)}`;
        ctx.font = "700 10.5px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(5,8,12,.85)";
        ctx.strokeText(text, it.pr.x, it.pr.y + it.s * 0.32);
        ctx.fillStyle = `rgb(${col})`;
        ctx.fillText(text, it.pr.x, it.pr.y + it.s * 0.32);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
      ctx.globalAlpha = 1;
    }
    for (const l of tsuLabels) {
      const img = this._tsuImg;
      if (img && img.complete && img.naturalWidth) {
        const bob = Math.sin(t * 3) * l.s * 0.02;
        ctx.drawImage(img, l.x - l.s / 2, l.y - l.s * 0.75 + bob, l.s, l.s);
      } else {
        ctx.fillStyle = `rgb(${l.col})`;
        ctx.beginPath();
        ctx.arc(l.x, l.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = "700 12px system-ui, sans-serif";
      const w = ctx.measureText(l.text).width + 16;
      const y = l.y - l.s * 0.55 - 14;
      ctx.fillStyle = "rgba(10,10,14,.82)";
      ctx.strokeStyle = `rgba(${l.col},.9)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(l.x - w / 2, y - 11, w, 22, 11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `rgb(${l.col})`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(l.text, l.x, y + 0.5);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
    this._hits = hits;
  }
}

const EDITOR_SCHEMA = [
  { name: "title", selector: { text: {} } },
  {
    name: "center",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "home", label: "Home" },
          { value: "world", label: "Whole globe" },
          { value: "ring_of_fire", label: "Ring of Fire" },
          ...REGIONS.map(([key, label]) => ({ value: key, label })),
        ],
      },
    },
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "height", selector: { number: { min: 240, max: 1600, step: 20, unit_of_measurement: "px", mode: "box" } } },
      { name: "zoom", selector: { number: { min: 0.8, max: 14, step: 0.1, mode: "box" } } },
    ],
  },
  {
    name: "performance",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "auto", label: "Automatic (eco on weak devices)" },
          { value: "full", label: "Full quality" },
          { value: "eco", label: "Eco (weak wall tablets)" },
        ],
      },
    },
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "regions", selector: { boolean: {} } },
      { name: "labels", selector: { boolean: {} } },
      { name: "show_all", selector: { boolean: {} } },
      { name: "rotate", selector: { boolean: {} } },
      { name: "daylight", selector: { boolean: {} } },
      { name: "weekly_ash", selector: { boolean: {} } },
      { name: "wind_tracks", selector: { boolean: {} } },
      { name: "ash_areas", selector: { boolean: {} } },
      { name: "quakes", selector: { boolean: {} } },
      { name: "tsunami", selector: { boolean: {} } },
      { name: "thermal", selector: { boolean: {} } },
      { name: "fires", selector: { boolean: {} } },
      { name: "replay", selector: { boolean: {} } },
      { name: "cams", selector: { boolean: {} } },
    ],
  },
];
const EDITOR_LABELS = {
  title: "Title",
  center: "Start view",
  height: "Height",
  zoom: "Zoom (empty = automatic)",
  regions: "Region buttons",
  labels: "Volcano names",
  show_all: "All known volcanoes",
  rotate: "Slow rotation",
  performance: "Performance",
  daylight: "Daylight (whole globe lit)",
  weekly_ash: "Ash from the weekly report",
  wind_tracks: "Ash drift tracks (wind)",
  ash_areas: "Official ash areas (SIGMET)",
  quakes: "Earthquakes",
  tsunami: "Tsunami warnings",
  thermal: "Satellite hotspots (NASA FIRMS key needed)",
  fires: "Wildfires around home (NASA FIRMS key needed)",
  replay: "Replay button (90 days)",
  cams: "Live camera images",
};

class MagmariumCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => EDITOR_LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const value = { ...ev.detail.value };
        for (const k of Object.keys(value)) if (value[k] === "" || value[k] == null) delete value[k];
        this._config = value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: value }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = {
      center: "home",
      regions: true,
      labels: true,
      show_all: true,
      rotate: false,
      daylight: true,
      weekly_ash: true,
      wind_tracks: true,
      ash_areas: true,
      quakes: true,
      tsunami: true,
      thermal: true,
      fires: true,
      replay: true,
      cams: true,
      ...this._config,
      center: Array.isArray(this._config.center) ? "home" : this._config.center || "home",
    };
  }
}

if (!customElements.get("magmarium-card-editor")) {
  customElements.define("magmarium-card-editor", MagmariumCardEditor);
}

if (!customElements.get("magmarium-card")) {
  customElements.define("magmarium-card", MagmariumCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "magmarium-card",
    name: "Magmarium",
    description: "Active volcanoes on a living globe with alert levels, eruptions and ash clouds.",
    preview: true,
    documentationURL: "https://github.com/mb26-dev/ha-magmarium",
  });
  console.info(`%c MAGMARIUM %c ${VERSION} `, "background:#ff8a1f;color:#111;font-weight:700", "background:#222;color:#ffab4a");
}

// ====================================================================== compact volcano card

/** data of the integration, shared by all volcano cards on a page */
const VC_DATA = { at: 0, data: null, busy: null };

async function loadVolcanoData(hass, force = false) {
  if (!force && VC_DATA.data && Date.now() - VC_DATA.at < DATA_REFRESH_MS - 5000) return VC_DATA.data;
  if (VC_DATA.busy) return VC_DATA.busy;
  VC_DATA.busy = (async () => {
    try {
      const resp = await hass.fetchWithAuth("/api/magmarium/volcanoes");
      if (resp.status === 503) throw new Error("loading");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      VC_DATA.data = await resp.json();
      VC_DATA.at = Date.now();
      return VC_DATA.data;
    } finally {
      VC_DATA.busy = null;
    }
  })();
  return VC_DATA.busy;
}

// regional map cards for wildfires, earthquakes and lightning (own module, shares the data download)
defineMapCards({ VERSION, loadData: loadVolcanoData, refreshMs: DATA_REFRESH_MS });

/** sun elevation in degrees at a place and time (simple solar position, good to about 1 degree) */
function sunElevation(lat, lon, ms) {
  const rad = Math.PI / 180;
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}

/** eruption strength 0..1 the same way the globe computes it */
function eruptStrength(v) {
  const er = v.eruption;
  if (er && er.source === "vona") return clamp(1 - ((er.age_min || 0) / (24 * 60)) * 0.6, 0.4, 1);
  return er ? 0.45 : 0;
}

/** most active first: alert level, eruption, fresh VONA */
function activityScore(v) {
  const er = v.eruption;
  const fresh = er && er.source === "vona" ? Math.max(0, 1 - (er.age_min || 0) / (24 * 60)) : 0;
  return (v.level || 0) * 10 + (v.erupting ? 4 : 0) + (v.ash ? 2 : 0) + fresh * 3;
}

const VC_SHOW = ["scene", "tsunami", "eruption", "ash", "thermal", "sigmets", "quakes", "wind", "camera", "notice", "links"];

const VC_STYLE = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); color: #f3f1ee;
    background: radial-gradient(120% 90% at 0% 0%, #2a1408 0%, #120a07 45%, #050304 100%);
    font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); }
  .scene { position: relative; height: 150px; overflow: hidden; }
  .scene canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .scene .ov { position: absolute; left: 12px; right: 12px; top: 10px; pointer-events: none; text-shadow: 0 1px 4px rgba(0,0,0,.9); }
  .scene.nav, .row.nav, .head.nav { cursor: pointer; }
  .brand { display: flex; align-items: baseline; gap: 6px; font-size: 13px; font-weight: 650; letter-spacing: .4px; }
  .brand b { font-weight: 650; }
  .brand b span { color: #ffab4a; }
  .brand .sub { margin-left: auto; font-size: 10.5px; font-weight: 400; letter-spacing: 0; opacity: .7; }
  .wrap { padding: 10px 14px 12px; font-size: 12.5px; line-height: 1.45; }
  .head { margin-bottom: 4px; }
  .head h3 { margin: 0; font-size: 17px; font-weight: 650; line-height: 1.2; }
  .head .where { opacity: .72; font-size: 11.5px; }
  .badges { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0 4px; }
  .badge { font-size: 10.5px; font-weight: 650; letter-spacing: .4px; padding: 2px 8px; border-radius: 10px; color: #111; white-space: nowrap; }
  .badge.soft { background: rgba(255,255,255,.1); color: #eee; font-weight: 500; letter-spacing: 0; }
  .badge.hot { background: #ff5a1f; color: #fff; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; margin-top: 8px; }
  .tile { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 6px 8px; min-width: 0; }
  .tile .k { font-size: 10.5px; opacity: .65; text-transform: uppercase; letter-spacing: .5px; }
  .tile .v { font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .s { font-size: 11px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .line { display: flex; gap: 8px; align-items: flex-start; margin: 6px 0; }
  .line .ic { flex: 0 0 18px; text-align: center; }
  .line .tx { flex: 1 1 auto; min-width: 0; }
  .muted { opacity: .65; font-size: 11px; }
  .notice { margin-top: 8px; padding: 8px 10px; background: rgba(255,255,255,.05); border-radius: 8px; font-size: 12px; max-height: 96px; overflow-y: auto; }
  .links { margin-top: 9px; display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; }
  .links a { color: #ffb965; text-decoration: none; }
  .cam { margin: 8px 0 4px; border-radius: 8px; overflow: hidden; position: relative; background: #000; }
  .cam a { display: block; color: #fff; text-decoration: none; }
  .cam img { display: block; width: 100%; height: auto; max-height: 200px; object-fit: cover; }
  .cam .tag { position: absolute; left: 0; right: 0; bottom: 0; padding: 16px 8px 5px; font-size: 10.5px;
    background: linear-gradient(transparent, rgba(0,0,0,.8)); display: flex; justify-content: space-between; gap: 8px; }
  .cam .live { color: #ff6b5a; font-weight: 700; letter-spacing: .4px; }
  .list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .row { display: grid; grid-template-columns: 46px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 2px 8px 2px 2px; border-radius: 10px; background: rgba(255,255,255,.04); }
  .row canvas { width: 46px; height: 46px; display: block; }
  .row canvas.ash { width: 64px; height: 74px; margin: 0 -9px; }
  .row .n { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .n .muted { display: block; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .m { text-align: right; white-space: nowrap; }
  .row .m .muted { display: block; }
  .row .m .badge + .badge { margin-left: 4px; }
  .row.det { align-items: start; padding: 6px 10px 8px 4px; }
  .row.det canvas { margin-top: 2px; grid-row: 1 / span 2; }
  .row.det { grid-template-columns: 46px minmax(0,1fr); row-gap: 2px; }
  .row.det .n { white-space: normal; }
  .row .d { grid-column: 2 / 3; min-width: 0; }
  .row .d .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 2px; }
  .row .d .chip { font-size: 10.5px; padding: 2px 8px; border-radius: 10px; background: rgba(255,255,255,.08); max-width: 100%; box-sizing: border-box; }
  .row .d .chip.hot { background: rgba(255,90,31,.22); color: #ffb48a; }
  .row .d .nt { margin-top: 4px; font-size: 11.5px; line-height: 1.4; opacity: .9; }
  .row .d .nt.clamp { display: -webkit-box; -webkit-line-clamp: var(--lines, 3); -webkit-box-orient: vertical; overflow: hidden; }
  .row .d .nt.clamp.open { display: block; -webkit-line-clamp: unset; overflow: visible; }
  .row .d .more { background: none; border: 0; padding: 2px 0 0; margin: 0; font: inherit; font-size: 11px; font-weight: 600; color: #ffb965; cursor: pointer; }
  .msg { opacity: .75; padding: 12px 14px; }
  .tsu { margin: 6px 10px 2px; padding: 8px 12px; border-radius: 12px; font-size: 12px; line-height: 1.35; background: rgba(var(--tc),.16); border: 1px solid rgba(var(--tc),.55); }
  .tsu b { color: rgb(var(--tc)); }
  .tsu .tsi { width: 34px; height: 34px; float: left; margin: -4px 8px 0 -4px; }
  .tsu a { color: rgb(var(--tc)); font-weight: 600; text-decoration: none; }
  .tsu .muted { display: block; }
`;

class MagmariumVolcanoCard extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.innerHTML = `<style>${VC_STYLE}</style><ha-card><div class="body"><div class="msg">Loading Magmarium...</div></div></ha-card>`;
    this._body = this._root.querySelector(".body");
    this._scenes = [];
    this._plumes = new Map();
    this._ejecta = new Map();
    this._t = 0;
    this._last = 0;
  }

  static getConfigElement() {
    return document.createElement("magmarium-volcano-card-editor");
  }

  static getStubConfig() {
    return { volcano: "auto" };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    if (config.volcanoes != null && !Array.isArray(config.volcanoes)) throw new Error("volcanoes must be a list of volcano ids");
    this._config = { volcano: "auto", count: 5, ...config };
    if (this._data) this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  connectedCallback() {
    if (this._hass && !this._timer) this._load();
    if (!this._io) {
      this._io = new IntersectionObserver((entries) => {
        this._visible = entries.some((en) => en.isIntersecting);
      });
    }
    this._io.observe(this);
    this._startLoop();
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
    this._timer = null;
    this._io?.disconnect();
    cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  getCardSize() {
    const n = this._config.volcanoes?.length || this._config.count || 5;
    return this._isList() ? 1 + (this._config.details ? n * 2 : n) : 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  _isList() {
    return (Array.isArray(this._config.volcanoes) && this._config.volcanoes.length > 0) || this._config.volcano === "list";
  }

  _show(key) {
    return this._config[key] !== false;
  }

  async _load() {
    clearTimeout(this._timer);
    let wait = DATA_REFRESH_MS;
    try {
      this._data = await loadVolcanoData(this._hass);
      this._render();
    } catch (err) {
      wait = 30000;
      if (!this._data) this._body.innerHTML = `<div class="msg">${err.message === "loading" ? "Magmarium is collecting the first volcano reports..." : `Volcano data not available (${esc(err.message)}). Is the Magmarium integration set up?`}</div>`;
    }
    this._timer = setTimeout(() => this._load(), wait);
  }

  _volcanoes() {
    return (this._data?.volcanoes || []).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon));
  }

  _pick() {
    const list = this._volcanoes();
    const id = this._config.volcano;
    if (id && id !== "auto" && id !== "list") return list.find((v) => v.id === id || v.number === Number(String(id).replace("gvp:", ""))) || null;
    return list.slice().sort((a, b) => activityScore(b) - activityScore(a))[0] || null;
  }

  _navigate() {
    const path = this._config.navigation_path;
    if (!path) return;
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  _brand() {
    if (this._config.title === false) return "";
    const updated = this._data?.updated ? rel(new Date(this._data.updated * 1000).toISOString()) : "";
    return `<div class="brand"><b>${this._config.title ? esc(this._config.title) : "Magma<span>rium</span>"}</b><span class="sub">${esc(updated)}</span></div>`;
  }

  _plumeFor(v) {
    if (!v.ash) return null;
    const ash = { ...v.ash, elev: v.elev };
    if (ash.toward_deg == null && v.wind && v.wind.toward_deg != null) ash.toward_deg = v.wind.toward_deg;
    let p = this._plumes.get(v.id);
    if (p) p.update(ash);
    else {
      p = new AshPlume(v.id, ash);
      this._plumes.set(v.id, p);
    }
    return p;
  }

  /** ash for the icon of a list row: the live cloud, or the last reported one of the newest VONA */
  _rowAsh(v) {
    if (!this._show("ash")) return null;
    if (v.ash) return { ash: v.ash, live: true };
    const n = v.notice;
    if (n && n.kind === "vona" && n.ash) return { ash: n.ash, live: false };
    return null;
  }

  _rowPlume(v) {
    const ra = this._rowAsh(v);
    if (!ra) return null;
    if (ra.live) return this._plumeFor(v);
    // the last reported cloud, older than the live window: the same plume, but fainter
    const ash = { source: "vona", intensity: "medium", ...ra.ash, strength: 0.45, elev: v.elev };
    if (ash.toward_deg == null && v.wind && v.wind.toward_deg != null) ash.toward_deg = v.wind.toward_deg;
    const key = `${v.id}:last`;
    let p = this._plumes.get(key);
    if (p) p.update(ash);
    else {
      p = new AshPlume(key, ash);
      this._plumes.set(key, p);
    }
    return p;
  }

  _ejectaFor(v) {
    const er = v.eruption;
    if (!(er && er.source === "vona" && (er.age_min ?? 9999) <= 360)) return null;
    if (!this._ejecta.has(v.id)) this._ejecta.set(v.id, new Ejecta(v.id));
    return this._ejecta.get(v.id);
  }

  _render() {
    if (!this._data) return;
    this._scenes = [];
    if (this._isList()) this._renderList();
    else this._renderOne();
    this._startLoop();
  }

  // ------------------------------------------------------------------ list

  _renderList() {
    let list = this._volcanoes();
    const home = this._data.home;
    const hasHome = !!(home && Number.isFinite(home[0]));
    const distOf = (v) => (hasHome ? distKm(home[0], home[1], v.lat, v.lon) : null);
    const byDistance = this._config.sort === "distance" && hasHome;
    const count = Math.max(1, Number(this._config.count) || 5);
    if (Array.isArray(this._config.volcanoes) && this._config.volcanoes.length) {
      list = this._config.volcanoes.map((id) => list.find((v) => v.id === id)).filter(Boolean);
      if (byDistance) list.sort((a, b) => distOf(a) - distOf(b));
    } else if (byDistance) {
      // the nearest volcanoes with something going on: raised alert level, eruption or ash
      list = list
        .filter((v) => (v.level || 0) >= 2 || v.eruption || v.ash)
        .sort((a, b) => distOf(a) - distOf(b))
        .slice(0, count);
    } else {
      list = list.slice().sort((a, b) => activityScore(b) - activityScore(a)).slice(0, count);
    }
    const details = this._config.details === true;
    const rows = list.map((v, i) => {
      const dist = distOf(v);
      const where = [v.country, dist != null ? `${fmtInt(Math.round(dist))} km${details ? " from home" : ""}` : ""].filter(Boolean).join(" · ");
      const state = v.eruption ? (v.eruption.source === "vona" ? `Eruption ${rel(v.eruption.time)}` : "Erupting") : v.ash ? "Ash emission" : (v.weekly?.status || "");
      const badge = `<span class="badge" style="background:${LEVEL_COLORS[v.level] || LEVEL_COLORS[0]}">${esc((LEVEL_NAMES[v.level] || "Unknown").toUpperCase())}</span>`;
      const ashy = !!this._rowAsh(v);
      return `<div class="row${details ? " det" : ""}${this._config.navigation_path ? " nav" : ""}"><canvas data-i="${i}"${ashy ? ' class="ash"' : ""} width="${ashy ? 128 : 92}" height="${ashy ? 148 : 92}"></canvas>`
        + `<div class="n">${esc(v.local || v.name)}<span class="muted">${esc(where)}</span></div>`
        + (details
          ? this._rowDetails(v, badge)
          : `<div class="m">${badge}${v.color ? `<span class="badge soft">VONA ${esc(v.color)}</span>` : ""}<span class="muted">${esc(state)}</span></div>`)
        + `</div>`;
    });
    this._body.innerHTML = `<div class="wrap">${this._brand()}${this._tsunamiBanner()}${rows.length ? `<div class="list">${rows.join("")}</div>` : `<div class="msg">None of these volcanoes is in the current reports.</div>`}</div>`;
    this._body.querySelectorAll(".row canvas").forEach((cv) => {
      const v = list[Number(cv.dataset.i)];
      this._scenes.push({ kind: "icon", cv, v, erupt: eruptStrength(v), ej: this._ejectaFor(v), plume: this._rowPlume(v) });
    });
    if (this._config.navigation_path) this._body.querySelectorAll(".row").forEach((r) => r.addEventListener("click", () => this._navigate()));
    this._body.querySelectorAll(".more").forEach((btn) => btn.addEventListener("click", (ev) => {
      // only open the text, never the globe
      ev.stopPropagation();
      if (!this._open) this._open = new Set();
      const k = btn.dataset.k;
      const nt = btn.previousElementSibling;
      const open = !this._open.has(k);
      if (open) this._open.add(k);
      else this._open.delete(k);
      nt.classList.toggle("open", open);
      btn.textContent = open ? "Show less" : "Show more";
    }));
  }

  /** time zone of Home Assistant, e.g. "Asia/Bangkok" */
  _tz() {
    return (this._hass && this._hass.config && this._hass.config.time_zone) || undefined;
  }

  /** "18 Nov, 12:09" in the time zone of Home Assistant */
  _localTime(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return "";
    try {
      return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: this._tz() });
    } catch (_err) {
      return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    }
  }

  /** "Eruption at 05:09 UTC (12:09 local)" -> "Eruption at 12:09 Bangkok time" */
  _localizeNotice(text, iso) {
    const tz = this._tz();
    const issued = new Date(iso);
    if (!tz || Number.isNaN(issued.getTime())) return text;
    const city = tz.split("/").pop().replace(/_/g, " ");
    return text.replace(/\b([01]\d|2[0-3]):([0-5]\d)\s*UTC(?:\s*\(\s*[0-2]\d:[0-5]\d\s*local\s*\))?/g, (m, hh, mm) => {
      const d = new Date(issued);
      d.setUTCHours(Number(hh), Number(mm), 0, 0);
      // the notice can be issued shortly after midnight for an eruption the day before
      if (d.getTime() - issued.getTime() > 3 * 3600 * 1000) d.setUTCDate(d.getUTCDate() - 1);
      try {
        return `${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz })} ${city} time`;
      } catch (_err) {
        return m;
      }
    });
  }

  /** tsunami warnings, watches and advisories in force: a banner above the volcanoes */
  _tsunamiBanner() {
    if (!this._show("tsunami")) return "";
    const home = this._data && this._data.home;
    const events = ((this._data && this._data.tsunami) || []).filter((e) => e.level >= 2);
    return events.slice(0, 2).map((e) => {
      const col = TSUNAMI_COLORS[e.level] || TSUNAMI_COLORS[2];
      const dist = home && Number.isFinite(home[0]) ? distKm(home[0], home[1], e.lat, e.lon) : null;
      const bits = [e.region, e.mag ? `M${e.mag}` : "", rel(e.time), dist != null ? `${fmtInt(Math.round(dist))} km from home` : ""].filter(Boolean);
      return `<div class="tsu" style="--tc:${col}"><img class="tsi" src="${TSUNAMI_ICON}" alt=""><b>${esc(tsunamiTitle(e))}</b> · ${esc(bits.join(" · "))}`
        + `<span class="muted">${esc((e.sources || []).join(", "))}${e.url ? ` · <a href="${esc(e.url)}" target="_blank" rel="noopener">bulletin</a>` : ""}</span></div>`;
    }).join("");
  }

  /** a long report: shortened to `text_lines` lines with "Show more" (text_lines: 0 shows it in full) */
  _longText(id, head, body) {
    const lines = Number(this._config.text_lines ?? 3);
    const html = `<span class="muted">${esc(head)}</span> ${esc(body)}`;
    // roughly 55 characters fit in one line of the list
    if (!(lines > 0) || (head.length + body.length) <= lines * 55) return `<div class="nt">${html}</div>`;
    const open = this._open && this._open.has(id);
    return `<div class="nt clamp${open ? " open" : ""}" style="--lines:${Math.round(lines)}">${html}</div>`
      + `<button class="more" data-k="${esc(id)}">${open ? "Show less" : "Show more"}</button>`;
  }

  /** list row in detail mode: eruption, ash cloud, SIGMETs and the latest report */
  _rowDetails(v, badge) {
    const chips = [badge];
    if (v.color && !(v.notice && v.notice.kind === "vona")) chips.push(`<span class="badge soft">VONA ${esc(v.color)}</span>`);
    const n = v.notice && v.notice.kind === "vona" ? v.notice : null;
    const ashText = (a) => {
      const parts = [];
      if (a.top_m != null) parts.push(`${fmtInt(a.top_m)} m a.s.l.`);
      if (a.above_summit_m != null) parts.push(`${fmtInt(a.above_summit_m)} m above summit`);
      return `☁️ Ash cloud${parts.length ? ` ${parts.join(" · ")}` : ""}${a.toward_deg != null ? ` → ${compass(a.toward_deg)}` : ""}`;
    };
    if (this._show("eruption")) {
      if (v.eruption) {
        const er = v.eruption;
        chips.push(`<span class="chip hot">🌋 ${er.source === "vona" ? `Eruption ${esc(rel(er.time))}` : "Eruptive activity"}</span>`);
      } else if (n && n.eruption) {
        // the newest notice reported an eruption, but it is older than the live window
        chips.push(`<span class="chip">🌋 Last eruption ${esc(rel(n.time))}</span>`);
      }
    }
    if (this._show("ash")) {
      if (v.ash) {
        chips.push(`<span class="chip hot">${esc(ashText(v.ash))}</span>`);
      } else if (n && n.ash) {
        // the last reported ash cloud, older than the live window
        chips.push(`<span class="chip">${esc(ashText(n.ash))} · ${esc(rel(n.time))}</span>`);
      } else if (n) {
        chips.push(`<span class="chip">☁️ No ash cloud observed</span>`);
      }
    }
    if (this._show("sigmets") && v.sigmets && v.sigmets.length) {
      chips.push(`<span class="chip">✈ Ash SIGMET${v.sigmets.length > 1 ? ` ×${v.sigmets.length}` : ""}</span>`);
    }
    if (this._show("thermal") && v.thermal) {
      chips.push(`<span class="chip hot">🔥 Thermal ${v.thermal.count} hotspot${v.thermal.count > 1 ? "s" : ""} · ${fmtInt(v.thermal.frp_mw)} MW · ${esc(rel(v.thermal.time))}</span>`);
    }
    if (this._show("quakes") && v.quakes_7d) {
      chips.push(`<span class="chip">〰 ${v.quakes_7d} quake${v.quakes_7d > 1 ? "s" : ""} 7 d${v.quake_max != null ? ` · M${v.quake_max}` : ""}</span>`);
    }
    let text = "";
    if (this._show("notice")) {
      const nt = v.notice;
      if (nt && nt.kind === "vona" && nt.text) {
        const head = `VONA ${nt.color || ""} · ${this._localTime(nt.time)} · ${rel(nt.time)}`;
        // VONA notices are short and the important part: always in full
        text = `<div class="nt"><span class="muted">${esc(head)}</span> ${esc(this._localizeNotice(tidyNotice(nt.text), nt.time))}</div>`;
      } else if (nt && nt.text) {
        text = this._longText(v.id, nt.kind === "weekly" ? `Weekly report ${nt.period || ""}` : "Latest report", nt.text);
      } else if (v.weekly && v.weekly.text) {
        text = this._longText(v.id, `Weekly report ${v.weekly.period || ""}`, v.weekly.text);
      }
    }
    return `<div class="d"><div class="chips">${chips.join("")}</div>${text}</div>`;
  }

  // ------------------------------------------------------------------ one volcano

  _renderOne() {
    const v = this._pick();
    if (!v) {
      this._body.innerHTML = `<div class="wrap">${this._brand()}<div class="msg">Volcano "${esc(this._config.volcano)}" is not in the current reports. Pick one in the card editor.</div></div>`;
      return;
    }
    const home = this._data.home;
    const dist = home && Number.isFinite(home[0]) ? distKm(home[0], home[1], v.lat, v.lon) : null;
    const where = [v.province, v.country].filter(Boolean).join(", ");
    const parts = [];
    const nav = this._config.navigation_path ? " nav" : "";
    if (this._show("scene")) {
      parts.push(`<div class="scene${nav}"><canvas width="10" height="10"></canvas><div class="ov">${this._brand()}</div></div>`);
    }
    parts.push(`<div class="wrap">${this._show("scene") ? "" : this._brand()}${this._tsunamiBanner()}`);
    const badges = [`<span class="badge" style="background:${LEVEL_COLORS[v.level] || LEVEL_COLORS[0]}">${esc((LEVEL_NAMES[v.level] || "Unknown").toUpperCase())}</span>`];
    if (v.eruption) badges.push(`<span class="badge hot">ERUPTING</span>`);
    if (v.color) badges.push(`<span class="badge soft">VONA ${esc(v.color)}</span>`);
    parts.push(`<div class="head${nav}"><h3>${esc(this._config.name || v.local || v.name)}</h3><div class="where">${esc(where)}${v.local && v.local !== v.name ? ` · GVP: ${esc(v.name)}` : ""}</div><div class="badges">${badges.join("")}</div></div>`);
    if (v.alert || (v.official && v.official.alert)) {
      const o = v.official;
      parts.push(`<div class="line"><span class="ic">🏛</span><span class="tx">${esc(v.alert || o.alert)}${o ? `<div class="muted">${esc(OFFICIAL_NAMES[o.source] || o.source)}${o.time ? ` · ${esc(rel(o.time))}` : ""}</div>` : ""}</span></div>`);
    }
    const tiles = [];
    const tile = (k, val, sub) => `<div class="tile"><div class="k">${k}</div><div class="v">${val}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
    if (this._show("eruption") && v.eruption) {
      const er = v.eruption;
      tiles.push(tile("Eruption", er.source === "vona" ? esc(rel(er.time)) : er.source === "sigmet" ? "Ash SIGMET" : "Ongoing", er.source === "vona" ? "VONA report" : er.source === "sigmet" ? "official ash area" : "weekly report"));
    }
    if (this._show("ash") && v.ash) {
      const a = v.ash;
      const val = a.above_summit_m != null ? `${fmtInt(a.above_summit_m)} m` : a.top_m != null ? `${fmtInt(a.top_m)} m` : "reported";
      const sub = [a.above_summit_m != null ? "above summit" : a.top_m != null ? "a.s.l." : "", a.toward_deg != null ? `drift ${compass(a.toward_deg)}` : ""].filter(Boolean).join(" · ");
      tiles.push(tile("Ash cloud", val, esc(sub)));
    }
    if (this._show("wind") && v.wind) {
      const w = v.wind;
      tiles.push(tile("Wind", `${fmtInt(Math.round(w.speed_kmh))} km/h ${compass(w.toward_deg)}`, `toward · at ${w.alt_km} km`));
    }
    if (this._show("thermal") && v.thermal) {
      tiles.push(tile("Thermal", `${fmtInt(v.thermal.frp_mw)} MW`, `${v.thermal.count} hotspot${v.thermal.count > 1 ? "s" : ""} · ${rel(v.thermal.time)}`));
    }
    if (this._show("quakes") && v.quakes_7d) {
      tiles.push(tile("Quakes 7 d", `${v.quakes_7d}`, v.quake_max != null ? `strongest M${v.quake_max}` : "within 30 km"));
    }
    const meta = [];
    if (v.elev != null) meta.push(`${fmtInt(v.elev)} m`);
    if (dist != null) tiles.push(tile("From home", `${fmtInt(Math.round(dist))} km`, meta.join(" · ") || ""));
    else if (meta.length) tiles.push(tile("Summit", meta[0], ""));
    if (tiles.length) parts.push(`<div class="tiles">${tiles.join("")}</div>`);
    if (this._show("sigmets")) {
      for (const sg of v.sigmets || []) {
        parts.push(`<div class="line"><span class="ic">✈</span><span class="tx">Ash SIGMET ${esc(sg.fir || "")}${sg.top_m != null ? ` · up to ${fmtInt(sg.top_m)} m` : ""}<div class="muted">${sg.to ? `valid until ${esc(utc(sg.to))}` : ""}</div></span></div>`);
      }
    }
    if (this._show("camera")) parts.push(this._camHtml(v.id));
    if (this._show("notice")) {
      const n = v.notice;
      if (n) {
        const head = n.kind === "vona" ? `VONA ${esc(n.color || "")} · ${esc(rel(n.time))}` : `Weekly report ${esc(n.period || "")}`;
        parts.push(`<div class="notice"><div class="muted">${head}</div>${esc(tidyNotice(n.text))}</div>`);
      } else if (v.weekly) {
        parts.push(`<div class="notice"><div class="muted">Weekly report ${esc(v.weekly.period || "")}</div>${esc(v.weekly.text || "")}</div>`);
      }
    }
    if (this._show("links")) {
      const links = [];
      const n = v.notice;
      if (n && n.url && n.kind === "vona") links.push(`<a href="${esc(n.url)}" target="_blank" rel="noopener">VONA notice</a>`);
      if (v.report) links.push(`<a href="${esc(v.report)}" target="_blank" rel="noopener">MAGMA report</a>`);
      if (v.official && v.official.url) links.push(`<a href="${esc(v.official.url)}" target="_blank" rel="noopener">${esc(OFFICIAL_NAMES[v.official.source] || "Official notice")}</a>`);
      links.push(`<a href="${esc(wikiUrl(v.wiki, v.name))}" target="_blank" rel="noopener">Wikipedia</a>`);
      if (v.number) links.push(`<a href="https://volcano.si.edu/volcano.cfm?vn=${encodeURIComponent(v.number)}" target="_blank" rel="noopener">GVP</a>`);
      parts.push(`<div class="links">${links.join("")}</div>`);
    }
    parts.push(`</div>`);
    this._body.innerHTML = parts.join("");
    const cv = this._body.querySelector(".scene canvas");
    if (cv) {
      const night = clamp((-sunElevation(v.lat, v.lon, Date.now()) + 2) / 10, 0, 1);
      this._scenes.push({ kind: "scene", cv, v, erupt: eruptStrength(v), plume: this._plumeFor(v), ej: this._ejectaFor(v), night, stars: null });
    }
    if (this._config.navigation_path) this._body.querySelectorAll(".scene, .head").forEach((el) => el.addEventListener("click", () => this._navigate()));
  }

  // ------------------------------------------------------------------ animation

  _startLoop() {
    if (this._raf || !this.isConnected || !this._scenes.length) return;
    const step = (ts) => {
      this._raf = null;
      if (!this.isConnected || !this._scenes.length) return;
      const dt = this._last ? Math.min(0.1, (ts - this._last) / 1000) : 0.016;
      this._last = ts;
      this._t += dt;
      // about 30 frames per second are plenty for a small card, 15 in eco mode;
      // nothing is drawn while the card is hidden (another slide, other view, screen off)
      this._acc = (this._acc || 0) + dt;
      const eco = ecoMode(this._config.performance);
      if (this._acc >= perf(eco).frameMs / 1000 && this._visible !== false && !document.hidden) {
        const span = Math.min(0.1, this._acc);
        this._acc = 0;
        this._eco = eco;
        for (const sc of this._scenes) this._drawScene(sc, span);
      } else if (this._acc > 0.1) this._acc = 0.1;
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _fit(cv) {
    const dpr = Math.min(perf(this._eco).maxDpr, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  _drawScene(sc, dt) {
    const f = this._fit(sc.cv);
    if (!f) return;
    const { ctx, w, h } = f;
    const t = this._t;
    const v = sc.v;
    if (sc.plume) sc.plume.step(dt);
    if (sc.ej) sc.ej.step(dt, t);
    ctx.clearRect(0, 0, w, h);
    if (sc.kind === "icon") {
      const s = 10;
      // with an ash cloud the cone moves a little against the wind, so the cloud has room to drift
      let dir = null;
      if (sc.plume && sc.plume.dirDeg != null) {
        const a = (sc.plume.dirDeg * Math.PI) / 180;
        const dx = Math.sin(a), dy = -Math.cos(a) * 0.35;
        const n = Math.hypot(dx, dy) || 1;
        dir = [dx / n, dy / n];
      }
      const x = sc.plume && dir ? (dir[0] >= 0 ? w * 0.34 : w * 0.66) : w / 2;
      const y = sc.plume ? h - w * 0.2 : h * 0.8;
      const night = 0.6;
      if (v.level >= 4 || (v.level >= 3 && sc.erupt > 0.5)) drawPulse(ctx, x, y, s * 0.8, v.level, t + (v.lat % 1), 0.9);
      drawVolcano(ctx, x, y, s, { level: v.level, erupting: sc.erupt, night, t, alpha: 1 });
      if (sc.ej) sc.ej.draw(ctx, x, y - s * 1.45, s * 0.8, night, 1);
      if (sc.plume) {
        // the same ash cloud as on the globe, scaled to fill the small sky above the cone
        const craterY = y - s * 1.45;
        const H0 = Math.min(130, 20 + sc.plume.km * 15);
        const zf = clamp((craterY - 3) / H0, 0.2, 1.4);
        sc.plume.draw(ctx, x, craterY, s, zf, dir, night, sc.erupt, t, 1.5, 0.9);
      }
      return;
    }
    // sky, from day blue to a deep night with stars
    const night = sc.night;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    const mix = (a, b) => a.map((c, i) => Math.round(c + (b[i] - c) * night));
    const top = mix([86, 128, 170], [6, 8, 20]);
    const mid = mix([190, 160, 130], [40, 22, 30]);
    sky.addColorStop(0, `rgb(${top})`);
    sky.addColorStop(0.75, `rgb(${mid})`);
    sky.addColorStop(1, `rgb(${mix([120, 90, 70], [20, 12, 10])})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    if (night > 0.3) {
      if (!sc.stars) sc.stars = Array.from({ length: 50 }, (_, i) => [((i * 97.3) % 100) / 100, ((i * 57.1) % 60) / 100, (i % 3) * 0.4 + 0.4, i * 1.7]);
      ctx.fillStyle = "#fff";
      for (const [sx, sy, r, ph] of sc.stars) {
        ctx.globalAlpha = (night - 0.3) * (0.5 + 0.5 * Math.sin(t * 1.3 + ph));
        ctx.fillRect(sx * w, sy * h, r, r);
      }
      ctx.globalAlpha = 1;
    }
    // drift direction: east to the right, north and south a little up and down
    let dir = null;
    if (sc.plume && sc.plume.dirDeg != null) {
      const a = (sc.plume.dirDeg * Math.PI) / 180;
      const dx = Math.sin(a), dy = -Math.cos(a) * 0.35;
      const n = Math.hypot(dx, dy) || 1;
      dir = [dx / n, dy / n];
    }
    const s = Math.min(34, h * 0.24);
    const ground = h - 16;
    const x = dir ? (dir[0] >= 0 ? w * 0.3 : w * 0.7) : w * 0.5;
    // distant hills
    ctx.fillStyle = `rgba(${mix([70, 55, 45], [12, 8, 8])},1)`;
    ctx.beginPath();
    ctx.moveTo(0, ground + 2);
    for (let i = 0; i <= 12; i++) {
      const px = (i / 12) * w;
      ctx.lineTo(px, ground - 6 - 8 * Math.abs(Math.sin(i * 1.7 + v.lat)));
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    if (v.level >= 4 || (v.level >= 3 && sc.erupt > 0.5)) drawPulse(ctx, x, ground, s, v.level, t + (v.lat % 1), 0.9);
    drawVolcano(ctx, x, ground, s, { level: v.level, erupting: sc.erupt, night, t, alpha: 1 });
    const craterY = ground - s * 1.45;
    if (sc.ej) sc.ej.draw(ctx, x, craterY, s * 0.5, night, 1);
    // a bit stronger than on the globe, the sky behind it is light in daylight
    if (sc.plume) {
      // fill the sky above the crater: small plumes are scaled up, tall ones fit the scene
      const H0 = Math.min(130, 20 + sc.plume.km * 15);
      const zf = clamp((craterY - 12) / H0, 0.6, 2.6);
      sc.plume.draw(ctx, x, craterY, s, zf, dir, night, sc.erupt, t, 1.5 + 0.5 * (1 - night), 1.6);
    }
    // foreground ground
    ctx.fillStyle = `rgb(${mix([60, 44, 34], [10, 6, 5])})`;
    ctx.fillRect(0, ground + 4, w, h - ground);
  }
}

MagmariumVolcanoCard.prototype._camHtml = MagmariumCard.prototype._camHtml;

const VC_LABELS = {
  volcano: "Volcano",
  volcanoes: "Several volcanoes as a list (instead of one)",
  count: "Volcanoes in the list",
  sort: "List order",
  details: "List with details (eruption, ash cloud, report)",
  text_lines: "Lines of long reports (0 = full text)",
  name: "Name (empty = volcano name)",
  title: "Header (empty = Magmarium)",
  navigation_path: "Open on tap (e.g. /dashboard-volcano/globe)",
  scene: "Animated volcano",
  eruption: "Eruption",
  ash: "Ash cloud",
  sigmets: "Ash SIGMETs",
  quakes: "Earthquakes",
  tsunami: "Tsunami warnings",
  thermal: "Satellite hotspots",
  wind: "Wind at plume height",
  camera: "Live camera",
  notice: "Latest report",
  links: "Links",
};

class MagmariumVolcanoCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    if (first) {
      loadVolcanoData(hass)
        .then((data) => {
          this._list = data.volcanoes || [];
          this._render();
        })
        .catch(() => {});
    }
  }

  _schema() {
    const opts = (this._list || [])
      .slice()
      .sort((a, b) => (a.local || a.name).localeCompare(b.local || b.name))
      .map((v) => ({ value: v.id, label: `${v.local || v.name}${v.country ? ` (${v.country})` : ""} · ${LEVEL_NAMES[v.level] || "Unknown"}` }));
    return [
      {
        name: "volcano",
        selector: { select: { mode: "dropdown", options: [{ value: "auto", label: "Most active volcano right now" }, { value: "list", label: "List of the most active volcanoes" }, ...opts] } },
      },
      { name: "volcanoes", selector: { select: { multiple: true, mode: "dropdown", options: opts } } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "name", selector: { text: {} } },
          { name: "title", selector: { text: {} } },
          { name: "count", selector: { number: { min: 1, max: 15, mode: "box" } } },
          { name: "sort", selector: { select: { mode: "dropdown", options: [{ value: "activity", label: "Most active first" }, { value: "distance", label: "Nearest first" }] } } },
          { name: "details", selector: { boolean: {} } },
          { name: "text_lines", selector: { number: { min: 0, max: 20, mode: "box" } } },
        ],
      },
      { name: "navigation_path", selector: { text: {} } },
      { type: "expandable", name: "", title: "What to show", schema: [{ type: "grid", name: "", schema: VC_SHOW.map((name) => ({ name, selector: { boolean: {} } })) }] },
    ];
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => VC_LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const value = { ...ev.detail.value };
        for (const k of Object.keys(value)) {
          if (value[k] === "" || value[k] == null || (Array.isArray(value[k]) && !value[k].length)) delete value[k];
          else if (VC_SHOW.includes(k) && value[k] === true) delete value[k];
        }
        if (value.count === 5) delete value.count;
        if (value.sort === "activity") delete value.sort;
        if (value.details === false) delete value.details;
        if (value.text_lines === 3) delete value.text_lines;
        this._config = value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: value }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    const data = { volcano: "auto", count: 5, sort: "activity", details: false, text_lines: 3, ...this._config };
    for (const k of VC_SHOW) data[k] = this._config?.[k] !== false;
    this._form.data = data;
  }
}

if (!customElements.get("magmarium-volcano-card-editor")) {
  customElements.define("magmarium-volcano-card-editor", MagmariumVolcanoCardEditor);
}

if (!customElements.get("magmarium-volcano-card")) {
  customElements.define("magmarium-volcano-card", MagmariumVolcanoCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "magmarium-volcano-card",
    name: "Magmarium Volcano",
    description: "Compact card with an animated volcano, or a list of the most active volcanoes, without the globe.",
    preview: true,
    documentationURL: "https://github.com/mb26-dev/ha-magmarium",
  });
}
