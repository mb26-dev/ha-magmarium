/*
 * Magmarium card - active volcanoes on a living globe.
 * https://github.com/mb26-dev/ha-magmarium
 */

import { DEG, ecef, viewFrame, sunDirection, loadEarth, renderEarth } from "./magmarium-earth.js";
import { LEVEL_COLORS, rgba, drawVolcano, drawPulse, AshPlume, Ejecta } from "./magmarium-art.js";

const VERSION = "0.1.0b5";
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
const REPLAY_HOURS_PER_SECOND = 12;
const OFFICIAL_NAMES = { usgs: "USGS", imo: "Icelandic Met Office", jma: "Japan Meteorological Agency" };

const ICONS = {
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  minus: "M19 13H5v-2h14v2z",
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14A8.2 8.2 0 0 1 4 12c0-.69.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.08 16zm2.95-8H5.08a7.99 7.99 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
  rotate: "M12 6v3l4-4-4-4v3a8 8 0 0 0-6.76 12.26l1.46-1.46A6 6 0 0 1 12 6zm6.76 1.74-1.46 1.46A6 6 0 0 1 12 18v-3l-4 4 4 4v-3a8 8 0 0 0 6.76-12.26z",
  full: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  unfull: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
  history: "M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  play: "M8 5v14l11-7z",
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

function wikiUrl(title, name) {
  if (title) return `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%2F/g, "/")}`;
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
      show_all: true,
      weekly_ash: true,
      wind_tracks: true,
      ash_areas: true,
      quakes: true,
      replay: true,
      labels: true,
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
          <canvas class="fx"></canvas>
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
            <button class="rot" title="Rotate">${svg(ICONS.rotate)}</button>
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
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      .map((a) => ({ ...a, pts: a.poly.map(([la, lo]) => ecef(la, lo)), c: ecef(a.poly.reduce((t, q) => t + q[0], 0) / a.poly.length, a.poly.reduce((t, q) => t + q[1], 0) / a.poly.length) }));
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
      const FEED_NAMES = { wind: "Wind data", usgs: "USGS", imo: "IMO", jma: "JMA", sigmet: "SIGMETs", quakes: "Earthquakes", wiki: "Wikipedia" };
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
    const hit = this._hitTest(x, y);
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
    // volcanoes with a report win over quiet catalogue volcanoes nearby
    let best = null;
    for (const kind of ["volcano", "quake", "catalog"]) {
      for (const h of this._hits || []) {
        if (h.kind !== kind) continue;
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= h.r && (!best || d < best.d)) best = { ...h, d };
      }
      if (best) return best;
    }
    // official ash areas are large: a tap anywhere inside opens them
    for (const h of this._hits || []) {
      if (h.kind === "sigmet" && pointInPoly(x, y, h.pts)) return h;
    }
    return null;
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
    const meta = [];
    if (v.elev != null) meta.push(`${fmtInt(v.elev)} m`);
    if (dist != null) meta.push(`${fmtInt(Math.round(dist))} km from home`);
    if (meta.length) parts.push(`<div class="line"><span class="ic">⛰</span><span class="tx">${meta.join(" · ")}</span></div>`);

    const n = v.notice;
    if (n) {
      const head = n.kind === "vona"
        ? `VONA ${esc(n.color || "")} · ${esc(utc(n.time))} (${esc(rel(n.time))})`
        : `Weekly report ${esc(n.period || "")}`;
      parts.push(`<div class="notice"><div class="muted">${head}</div>${esc(n.text || "")}</div>`);
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

  _renderSigmetInfo(a) {
    const lines = [];
    const vol = a.volcano ? `Ash from ${esc(a.volcano)}` : "Volcanic ash";
    const bits = [];
    if (a.base_m != null && a.top_m != null) bits.push(`${fmtInt(a.base_m)} to ${fmtInt(a.top_m)} m`);
    if (a.toward_deg != null) bits.push(`moving ${compass(a.toward_deg)}${a.speed_kmh ? ` at ${a.speed_kmh} km/h` : ""}`);
    lines.push(`<div class="line"><span class="ic">✈</span><span class="tx">${vol}${bits.length ? ` · ${bits.join(" · ")}` : ""}<div class="muted">${a.from ? `from ${esc(utc(a.from))} ` : ""}${a.to ? `until ${esc(utc(a.to))}` : ""}</div></span></div>`);
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
    // about 30 frames per second are plenty and keep wall panels cool
    if (ts - (this._lastDraw || 0) < 31) return;
    this._lastDraw = ts;
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
      this._renderEarth(interacting ? 0.5 : 1);
      this._earthDirty = false;
      this._earthLow = interacting;
      if (interacting) this._hqAt = Math.max(this._hqAt, ts + 180);
    } else if (this._earthLow && ts >= this._hqAt && !interacting) {
      this._renderEarth(1);
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
  }

  _renderEarth(quality) {
    if (!this._w) return;
    let scale = this._dpr * quality;
    const px = this._w * this._h * scale * scale;
    if (px > MAX_EARTH_PIXELS) scale *= Math.sqrt(MAX_EARTH_PIXELS / px);
    const W = Math.max(1, Math.round(this._w * scale));
    const H = Math.max(1, Math.round(this._h * scale));
    const R = this._R() * (W / this._w);
    renderEarth(this._cEarth, this._earth, this._frame(), this._sun || sunDirection(Date.now()), W, H, R);
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
    if (!rp && this._config.quakes !== false && this._filter === "all") {
      const nowMs = Date.now();
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

    for (const { v, pr } of items) {
      const s = sizeFor(v);
      const alpha = smooth(0.02, 0.18, pr.z);
      const night = smooth(0.08, -0.14, dot(v.p, sun));
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
      const night = smooth(0.08, -0.14, dot(v.p, sun));
      const craterY = pr.y - s * 1.45;
      const ej = ejectaMap.get(v.id);
      if (ej) ej.draw(ctx, pr.x, craterY, s, night, alpha);
      const plume = plumesMap.get(v.id);
      if (plume) {
        const dir = plume.dirDeg != null ? this._screenDir(v, G, plume.dirDeg) : null;
        const pzf = clamp(Math.pow(zoom, 0.5), 0.9, 3.0);
        plume.draw(ctx, pr.x, craterY, s, pzf, dir, night, v.erupt, t, alpha, clamp(zoom / 2.5, 0.4, 2.4));
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
    type: "grid",
    name: "",
    schema: [
      { name: "regions", selector: { boolean: {} } },
      { name: "labels", selector: { boolean: {} } },
      { name: "show_all", selector: { boolean: {} } },
      { name: "rotate", selector: { boolean: {} } },
      { name: "weekly_ash", selector: { boolean: {} } },
      { name: "wind_tracks", selector: { boolean: {} } },
      { name: "ash_areas", selector: { boolean: {} } },
      { name: "quakes", selector: { boolean: {} } },
      { name: "replay", selector: { boolean: {} } },
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
  weekly_ash: "Ash from the weekly report",
  wind_tracks: "Ash drift tracks (wind)",
  ash_areas: "Official ash areas (SIGMET)",
  quakes: "Earthquakes",
  replay: "Replay button (90 days)",
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
      weekly_ash: true,
      wind_tracks: true,
      ash_areas: true,
      quakes: true,
      replay: true,
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
