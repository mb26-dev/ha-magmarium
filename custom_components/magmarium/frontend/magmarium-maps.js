/*
 * Magmarium hazard maps: regional map cards around home for wildfires (NASA FIRMS)
 * and earthquakes (USGS, with tsunami bulletins).
 *
 * Both share one map engine: Web Mercator tiles loaded by the browser from
 * NASA GIBS (Blue Marble shaded relief, or today's VIIRS true colour image with
 * coastlines), drag and pinch to move, buttons for saved views, named places,
 * an animated marker layer and a popup per item.
 */

import { ecoMode, perf } from "./magmarium-perf.js";

const R_EARTH = 6371;
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const LAYERS = {
  relief: { url: (z, y, x) => `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`, max: 8, dim: 0.28 },
  satellite: {
    url: (z, y, x, date) => `${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`,
    max: 9,
    dim: 0.12,
  },
};
const COAST = (z, y, x) => `${GIBS}/Coastlines_15m/default/GoogleMapsCompatible_Level13/${z}/${y}/${x}.png`;
const FIRMS_MAP = "https://firms.modaps.eosdis.nasa.gov/map/";
const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** links come from scraped pages and feeds: only plain http and https URLs are rendered */
function safeUrl(value) {
  try {
    const u = new URL(String(value ?? "").trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch (_err) {
    return "";
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const hex = (c) => `rgb(${c.join(",")})`;
const kmText = (km) => (km < 10 ? km.toFixed(1) : String(Math.round(km)));

function haversine(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

const compass = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** global Web Mercator pixel of a point at zoom z */
function project(lat, lon, z) {
  const s = 256 * 2 ** z;
  const sin = Math.sin(clamp(lat, -85, 85) * (Math.PI / 180));
  return { x: ((lon + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}

function unproject(x, y, z) {
  const s = 256 * 2 ** z;
  const lon = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon };
}

/** zoom that shows `km` from the centre to the shorter edge */
function zoomFor(lat, km, px) {
  const mpp = (km * 1000) / Math.max(40, px / 2);
  return Math.log2((156543.03392 * Math.cos(lat * (Math.PI / 180))) / mpp);
}

function ago(ms) {
  const min = Math.max(0, (Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

function isoDay(offset) {
  return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
}

/* --------------------------------------------------------------- tile cache */

const TILES = new Map();

function tile(url, onload) {
  let t = TILES.get(url);
  if (t) {
    if (!t.ok && !t.failed && onload) t.waiting.add(onload);
    return t;
  }
  t = { img: new Image(), ok: false, failed: false, waiting: new Set(onload ? [onload] : []) };
  t.img.crossOrigin = "anonymous";
  t.img.decoding = "async";
  t.img.onload = () => {
    t.ok = true;
    t.waiting.forEach((f) => f());
    t.waiting.clear();
  };
  t.img.onerror = () => {
    t.failed = true;
    t.waiting.clear();
  };
  t.img.src = url;
  TILES.set(url, t);
  if (TILES.size > 900) TILES.delete(TILES.keys().next().value);
  return t;
}

/** true when a satellite tile has image data (days with a missing swath are black) */
function hasData(img) {
  try {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 12) dark++;
    return dark < 200;
  } catch (_e) {
    return true;
  }
}

/* --------------------------------------------------------------- colours */

/** wildfire colour by radiative power (MW) */
function fireColor(mw) {
  if (mw >= 100) return [239, 68, 68];
  if (mw >= 30) return [249, 115, 22];
  if (mw >= 8) return [245, 158, 11];
  return [250, 204, 21];
}
const fireLabel = (mw) => (mw >= 100 ? "Intense" : mw >= 30 ? "Strong" : mw >= 8 ? "Moderate" : "Small");

/** earthquake colour by magnitude */
function quakeColor(m) {
  if (m >= 7) return [217, 70, 239];
  if (m >= 6) return [239, 68, 68];
  if (m >= 5) return [249, 115, 22];
  if (m >= 4) return [245, 158, 11];
  return [250, 204, 21];
}
const quakeLabel = (m) => (m >= 7 ? "Major" : m >= 6 ? "Strong" : m >= 5 ? "Moderate" : m >= 4 ? "Light" : "Minor");


const TSUNAMI_COLORS = { 4: [239, 68, 68], 3: [249, 115, 22], 2: [250, 204, 21], 1: [96, 165, 250] };
const TSUNAMI_NAMES = { 4: "Tsunami warning", 3: "Tsunami watch", 2: "Tsunami advisory", 1: "Tsunami information" };

/* --------------------------------------------------------------- styles */

const STYLE = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); color: #f3f1ee;
    background: radial-gradient(120% 90% at 0% 0%, var(--mf-bg1, #2a1408) 0%, #120a07 45%, #050304 100%);
    font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); }
  .top { display: flex; align-items: center; gap: 12px; padding: 12px 14px 8px; }
  .top img { width: 48px; height: 48px; flex: 0 0 48px; filter: drop-shadow(0 0 8px var(--mf-glow, rgba(255,120,30,.45))); }
  .top img.calm { filter: grayscale(.85) brightness(.75); opacity: .75; }
  .top .t { min-width: 0; flex: 1; }
  .top h3 { margin: 0; font-size: 17px; font-weight: 700; color: var(--mf-title, #ffd700); letter-spacing: .2px; }
  .top .s { font-size: 13px; font-weight: 650; margin-top: 2px; }
  .top .h { font-size: 11px; opacity: .65; margin-top: 2px; }
  .big { text-align: right; flex: 0 0 auto; }
  .big b { display: block; font-size: 26px; line-height: 1; font-weight: 750; }
  .big span { font-size: 10px; opacity: .65; text-transform: uppercase; letter-spacing: .6px; white-space: nowrap; }
  .map { position: relative; height: var(--mf-height, 260px); margin: 0 10px; border-radius: 10px; overflow: hidden;
    border: 1px solid rgba(255,215,0,.22); background: #0b1622; touch-action: none; cursor: grab; }
  .map.drag { cursor: grabbing; }
  .map canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .flash { position: absolute; inset: 0; background: radial-gradient(circle at var(--fx, 50%) var(--fy, 50%), rgba(255,255,255,.55), rgba(180,200,255,.15) 40%, transparent 70%);
    opacity: 0; pointer-events: none; z-index: 1; }
  .flash.on { animation: mfFlash .7s ease-out; }
  @keyframes mfFlash { 0% { opacity: 1; } 12% { opacity: .2; } 20% { opacity: .8; } 100% { opacity: 0; } }
  .ctl { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; gap: 5px; z-index: 2; }
  .ctl button, .chips button { font: inherit; color: #eee; background: rgba(10,8,8,.72); border: 1px solid rgba(255,255,255,.18);
    border-radius: 8px; cursor: pointer; backdrop-filter: blur(4px); }
  .ctl button { width: 30px; height: 30px; font-size: 16px; line-height: 1; padding: 0; }
  .chips { position: absolute; left: 8px; top: 8px; display: flex; flex-wrap: wrap; gap: 5px; z-index: 2; max-width: calc(100% - 60px); }
  .chips button { font-size: 11px; padding: 4px 9px; border-radius: 12px; }
  .chips button.on { background: var(--mf-accent, #ff8a1f); color: #160b03; border-color: var(--mf-accent, #ff8a1f); font-weight: 700; }
  .stamp { position: absolute; left: 8px; bottom: 6px; font-size: 9.5px; opacity: .7; z-index: 2; pointer-events: none; text-shadow: 0 1px 3px #000; }
  .legend { position: absolute; right: 8px; bottom: 6px; display: flex; gap: 8px; font-size: 9.5px; z-index: 2; pointer-events: none;
    text-shadow: 0 1px 3px #000; opacity: .85; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; vertical-align: -1px; }
  .pop { position: absolute; z-index: 3; min-width: 170px; max-width: 250px; padding: 7px 10px; border-radius: 10px; font-size: 11.5px; line-height: 1.35;
    background: rgba(12,8,6,.92); border: 1px solid var(--mf-accent, #ff8a1f); box-shadow: 0 6px 18px rgba(0,0,0,.5); pointer-events: auto; }
  .pop b { font-size: 13px; }
  .pop .m { opacity: .7; font-size: 11px; }
  .pop a { color: var(--mf-link, #ffab4a); }
  .pop .x { position: absolute; right: 6px; top: 2px; cursor: pointer; opacity: .6; font-size: 14px; }
  .wrap { padding: 8px 12px 12px; }
  .alert { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding: 6px 10px; border-radius: 10px;
    border: 1px solid var(--ac); background: color-mix(in srgb, var(--ac) 14%, transparent); font-size: 12.5px; }
  .alert img { width: 34px; height: 34px; flex: 0 0 34px; }
  .alert b { color: var(--ac); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
  .tile { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 6px 8px; min-width: 0; }
  .tile[data-lat] { cursor: pointer; }
  .tile.hot { border-color: var(--mf-hot, rgba(255,90,31,.6)); background: var(--mf-hotbg, rgba(255,90,31,.12)); }
  .tile .k { font-size: 10px; opacity: .7; text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .v { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .s { font-size: 10.5px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list { margin-top: 8px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 6px 2px; border-top: 1px solid rgba(255,255,255,.07); cursor: pointer; font-size: 12.5px; }
  .row .dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 10px; }
  .row .mag { flex: 0 0 auto; min-width: 38px; text-align: center; font-weight: 800; font-size: 12px; padding: 1px 6px; border-radius: 8px; color: #120a07; }
  .row .main { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .main b { font-weight: 700; }
  .row .main em { font-style: normal; opacity: .6; }
  .row .pw { font-weight: 700; white-space: nowrap; }
  .row .tm { opacity: .6; font-size: 11px; white-space: nowrap; width: 62px; text-align: right; }
  .none { padding: 8px 2px 2px; font-size: 12.5px; opacity: .75; }
  .foot { margin-top: 8px; font-size: 10px; opacity: .55; display: flex; gap: 8px; flex-wrap: wrap; }
  .foot a { color: inherit; }
  .msg { padding: 16px; font-size: 13px; opacity: .8; }
`;

/* --------------------------------------------------------------- shared map engine */

export function defineMapCards({ VERSION, loadData, refreshMs }) {
  const icon = (name) => new URL(`./${name}?v=${VERSION}`, import.meta.url).href;
  const ICONS = {
    fire: icon("fire-marker.svg"),
    quake: icon("quake-marker.svg"),
    tsunami: icon("tsunami-marker.svg"),
  };
  const IMAGES = {};
  const image = (name) => {
    if (!IMAGES[name]) {
      IMAGES[name] = new Image();
      IMAGES[name].src = ICONS[name];
    }
    return IMAGES[name];
  };

  class MagmariumMapCard extends HTMLElement {
    /* ------------------------------------------------------------ hooks */

    // icon name, card defaults, default views, data from the integration?
    get kind() { return "fire"; }
    get usesPayload() { return true; }
    defaults() { return {}; }
    defaultViews() { return [{ name: "Near", radius_km: 40 }, { name: "Region", radius_km: 150 }, { name: "Wide", radius_km: 900 }]; }
    theme() { return {}; }
    legend() { return ""; }
    prepare() {}
    paintItems() {}
    renderText() {}
    popupHtml() { return ""; }
    disabledText() { return ""; }

    /* ------------------------------------------------------------ setup */

    setConfig(config) {
      this._config = { list: 5, map: "relief", ...this.defaults(), ...config };
      this._views = Array.isArray(this._config.views) && this._config.views.length ? this._config.views : this.defaultViews();
      this._viewIdx = clamp(Number(this._config.view ?? 1) || 0, 0, this._views.length - 1);
      this._view = null;
      this._centered = false;
      if (this._root) this._build();
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (first) {
        this._build();
        this._load();
        return;
      }
      if (this.hassChanged(hass)) {
        this._prepare();
        this._renderBody();
      }
    }

    // true when the card has to recompute from the new states
    hassChanged(hass) {
      const id = this._config.air_quality_entity;
      if (id && hass.states[id] !== this._aqState) {
        this._aqState = hass.states[id];
        return true;
      }
      return false;
    }

    getCardSize() {
      return 7;
    }

    getGridOptions() {
      return { columns: 12, min_columns: 6, rows: "auto" };
    }

    connectedCallback() {
      if (this.usesPayload) this._timer = setInterval(() => this._load(), refreshMs);
      else this._timer = setInterval(() => { this._prepare(); this._renderBody(); }, 30000);
      this._io = new IntersectionObserver((e) => {
        this._visible = e.some((x) => x.isIntersecting);
        if (this._visible) this._loop();
      });
      this._io.observe(this);
      if (this._canvas) this._resize();
    }

    disconnectedCallback() {
      clearInterval(this._timer);
      this._io?.disconnect();
      this._ro?.disconnect();
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    async _load() {
      if (this.usesPayload) {
        try {
          this._data = await loadData(this._hass, true);
          this._error = null;
        } catch (err) {
          this._error = String(err.message || err);
        }
      } else {
        this._data = this._data || {};
      }
      this._prepare();
      if ((this._data || !this.usesPayload) && !this._centered) {
        // the first view waits for the home location
        this._centered = true;
        this._view = null;
        this._resize();
      }
      this._renderBody();
      this._drawBase();
    }

    home() {
      const c = this._config.center;
      if (Array.isArray(c) && c.length === 2) return { lat: Number(c[0]), lon: Number(c[1]) };
      const h = this._data?.home;
      if (h && h[0] != null) return { lat: h[0], lon: h[1] };
      const cfg = this._hass?.config;
      return { lat: cfg?.latitude ?? 0, lon: cfg?.longitude ?? 0 };
    }

    homeName() {
      return this._config.home_name || "Home";
    }

    _prepare() {
      this._places = (this._config.places || [])
        .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
        .map((p) => ({ name: String(p.name || ""), lat: Number(p.lat), lon: Number(p.lon), r: Number(p.radius_km) || 30 }));
      this.prepare();
    }

    /** the nearest configured place within 2.5 x its radius, for "near Krabi" */
    nearPlace(lat, lon) {
      let best = null;
      for (const p of this._places || []) {
        const d = haversine(p.lat, p.lon, lat, lon);
        if (d <= p.r * 2.5 && (!best || d < best.d)) best = { p, d };
      }
      return best;
    }

    /* ------------------------------------------------------------ dom */

    _build() {
      if (!this._config || !this._hass) return;
      if (!this._root) this._root = this.attachShadow({ mode: "open" });
      const h = Number(this._config.height) || 260;
      const th = this.theme();
      const vars = Object.entries({ "--mf-height": `${h}px`, ...th }).map(([k, v]) => `${k}:${v}`).join(";");
      this._root.innerHTML = `<style>${STYLE}</style>
        <ha-card style="${vars}">
          <div class="top"><img class="calm" src="${ICONS[this.kind]}" alt=""><div class="t">
            <h3>${esc(this._config.title || "")}</h3><div class="s"></div><div class="h"></div></div>
            <div class="big"><b>–</b><span></span></div></div>
          <div class="map">
            <canvas class="base"></canvas><canvas class="fx"></canvas><div class="flash"></div>
            <div class="chips"></div>
            <div class="ctl"><button class="zin" title="Zoom in">+</button><button class="zout" title="Zoom out">−</button>
              <button class="lay" title="Relief map / today's satellite image">🛰</button><button class="ctr" title="Back to home">⌂</button></div>
            <div class="stamp"></div>
            <div class="legend">${this.legend()}</div>
          </div>
          <div class="wrap"></div>
        </ha-card>`;
      const $ = (s) => this._root.querySelector(s);
      this._mapEl = $(".map");
      this._canvas = $("canvas.base");
      this._fx = $("canvas.fx");
      this._flashEl = $(".flash");
      image(this.kind).addEventListener("load", () => this._loop(), { once: true });
      $(".zin").addEventListener("click", () => this._zoomBy(1));
      $(".zout").addEventListener("click", () => this._zoomBy(-1));
      $(".ctr").addEventListener("click", () => this._setView(this._viewIdx));
      $(".lay").addEventListener("click", () => {
        this._layer = this._layerName() === "relief" ? "satellite" : "relief";
        this._satDate = null;
        this._drawBase();
      });
      this._bindPointer();
      this._renderChips();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this._mapEl);
      this._resize();
      this._renderBody();
    }

    _renderChips() {
      const el = this._root.querySelector(".chips");
      el.innerHTML = this._views.map((v, i) => `<button data-i="${i}" class="${i === this._viewIdx ? "on" : ""}">${esc(v.name || `View ${i + 1}`)}</button>`).join("");
      el.querySelectorAll("button").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        this._setView(Number(b.dataset.i));
      }));
    }

    _layerName() {
      return this._layer || (this._config.map === "satellite" ? "satellite" : "relief");
    }

    _viewTarget(i) {
      const v = this._views[i] || {};
      const home = this.home();
      const lat = Number.isFinite(Number(v.lat)) ? Number(v.lat) : home.lat;
      const lon = Number.isFinite(Number(v.lon)) ? Number(v.lon) : home.lon;
      return { lat, lon, km: Number(v.radius_km) || 150 };
    }

    _setView(i) {
      this._viewIdx = i;
      const v = this._viewTarget(i);
      this._flyTo(v.lat, v.lon, zoomFor(v.lat, v.km, Math.min(this._w || 400, this._h || 260)));
      this._root.querySelectorAll(".chips button").forEach((b, j) => b.classList.toggle("on", j === i));
      this._closePop();
    }

    flyToKm(lat, lon, km) {
      this._flyTo(lat, lon, zoomFor(lat, km, Math.min(this._w, this._h)));
    }

    _resize() {
      if (!this._mapEl) return;
      const r = this._mapEl.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(perf(ecoMode(this._config?.performance)).maxDpr, window.devicePixelRatio || 1);
      this._w = r.width;
      this._h = r.height;
      this._dpr = dpr;
      for (const c of [this._canvas, this._fx]) {
        c.width = Math.round(r.width * dpr);
        c.height = Math.round(r.height * dpr);
      }
      if (!this._view) {
        const v = this._viewTarget(this._viewIdx);
        this._view = { lat: v.lat, lon: v.lon, zoom: zoomFor(v.lat, v.km, Math.min(r.width, r.height)) };
      }
      this._drawBase();
      this._loop();
    }

    /* ------------------------------------------------------------ view */

    _flyTo(lat, lon, zoom, ms = 650) {
      if (!this._view) return;
      this._fly = { from: { ...this._view }, to: { lat, lon, zoom: clamp(zoom, 2, 13) }, t0: performance.now(), ms };
      this._loop();
    }

    _zoomBy(dz, cx, cy) {
      if (!this._view) return;
      const z = clamp(this._view.zoom + dz, 2, 13);
      if (cx == null) {
        this._flyTo(this._view.lat, this._view.lon, z, 300);
        return;
      }
      // keep the point under the cursor in place
      const before = this.toLatLon(cx, cy);
      this._view.zoom = z;
      const after = this.toLatLon(cx, cy);
      this._view.lat = clamp(this._view.lat + (before.lat - after.lat), -80, 80);
      this._view.lon += before.lon - after.lon;
      this._drawBase();
    }

    toPx(lat, lon) {
      const z = this._view.zoom;
      const c = project(this._view.lat, this._view.lon, z);
      const p = project(lat, lon, z);
      const world = 256 * 2 ** z;
      let dx = p.x - c.x;
      if (dx > world / 2) dx -= world;
      if (dx < -world / 2) dx += world;
      return { x: this._w / 2 + dx, y: this._h / 2 + (p.y - c.y) };
    }

    toLatLon(x, y) {
      const z = this._view.zoom;
      const c = project(this._view.lat, this._view.lon, z);
      return unproject(c.x + (x - this._w / 2), c.y + (y - this._h / 2), z);
    }

    /** pixels per km at the centre of the view */
    pxPerKm() {
      return 1000 / ((156543.03392 * Math.cos(this._view.lat * (Math.PI / 180))) / 2 ** this._view.zoom);
    }

    onScreen(q, pad = 30) {
      return q.x > -pad && q.y > -pad && q.x < this._w + pad && q.y < this._h + pad;
    }

    _bindPointer() {
      const el = this._mapEl;
      const pts = new Map();
      let moved = 0;
      let pinch = null;
      el.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".ctl, .chips, .pop")) return;
        el.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = 0;
        this._fly = null;
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this._view.zoom };
        }
        el.classList.add("drag");
      });
      el.addEventListener("pointermove", (e) => {
        const p = pts.get(e.pointerId);
        if (!p || !this._view) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (pts.size === 2 && pinch) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          this._view.zoom = clamp(pinch.zoom + Math.log2(d / pinch.d), 2, 13);
          moved += 10;
          this._drawBase();
          return;
        }
        moved += Math.abs(dx) + Math.abs(dy);
        const z = this._view.zoom;
        const c = project(this._view.lat, this._view.lon, z);
        const ll = unproject(c.x - dx, c.y - dy, z);
        this._view.lat = clamp(ll.lat, -80, 80);
        this._view.lon = ll.lon;
        this._drawBase();
      });
      const up = (e) => {
        const had = pts.delete(e.pointerId);
        if (pts.size < 2) pinch = null;
        if (!pts.size) el.classList.remove("drag");
        if (had && moved < 6 && e.type === "pointerup") {
          const r = el.getBoundingClientRect();
          this._tap(e.clientX - r.left, e.clientY - r.top);
        }
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        this._zoomBy(-e.deltaY * 0.0022, e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      el.addEventListener("dblclick", (e) => {
        const r = el.getBoundingClientRect();
        const ll = this.toLatLon(e.clientX - r.left, e.clientY - r.top);
        this._flyTo(ll.lat, ll.lon, this._view.zoom + 1.2, 400);
      });
    }

    /* ------------------------------------------------------------ base map */

    _drawBase() {
      if (!this._canvas || !this._view || !this._w) return;
      cancelAnimationFrame(this._baseRaf);
      this._baseRaf = requestAnimationFrame(() => this._paintBase());
    }

    _satelliteDate(again) {
      // today's swath may still be missing: step back a day when the tile under the view is empty
      if (this._satDate) return this._satDate;
      const tries = this._satTries || 0;
      const date = isoDay(tries);
      const z = 6;
      const c = project(this._view.lat, this._view.lon, z);
      const t = tile(LAYERS.satellite.url(z, Math.floor(c.y / 256), Math.floor(c.x / 256), date), again);
      if (!t.ok && !t.failed) return null;
      if (t.ok && hasData(t.img)) {
        this._satDate = date;
        this._satTries = 0;
        return date;
      }
      if (tries >= 3) {
        this._satDate = isoDay(1);
        this._satTries = 0;
        return this._satDate;
      }
      this._satTries = tries + 1;
      return this._satelliteDate(again);
    }

    _paintBase() {
      const g = this._canvas.getContext("2d");
      g.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      g.fillStyle = "#0b1622";
      g.fillRect(0, 0, this._w, this._h);
      const again = () => this._drawBase();
      const name = this._layerName();
      const layer = LAYERS[name];
      const date = name === "satellite" ? this._satelliteDate(again) : null;
      if (name === "satellite" && !date) {
        this._stamp("Loading satellite image…");
        return;
      }
      this._paintLayer(g, (z, y, x) => layer.url(z, y, x, date), layer.max, again);
      // the relief map ends at about 600 m per pixel: sharp coastlines on top when zoomed in close
      if (name === "satellite" || this._view.zoom > 8.6) this._paintLayer(g, COAST, 11, again, name === "satellite" ? 0.8 : 0.55);
      g.fillStyle = `rgba(4,3,3,${layer.dim})`;
      g.fillRect(0, 0, this._w, this._h);
      const when = date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
      this._stamp(name === "satellite" ? `VIIRS NOAA-20 · ${when} · NASA GIBS` : "Blue Marble · NASA GIBS");
    }

    _stamp(text) {
      const el = this._root.querySelector(".stamp");
      if (el && el.textContent !== text) el.textContent = text;
    }

    _paintLayer(g, url, maxLevel, again, alpha = 1) {
      const zoom = this._view.zoom;
      const level = clamp(Math.round(zoom), 1, maxLevel);
      const scale = 2 ** (zoom - level);
      const n = 2 ** level;
      const c = project(this._view.lat, this._view.lon, level);
      const size = 256 * scale;
      const x0 = c.x * scale - this._w / 2;
      const y0 = c.y * scale - this._h / 2;
      const tx0 = Math.floor(x0 / size);
      const ty0 = Math.floor(y0 / size);
      const tx1 = Math.floor((x0 + this._w) / size);
      const ty1 = Math.floor((y0 + this._h) / size);
      g.globalAlpha = alpha;
      g.imageSmoothingQuality = "high";
      for (let ty = ty0; ty <= ty1; ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = tx0; tx <= tx1; tx++) {
          const wx = ((tx % n) + n) % n;
          const dx = tx * size - x0;
          const dy = ty * size - y0;
          const t = tile(url(level, ty, wx), again);
          if (t.ok) {
            g.drawImage(t.img, dx, dy, size + 0.5, size + 0.5);
            continue;
          }
          // parent tile as a placeholder while loading
          for (let up = 1; up <= 3 && level - up >= 0; up++) {
            const f = 2 ** up;
            const p = tile(url(level - up, Math.floor(ty / f), Math.floor(wx / f)));
            if (!p.ok) continue;
            const sx = ((wx % f) * 256) / f;
            const sy = ((ty % f) * 256) / f;
            g.drawImage(p.img, sx, sy, 256 / f, 256 / f, dx, dy, size + 0.5, size + 0.5);
            break;
          }
        }
      }
      g.globalAlpha = 1;
    }

    /* ------------------------------------------------------------ animation */

    _loop() {
      if (this._raf || !this._fx) return;
      let last = 0;
      const step = (ts) => {
        this._raf = 0;
        if (!this.isConnected) return;
        // about 30 frames per second are enough, 15 in eco mode
        if (ts - last >= perf(ecoMode(this._config?.performance)).frameMs - 1 || this._fly) {
          last = ts;
          if (this._fly) {
            const f = this._fly;
            const e = clamp((ts - f.t0) / f.ms, 0, 1);
            const k = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2;
            this._view.lat = f.from.lat + (f.to.lat - f.from.lat) * k;
            this._view.lon = f.from.lon + (f.to.lon - f.from.lon) * k;
            this._view.zoom = f.from.zoom + (f.to.zoom - f.from.zoom) * k;
            this._paintBase();
            if (e >= 1) this._fly = null;
          }
          this._paintFx(ts);
        }
        if (this._visible !== false && !document.hidden) this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }

    flash(lat, lon) {
      if (!this._flashEl || !this._view) return;
      const q = this.toPx(lat, lon);
      this._flashEl.style.setProperty("--fx", `${(q.x / this._w) * 100}%`);
      this._flashEl.style.setProperty("--fy", `${(q.y / this._h) * 100}%`);
      this._flashEl.classList.remove("on");
      void this._flashEl.offsetWidth;
      this._flashEl.classList.add("on");
    }

    _paintFx(ts) {
      if (!this._view || !this._w) return;
      const g = this._fx.getContext("2d");
      g.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      g.clearRect(0, 0, this._w, this._h);
      const t = ts / 1000;
      this._hits = [];
      this._labels = [];

      // places
      for (const p of this._places || []) {
        const q = this.toPx(p.lat, p.lon);
        if (!this.onScreen(q, 40)) continue;
        g.beginPath();
        g.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
        g.fillStyle = "#7dd3c0";
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = "#0a1a22";
        g.stroke();
        this._labels.push({ x: q.x, y: q.y, text: p.name, color: "#9be5d3" });
        this._hits.push({ x: q.x, y: q.y, r: 10, place: p });
      }

      this.paintItems(g, t);

      // home: gold marker with a slow pulse
      const home = this.home();
      const hq = this.toPx(home.lat, home.lon);
      const hp = (t % 2.4) / 2.4;
      g.beginPath();
      g.arc(hq.x, hq.y, 6 + hp * 16, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,215,0,${0.55 * (1 - hp)})`;
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.arc(hq.x, hq.y, 5, 0, Math.PI * 2);
      g.fillStyle = "#ffd700";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = "#1a1203";
      g.stroke();
      this._labels.unshift({ x: hq.x, y: hq.y, text: this.homeName(), color: "#ffd700" });

      // labels skip each other
      g.font = "700 11px system-ui, sans-serif";
      const boxes = [];
      for (const l of this._labels) {
        const w = g.measureText(l.text).width;
        const options = [[l.x + 8, l.y - 7], [l.x - 8 - w, l.y - 7], [l.x - w / 2, l.y + 8], [l.x - w / 2, l.y - 22]];
        const spot = options.find(([bx, by]) => bx >= 2 && bx + w <= this._w - 2 && !boxes.some((b) => bx < b.x + b.w + 3 && bx + w + 3 > b.x && by < b.y + 14 && by + 14 > b.y));
        if (!spot) continue;
        boxes.push({ x: spot[0], y: spot[1], w });
        g.lineWidth = 3;
        g.strokeStyle = "rgba(5,8,12,.85)";
        g.strokeText(l.text, spot[0], spot[1] + 11);
        g.fillStyle = l.color;
        g.fillText(l.text, spot[0], spot[1] + 11);
      }

      // scale bar
      const ppk = this.pxPerKm();
      const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
      const km = nice.find((k) => k * ppk > 50) || 2000;
      const px = km * ppk;
      g.fillStyle = "rgba(255,255,255,.8)";
      g.fillRect(this._w - 12 - px, this._h - 24, px, 2);
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "right";
      g.fillText(`${km} km`, this._w - 12, this._h - 28);
      g.textAlign = "left";
    }

    /** an animated icon standing on its foot (y = 115 of 128, quake and tsunami 96) on a ring in its colour */
    drawIcon(g, name, x, y, size, col, t, seed, alpha = 1) {
      const ring = 1 + 0.08 * Math.sin(t * 4 + seed * 5);
      g.save();
      g.globalAlpha = alpha;
      g.beginPath();
      g.ellipse(x, y, size * 0.42 * ring, size * 0.14 * ring, 0, 0, Math.PI * 2);
      g.lineWidth = 2;
      g.strokeStyle = rgb(col, 0.95);
      g.shadowColor = rgb(col, 0.9);
      g.shadowBlur = 8;
      g.stroke();
      g.shadowBlur = 0;
      const img = image(name);
      if (img.complete && img.naturalWidth) {
        const flick = name === "fire" ? 1 + 0.05 * Math.sin(t * 9 + seed * 13) + 0.03 * Math.sin(t * 17 + seed) : 1;
        const shake = name === "quake" ? Math.sin(t * 40 + seed) * 0.8 : 0;
        const h = size * flick;
        const foot = { quake: 96, tsunami: 96 }[name] || 115;
        g.drawImage(img, x - size / 2 + shake, y - h * (foot / 128), size, h);
      }
      g.restore();
    }

    /** an item marker is drawn only where no other icon stands */
    placeIcons(items, max, size) {
      const placed = [];
      for (const it of items) {
        if (placed.length >= max) break;
        if (placed.some((p) => Math.hypot(p.q.x - it.q.x, p.q.y - it.q.y) < size * 0.8)) continue;
        placed.push(it);
      }
      return placed;
    }

    /* ------------------------------------------------------------ popups */

    _tap(x, y) {
      let best = null;
      for (const h of this._hits || []) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= h.r && (!best || d < best.d || (h.item && !best.h.item))) best = { h, d };
      }
      if (!best) {
        this._closePop();
        return;
      }
      if (best.h.place) {
        const p = best.h.place;
        this.flyToKm(p.lat, p.lon, p.r * 1.3);
        return;
      }
      this.showPop(best.h.item, best.h.x, best.h.y);
    }

    _closePop() {
      this._root?.querySelector(".pop")?.remove();
    }

    showPop(item, x, y) {
      this._closePop();
      const el = document.createElement("div");
      el.className = "pop";
      el.innerHTML = `<span class="x">×</span>${this.popupHtml(item)}`;
      this._mapEl.appendChild(el);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      el.style.left = `${clamp(x - w / 2, 6, this._w - w - 6)}px`;
      const top = y - h - 14 >= 4 ? y - h - 14 : y + 14 + h <= this._h - 4 ? y + 14 : 4;
      el.style.top = `${top}px`;
      el.querySelector(".x").addEventListener("click", () => el.remove());
    }

    /** fly to an item and open its popup */
    focusItem(item, zoom = 9) {
      this._flyTo(item.lat, item.lon, Math.max(this._view.zoom, zoom), 600);
      setTimeout(() => {
        const q = this.toPx(item.lat, item.lon);
        this.showPop(item, q.x, q.y);
      }, 650);
    }

    time(ms) {
      const tz = this._hass?.config?.time_zone;
      try {
        return new Date(ms).toLocaleString(this._hass?.locale?.language || undefined, { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" });
      } catch (_e) {
        return new Date(ms).toLocaleString();
      }
    }

    /* ------------------------------------------------------------ text */

    _renderBody() {
      if (!this._root) return;
      const wrap = this._root.querySelector(".wrap");
      if (!wrap) return;
      const top = {
        sub: this._root.querySelector(".top .s"),
        hint: this._root.querySelector(".top .h"),
        big: this._root.querySelector(".big b"),
        bigLabel: this._root.querySelector(".big span"),
        icon: this._root.querySelector(".top img"),
      };
      if (this.usesPayload && this._error && !this._data) {
        wrap.innerHTML = `<div class="msg">${this._error === "loading" ? "Magmarium is loading its data…" : `Could not load the data (${esc(this._error)}).`}</div>`;
        return;
      }
      if (this.usesPayload && !this._data) return;
      const off = this.disabledText();
      if (off) {
        wrap.innerHTML = `<div class="msg">${off}</div>`;
        top.sub.textContent = "Not configured";
        return;
      }
      wrap.innerHTML = this.renderText(top);
      wrap.querySelectorAll(".tile[data-lat]").forEach((el) => el.addEventListener("click", () => {
        this.flyToKm(Number(el.dataset.lat), Number(el.dataset.lon), Number(el.dataset.r) * 1.3);
      }));
      wrap.querySelectorAll(".row[data-i]").forEach((el) => el.addEventListener("click", () => {
        const item = (this._rows || [])[Number(el.dataset.i)];
        if (item) this.focusItem(item, this.focusZoom ?? 9);
      }));
    }

    tile(k, v, s, opts = {}) {
      const data = opts.place ? ` data-lat="${opts.place.lat}" data-lon="${opts.place.lon}" data-r="${opts.place.r}"` : "";
      return `<div class="tile ${opts.hot ? "hot" : ""}"${data}><div class="k">${esc(k)}</div>
        <div class="v" style="color:${opts.color || "#f3f1ee"}">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    }

    airQualityTile() {
      const id = this._config.air_quality_entity;
      const st = id && this._hass?.states[id];
      if (!st) return "";
      const v = Number(st.state);
      // PM2.5 sensors without a unit are read as µg/m³
      const pm = /pm_?2[._]?5/i.test(`${id} ${st.attributes.friendly_name || ""}`);
      const unit = st.attributes.unit_of_measurement || (pm ? "µg/m³" : "");
      let col = "#7dd3c0";
      let txt = "good";
      if (Number.isFinite(v) && /µg|ug/.test(unit)) {
        if (v > 75) [col, txt] = ["#ef4444", "unhealthy"];
        else if (v > 37.5) [col, txt] = ["#f97316", "unhealthy for some"];
        else if (v > 25) [col, txt] = ["#facc15", "moderate"];
      }
      return this.tile(this._config.air_quality_name || "Air quality", `${esc(st.state)} ${esc(unit)}`, Number.isFinite(v) && unit ? txt : "", { color: col });
    }
  }

  /* ============================================================ wildfires */

  class MagmariumFireCard extends MagmariumMapCard {
    static getStubConfig() {
      return { title: "Wildfire Watch" };
    }

    get kind() { return "fire"; }
    defaults() { return { title: "Wildfire Watch", hours: 48 }; }
    legend() {
      return `<span><i style="background:#facc15"></i>&lt;8</span><span><i style="background:#f59e0b"></i>8–30</span>
        <span><i style="background:#f97316"></i>30–100</span><span><i style="background:#ef4444"></i>100+ MW</span>`;
    }

    disabledText() {
      return this._data && !this._data.fires_enabled ? "Wildfires need a free NASA FIRMS map key and a wildfire radius above 0 in the Magmarium options." : "";
    }

    prepare() {
      const home = this.home();
      const oldest = Date.now() - this._config.hours * 3600000;
      this._items = (this._data?.fires || [])
        .map((f) => ({
          lat: f[0], lon: f[1], count: f[2], mw: f[3], max: f[4], ms: Date.parse(f[5]), first: Date.parse(f[6]), cell: f[9],
          km: haversine(home.lat, home.lon, f[0], f[1]), brg: bearing(home.lat, home.lon, f[0], f[1]),
        }))
        .filter((f) => f.ms >= oldest);
      for (const f of this._items) f.near = this.nearPlace(f.lat, f.lon);
      this._items.sort((a, b) => a.km - b.km);
    }

    paintItems(g, t) {
      const zoom = this._view.zoom;
      const ppk = this.pxPerKm();
      const icons = [];
      for (const f of this._items || []) {
        const q = this.toPx(f.lat, f.lon);
        if (!this.onScreen(q)) continue;
        const age = (Date.now() - f.ms) / 3600000;
        const fade = age <= 12 ? 1 : clamp(1 - (age - 12) / 48, 0.35, 1);
        const col = fireColor(f.mw);
        // a coarse cell far from home is drawn as a wider haze
        const cellPx = f.cell ? f.cell * 111 * ppk : 0;
        const base = clamp(3 + Math.sqrt(f.mw) * 0.9, 3, 16);
        const rad = Math.max(base, Math.min(cellPx * 0.5, 40));
        const pulse = 1 + 0.12 * Math.sin(t * 3 + f.lat * 7);
        const grd = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, rad * 2.2 * pulse);
        grd.addColorStop(0, rgb(col, 0.85 * fade));
        grd.addColorStop(0.35, rgb(col, 0.45 * fade));
        grd.addColorStop(1, rgb(col, 0));
        g.fillStyle = grd;
        g.beginPath();
        g.arc(q.x, q.y, rad * 2.2 * pulse, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(q.x, q.y, clamp(base * 0.35, 1.6, 4), 0, Math.PI * 2);
        g.fillStyle = `rgba(255,245,220,${0.9 * fade})`;
        g.fill();
        this._hits.push({ x: q.x, y: q.y, r: Math.max(12, rad), item: f });
        icons.push({ f, q, fade, score: f.mw / (1 + f.km / 50) });
      }
      // animated flames: strongest first, never overlapping
      const size = clamp(18 + zoom * 1.6, 22, 38);
      icons.sort((a, b) => b.score - a.score);
      for (const it of this.placeIcons(icons, 12, size)) this.drawIcon(g, "fire", it.q.x, it.q.y, size, fireColor(it.f.mw), t, it.f.lat, it.fade);
    }

    popupHtml(f) {
      const near = f.near ? `<br>${Math.round(f.near.d)} km ${compass(bearing(f.near.p.lat, f.near.p.lon, f.lat, f.lon))} of ${esc(f.near.p.name)}` : "";
      const firms = `${FIRMS_MAP}#d:24hrs;@${f.lon.toFixed(3)},${f.lat.toFixed(3)},11.0z`;
      return `<b style="color:${hex(fireColor(f.mw))}">${fireLabel(f.mw)} fire · ${f.mw} MW</b>
        <div>${kmText(f.km)} km ${compass(f.brg)} of ${esc(this.homeName())}${near}</div>
        <div class="m">${f.count} detection${f.count === 1 ? "" : "s"} · peak pixel ${f.max} MW · seen ${ago(f.ms)}${f.first !== f.ms ? `, burning since ${esc(this.time(f.first))}` : ""}</div>
        <div class="m"><a href="${firms}" target="_blank" rel="noopener">NASA FIRMS map ↗</a></div>`;
    }

    renderText(top) {
      const day = Date.now() - 24 * 3600000;
      const recent = (this._items || []).filter((f) => f.ms >= day);
      this._rows = recent;
      const near = recent[0];
      const strong = recent.reduce((m, f) => (!m || f.mw > m.mw ? f : m), null);
      const close = recent.filter((f) => f.km <= 25).length;
      const col = !near ? "#7dd3c0" : near.km <= 10 ? "#ff3b3b" : near.km <= 30 ? "#ff8866" : near.km <= 100 ? "#ffb74d" : "#ffd700";
      top.big.textContent = String(recent.length);
      top.big.style.color = recent.length ? col : "#7dd3c0";
      top.bigLabel.textContent = "fires 24 h";
      top.icon.classList.toggle("calm", !recent.length);
      top.sub.style.color = col;
      top.sub.textContent = near ? `Nearest ${kmText(near.km)} km ${compass(near.brg)}${near.near ? ` · near ${near.near.p.name}` : ""}` : "No fires in the last 24 h";
      const radius = this._data.fires_meta?.radius_km;
      top.hint.textContent = near
        ? `${close ? `${close} within 25 km · ` : ""}strongest ${strong.mw} MW ${Math.round(strong.km)} km ${compass(strong.brg)}`
        : `Satellite watch within ${radius ? `${Math.round(radius)} km` : "your area"} · NASA FIRMS`;

      let html = "";
      const tiles = [];
      for (const p of this._places || []) {
        const inside = recent.filter((f) => haversine(p.lat, p.lon, f.lat, f.lon) <= p.r);
        const mw = inside.reduce((m, f) => Math.max(m, f.mw), 0);
        const nearest = inside.reduce((m, f) => Math.min(m, haversine(p.lat, p.lon, f.lat, f.lon)), Infinity);
        tiles.push(this.tile(p.name, inside.length ? `${inside.length} fire${inside.length === 1 ? "" : "s"}` : "Clear",
          inside.length ? `${Math.round(nearest)} km · ${Math.round(mw)} MW` : `within ${p.r} km`,
          { place: p, hot: inside.length > 0, color: inside.length ? hex(fireColor(mw)) : "#7dd3c0" }));
      }
      const aq = this.airQualityTile();
      if (aq) tiles.push(aq);
      if (tiles.length) html += `<div class="tiles">${tiles.join("")}</div>`;
      const n = Number(this._config.list) || 0;
      if (n > 0) {
        html += recent.length
          ? `<div class="list">${recent.slice(0, n).map((f, i) => {
            const c = hex(fireColor(f.mw));
            return `<div class="row" data-i="${i}"><span class="dot" style="background:${c};box-shadow:0 0 8px ${c}"></span>
              <span class="main"><b>${kmText(f.km)} km ${compass(f.brg)}</b>${f.near ? ` · ${esc(f.near.p.name)}` : ""}</span>
              <span class="pw" style="color:${c}">${f.mw} MW</span><span class="tm">${ago(f.ms)}</span></div>`;
          }).join("")}</div>`
          : `<div class="none">🌿 No wildfire detected in the last 24 hours${radius ? ` within ${Math.round(radius)} km` : ""}.</div>`;
      }
      const sats = (this._data.fires_meta?.satellites || []).map((x) => String(x).replace("VIIRS ", "")).join(", ");
      const upd = this._data.fires_meta?.updated;
      html += `<div class="foot"><span>VIIRS${sats ? ` ${esc(sats)}` : ""} via <a href="${FIRMS_MAP}" target="_blank" rel="noopener">NASA FIRMS</a></span>${upd ? `<span>checked ${esc(ago(Date.parse(upd)))}</span>` : ""}</div>`;
      return html;
    }
  }

  /* ============================================================ earthquakes */

  class MagmariumQuakeCard extends MagmariumMapCard {
    static getStubConfig() {
      return { title: "Earthquake Watch" };
    }

    get kind() { return "quake"; }
    get focusZoom() { return 7; }
    defaults() { return { title: "Earthquake Watch", radius_km: 2000, days: 7, min_magnitude: 0 }; }
    defaultViews() {
      const r = Number(this._config?.radius_km) || 2000;
      return [{ name: "Near", radius_km: 300 }, { name: "Region", radius_km: 900 }, { name: "Wide", radius_km: Math.round(r * 1.05) }];
    }
    theme() {
      return { "--mf-bg1": "#1c1206", "--mf-accent": "#f59e0b", "--mf-glow": "rgba(249,115,22,.5)", "--mf-hot": "rgba(249,115,22,.6)", "--mf-hotbg": "rgba(249,115,22,.12)" };
    }
    legend() {
      return `<span><i style="background:#facc15"></i>&lt;4</span><span><i style="background:#f59e0b"></i>4</span><span><i style="background:#f97316"></i>5</span>
        <span><i style="background:#ef4444"></i>6</span><span><i style="background:#d946ef"></i>7+</span>`;
    }

    prepare() {
      const home = this.home();
      const oldest = Date.now() - (Number(this._config.days) || 7) * 86400000;
      const r = Number(this._config.radius_km) || 2000;
      const minMag = Number(this._config.min_magnitude) || 0;
      this._items = (this._data?.quakes || [])
        .map((q) => ({
          lat: q[0], lon: q[1], mag: q[2], depth: q[3], ms: Date.parse(q[4]), place: q[5], url: q[6], volcano: q[7],
          km: haversine(home.lat, home.lon, q[0], q[1]), brg: bearing(home.lat, home.lon, q[0], q[1]),
        }))
        .filter((q) => q.ms >= oldest && q.km <= r && q.mag >= minMag)
        .sort((a, b) => b.ms - a.ms);
      this._tsunami = (this._data?.tsunami || [])
        .map((e) => ({ ...e, km: haversine(home.lat, home.lon, e.lat, e.lon) }))
        .filter((e) => e.level >= 1 && e.km <= Math.max(r, 3000))
        .sort((a, b) => b.level - a.level);
    }

    paintItems(g, t) {
      const zoom = this._view.zoom;
      const ppk = this.pxPerKm();
      const icons = [];
      // tsunami bulletins: rings rolling out from the epicentre
      for (const e of this._tsunami || []) {
        const q = this.toPx(e.lat, e.lon);
        const col = TSUNAMI_COLORS[e.level] || TSUNAMI_COLORS[1];
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.25 + i / 3) % 1;
          g.beginPath();
          g.arc(q.x, q.y, (40 + k * 600) * ppk, 0, Math.PI * 2);
          g.strokeStyle = rgb(col, (1 - k) * 0.8);
          g.lineWidth = 2;
          g.stroke();
        }
        this.drawIcon(g, "tsunami", q.x, q.y, clamp(28 + zoom * 2, 30, 48), col, t, e.lat);
      }
      // oldest first, so fresh quakes lie on top
      const list = [...(this._items || [])].reverse();
      for (const s of list) {
        const q = this.toPx(s.lat, s.lon);
        if (!this.onScreen(q, 60)) continue;
        const ageH = (Date.now() - s.ms) / 3600000;
        const fade = ageH <= 24 ? 1 : clamp(1 - (ageH - 24) / 168, 0.4, 1);
        const col = quakeColor(s.mag);
        const rad = clamp(2.2 * 1.55 ** (s.mag - 2), 3, 30);
        // fresh quakes: seismic rings
        if (ageH <= 24) {
          for (let i = 0; i < 2; i++) {
            const k = (((t * 0.6 + i / 2 + s.lon) % 1) + 1) % 1;
            g.beginPath();
            g.ellipse(q.x, q.y, rad * (1 + k * 2.4), rad * (1 + k * 2.4), 0, 0, Math.PI * 2);
            g.strokeStyle = rgb(col, (1 - k) * 0.85);
            g.lineWidth = 1.6;
            g.stroke();
          }
        }
        const grd = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, rad * 1.6);
        grd.addColorStop(0, rgb(col, 0.75 * fade));
        grd.addColorStop(0.6, rgb(col, 0.3 * fade));
        grd.addColorStop(1, rgb(col, 0));
        g.fillStyle = grd;
        g.beginPath();
        g.arc(q.x, q.y, rad * 1.6, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(q.x, q.y, clamp(rad * 0.38, 2, 7), 0, Math.PI * 2);
        g.fillStyle = rgb(col, fade);
        g.fill();
        g.lineWidth = 1.2;
        g.strokeStyle = `rgba(10,6,3,${0.9 * fade})`;
        g.stroke();
        if (s.mag >= 4.5 && zoom > 4) {
          g.font = "700 10px system-ui, sans-serif";
          g.lineWidth = 3;
          g.strokeStyle = "rgba(5,8,12,.85)";
          g.strokeText(s.mag.toFixed(1), q.x + rad * 0.5 + 3, q.y - rad * 0.5);
          g.fillStyle = rgb(col, fade);
          g.fillText(s.mag.toFixed(1), q.x + rad * 0.5 + 3, q.y - rad * 0.5);
        }
        this._hits.push({ x: q.x, y: q.y, r: Math.max(12, rad * 1.2), item: s });
        icons.push({ s, q, fade, score: s.mag * 2 - ageH / 24 - s.km / 500 });
      }
      // the shaking marker for the strongest and freshest quakes
      const size = clamp(22 + zoom * 2, 26, 42);
      icons.sort((a, b) => b.score - a.score);
      for (const it of this.placeIcons(icons.filter((x) => x.s.mag >= 4), 6, size)) {
        this.drawIcon(g, "quake", it.q.x, it.q.y, size, quakeColor(it.s.mag), t, it.s.lat, it.fade);
      }
    }

    popupHtml(s) {
      const near = this.nearPlace(s.lat, s.lon);
      return `<b style="color:${hex(quakeColor(s.mag))}">M${s.mag.toFixed(1)} · ${quakeLabel(s.mag)}</b>
        <div>${esc(s.place || "")}</div>
        <div>${kmText(s.km)} km ${compass(s.brg)} of ${esc(this.homeName())}${near ? ` · ${Math.round(near.d)} km from ${esc(near.p.name)}` : ""}</div>
        <div class="m">depth ${s.depth != null ? `${Math.round(s.depth)} km` : "unknown"}${s.volcano ? ` · near the volcano ${esc(s.volcano)}` : ""}</div>
        <div class="m">${esc(this.time(s.ms))} (${ago(s.ms)})</div>
        ${s.url ? `<div class="m"><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">USGS event page ↗</a></div>` : ""}`;
    }

    renderText(top) {
      const items = this._items || [];
      this._rows = items;
      const day = items.filter((s) => Date.now() - s.ms <= 86400000);
      const strong = items.reduce((m, s) => (!m || s.mag > m.mag ? s : m), null);
      const near = items.reduce((m, s) => (!m || s.km < m.km ? s : m), null);
      const r = Number(this._config.radius_km) || 2000;
      const days = Number(this._config.days) || 7;
      const hot = day.find((s) => (s.mag >= 6 && s.km <= 1000) || (s.mag >= 4.5 && s.km <= 300));
      const col = hot ? hex(quakeColor(hot.mag)) : strong ? hex(quakeColor(strong.mag)) : "#7dd3c0";
      top.big.textContent = String(items.length);
      top.big.style.color = items.length ? col : "#7dd3c0";
      top.bigLabel.textContent = `quakes ${days} d`;
      top.icon.classList.toggle("calm", !day.length);
      top.sub.style.color = col;
      top.sub.textContent = strong
        ? `Strongest M${strong.mag.toFixed(1)} · ${Math.round(strong.km)} km ${compass(strong.brg)} · ${ago(strong.ms)}`
        : `No earthquakes within ${r} km`;
      top.hint.textContent = day.length
        ? `${day.length} in the last 24 h · nearest ${Math.round(Math.min(...day.map((s) => s.km)))} km`
        : `None in the last 24 h · USGS, within ${r} km`;

      let html = "";
      for (const e of (this._tsunami || []).slice(0, 2)) {
        const c = hex(TSUNAMI_COLORS[e.level] || TSUNAMI_COLORS[1]);
        html += `<div class="alert" style="--ac:${c}"><img src="${ICONS.tsunami}" alt=""><div><b>${TSUNAMI_NAMES[e.level] || "Tsunami"}</b> · ${esc(e.region || "")}${e.mag ? ` · M${e.mag}` : ""}<br>
          <span style="opacity:.7">${Math.round(e.km)} km ${compass(bearing(this.home().lat, this.home().lon, e.lat, e.lon))} · ${esc((e.sources || []).join(", "))}${e.url ? ` · <a style="color:${c}" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">bulletin</a>` : ""}</span></div></div>`;
      }
      const tiles = [];
      tiles.push(this.tile("Last 24 h", String(day.length), day.length ? `strongest M${Math.max(...day.map((s) => s.mag)).toFixed(1)}` : "quiet", { color: day.length ? col : "#7dd3c0", hot: !!hot }));
      tiles.push(this.tile("Strongest", strong ? `M${strong.mag.toFixed(1)}` : "–", strong ? `${Math.round(strong.km)} km ${compass(strong.brg)}` : `${days} days`, { color: strong ? hex(quakeColor(strong.mag)) : "#7dd3c0" }));
      tiles.push(this.tile("Nearest", near ? `${Math.round(near.km)} km` : "–", near ? `M${near.mag.toFixed(1)} · ${ago(near.ms)}` : `${days} days`, { color: near ? hex(quakeColor(near.mag)) : "#7dd3c0" }));
      const ts = (this._tsunami || [])[0];
      tiles.push(this.tile("Tsunami", ts ? (TSUNAMI_NAMES[ts.level] || "Alert").replace("Tsunami ", "") : "No alerts", ts ? `${Math.round(ts.km)} km away` : "NOAA · BMKG",
        { color: ts ? hex(TSUNAMI_COLORS[ts.level]) : "#7dd3c0", hot: !!ts && ts.level >= 2 }));
      for (const p of this._places || []) {
        const inside = items.filter((s) => haversine(p.lat, p.lon, s.lat, s.lon) <= p.r);
        const m = inside.reduce((a, s) => Math.max(a, s.mag), 0);
        tiles.push(this.tile(p.name, inside.length ? `${inside.length} quake${inside.length === 1 ? "" : "s"}` : "Calm", inside.length ? `strongest M${m.toFixed(1)}` : `within ${p.r} km`,
          { place: p, hot: inside.length > 0, color: inside.length ? hex(quakeColor(m)) : "#7dd3c0" }));
      }
      html += `<div class="tiles">${tiles.join("")}</div>`;
      const n = Number(this._config.list) || 0;
      if (n > 0) {
        html += items.length
          ? `<div class="list">${items.slice(0, n).map((s, i) => {
            const c = hex(quakeColor(s.mag));
            return `<div class="row" data-i="${i}"><span class="mag" style="background:${c}">${s.mag.toFixed(1)}</span>
              <span class="main"><b>${Math.round(s.km)} km ${compass(s.brg)}</b> <em>· ${esc(String(s.place || "").replace(/^\d+ km [A-Z]+ of /, ""))}${s.depth != null ? ` · ${Math.round(s.depth)} km deep` : ""}</em></span>
              <span class="tm">${ago(s.ms)}</span></div>`;
          }).join("")}</div>`
          : `<div class="none">🌏 No earthquakes within ${r} km in the last ${days} days.</div>`;
      }
      html += `<div class="foot"><span>Earthquakes: <a href="https://earthquake.usgs.gov/earthquakes/map/" target="_blank" rel="noopener">USGS</a> (M4.5+ for 7 days, M2.5+ for 24 h)</span><span>Tsunami: NOAA, BMKG</span></div>`;
      return html;
    }
  }

  const cards = [
    ["magmarium-fire-card", MagmariumFireCard, "Magmarium wildfires", "Wildfires around your home on a zoomable map with places, the nearest fires and their power (NASA FIRMS)."],
    ["magmarium-quake-card", MagmariumQuakeCard, "Magmarium earthquakes", "Earthquakes around your home with magnitude, depth and tsunami bulletins on a zoomable map (USGS, NOAA, BMKG)."],
  ];
  for (const [tag, cls, name, description] of cards) {
    if (customElements.get(tag)) continue;
    customElements.define(tag, cls);
    window.customCards = window.customCards || [];
    window.customCards.push({ type: tag, name, description, preview: false, documentationURL: "https://github.com/mb26-dev/ha-magmarium" });
  }
}
