/*
 * Magmarium wildfire card: a regional map with the wildfire clusters of the
 * last two days (NASA FIRMS, VIIRS), named places and a list of the nearest fires.
 *
 * Map imagery is loaded by the browser from NASA GIBS (Web Mercator tiles):
 * Blue Marble shaded relief, or today's VIIRS true colour image (smoke plumes
 * and clouds) with the coastlines on top.
 */

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
const DEFAULT_VIEWS = [
  { name: "Near", radius_km: 40 },
  { name: "Region", radius_km: 150 },
  { name: "Wide", radius_km: 900 },
];
const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const MAX_ICONS = 12;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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

/** intensity colour of a fire cluster by its radiative power */
function fireColor(mw) {
  if (mw >= 100) return [239, 68, 68];
  if (mw >= 30) return [249, 115, 22];
  if (mw >= 8) return [245, 158, 11];
  return [250, 204, 21];
}

function fireLabel(mw) {
  if (mw >= 100) return "intense";
  if (mw >= 30) return "strong";
  if (mw >= 8) return "moderate";
  return "small";
}

function ago(iso) {
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
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
  if (TILES.size > 900) {
    const first = TILES.keys().next().value;
    TILES.delete(first);
  }
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

/* --------------------------------------------------------------- styles */

const STYLE = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); color: #f3f1ee;
    background: radial-gradient(120% 90% at 0% 0%, #2a1408 0%, #120a07 45%, #050304 100%);
    font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); }
  .top { display: flex; align-items: center; gap: 12px; padding: 12px 14px 8px; }
  .top img { width: 46px; height: 46px; flex: 0 0 46px; filter: drop-shadow(0 0 8px rgba(255,120,30,.45)); }
  .top img.calm { filter: grayscale(.85) brightness(.75); opacity: .75; }
  .top .t { min-width: 0; flex: 1; }
  .top h3 { margin: 0; font-size: 17px; font-weight: 700; color: var(--mf-title, #ffd700); letter-spacing: .2px; }
  .top .s { font-size: 13px; font-weight: 650; margin-top: 2px; }
  .top .h { font-size: 11px; opacity: .65; margin-top: 2px; }
  .big { text-align: right; flex: 0 0 auto; }
  .big b { display: block; font-size: 26px; line-height: 1; font-weight: 750; }
  .big span { font-size: 10px; opacity: .65; text-transform: uppercase; letter-spacing: .6px; }
  .map { position: relative; height: var(--mf-height, 260px); margin: 0 10px; border-radius: 10px; overflow: hidden;
    border: 1px solid rgba(255,215,0,.22); background: #0b1622; touch-action: none; cursor: grab; }
  .map.drag { cursor: grabbing; }
  .map canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .ctl { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; gap: 5px; z-index: 2; }
  .ctl button, .chips button { font: inherit; color: #eee; background: rgba(10,8,8,.72); border: 1px solid rgba(255,255,255,.18);
    border-radius: 8px; cursor: pointer; backdrop-filter: blur(4px); }
  .ctl button { width: 30px; height: 30px; font-size: 16px; line-height: 1; padding: 0; }
  .chips { position: absolute; left: 8px; top: 8px; display: flex; flex-wrap: wrap; gap: 5px; z-index: 2; max-width: calc(100% - 60px); }
  .chips button { font-size: 11px; padding: 4px 9px; border-radius: 12px; }
  .chips button.on { background: #ff8a1f; color: #160b03; border-color: #ff8a1f; font-weight: 700; }
  .stamp { position: absolute; left: 8px; bottom: 6px; font-size: 9.5px; opacity: .7; z-index: 2; pointer-events: none; text-shadow: 0 1px 3px #000; }
  .legend { position: absolute; right: 8px; bottom: 6px; display: flex; gap: 8px; font-size: 9.5px; z-index: 2; pointer-events: none;
    text-shadow: 0 1px 3px #000; opacity: .85; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; vertical-align: -1px; }
  .pop { position: absolute; z-index: 3; min-width: 170px; max-width: 250px; padding: 7px 10px; border-radius: 10px; font-size: 11.5px; line-height: 1.35;
    background: rgba(12,8,6,.92); border: 1px solid rgba(255,138,31,.55); box-shadow: 0 6px 18px rgba(0,0,0,.5); pointer-events: auto; }
  .pop b { font-size: 13px; }
  .pop .m { opacity: .7; font-size: 11px; }
  .pop a { color: #ffab4a; }
  .pop .x { position: absolute; right: 6px; top: 2px; cursor: pointer; opacity: .6; font-size: 14px; }
  .wrap { padding: 8px 12px 12px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
  .tile { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 6px 8px; min-width: 0; cursor: pointer; }
  .tile.hot { border-color: rgba(255,90,31,.6); background: rgba(255,90,31,.12); }
  .tile .k { font-size: 10px; opacity: .7; text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .v { font-size: 15px; font-weight: 700; white-space: nowrap; }
  .tile .s { font-size: 10.5px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list { margin-top: 8px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 6px 2px; border-top: 1px solid rgba(255,255,255,.07); cursor: pointer; font-size: 12.5px; }
  .row .dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 10px; }
  .row .main { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .main b { font-weight: 700; }
  .row .pw { font-weight: 700; white-space: nowrap; }
  .row .tm { opacity: .6; font-size: 11px; white-space: nowrap; width: 62px; text-align: right; }
  .none { padding: 8px 2px 2px; font-size: 12.5px; opacity: .75; }
  .foot { margin-top: 8px; font-size: 10px; opacity: .55; display: flex; gap: 8px; flex-wrap: wrap; }
  .foot a { color: inherit; }
  .msg { padding: 16px; font-size: 13px; opacity: .8; }
`;

/* --------------------------------------------------------------- card */

export function defineFireCard({ VERSION, loadData, refreshMs }) {
  const ICON = new URL(`./fire-marker.svg?v=${VERSION}`, import.meta.url).href;

  class MagmariumFireCard extends HTMLElement {
    static getStubConfig() {
      return { title: "Wildfire Watch", views: DEFAULT_VIEWS };
    }

    setConfig(config) {
      this._config = { hours: 48, list: 5, map: "relief", ...config };
      this._views = Array.isArray(this._config.views) && this._config.views.length ? this._config.views : DEFAULT_VIEWS;
      this._view = null;
      this._viewIdx = clamp(Number(this._config.view ?? 1) || 0, 0, this._views.length - 1);
      if (this._root) this._build();
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (first) {
        this._build();
        this._load();
      } else if (this._config.air_quality_entity) {
        const st = hass.states[this._config.air_quality_entity];
        if (st && st !== this._aqState) {
          this._aqState = st;
          this._renderBody();
        }
      }
    }

    getCardSize() {
      return 7;
    }

    getGridOptions() {
      return { columns: 12, min_columns: 6, rows: "auto" };
    }

    connectedCallback() {
      this._timer = setInterval(() => this._load(), refreshMs);
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

    /* ------------------------------------------------------------ data */

    async _load() {
      try {
        const data = await loadData(this._hass, true);
        this._data = data;
        this._error = null;
      } catch (err) {
        this._error = String(err.message || err);
      }
      this._prepare();
      if (this._data && !this._centered) {
        // the first view waits for the home location of the integration
        this._centered = true;
        this._view = null;
        this._resize();
      }
      this._renderBody();
      this._drawBase();
    }

    _home() {
      const c = this._config.center;
      if (Array.isArray(c) && c.length === 2) return { lat: Number(c[0]), lon: Number(c[1]) };
      const h = this._data?.home;
      if (h && h[0] != null) return { lat: h[0], lon: h[1] };
      const cfg = this._hass?.config;
      return { lat: cfg?.latitude ?? 0, lon: cfg?.longitude ?? 0 };
    }

    _prepare() {
      const home = this._home();
      const oldest = Date.now() - this._config.hours * 3600000;
      this._places = (this._config.places || [])
        .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
        .map((p) => ({ name: String(p.name || ""), lat: Number(p.lat), lon: Number(p.lon), r: Number(p.radius_km) || 30 }));
      this._fires = (this._data?.fires || [])
        .map((f) => ({
          lat: f[0], lon: f[1], count: f[2], mw: f[3], max: f[4], time: f[5], first: f[6], cell: f[9],
          km: haversine(home.lat, home.lon, f[0], f[1]), brg: bearing(home.lat, home.lon, f[0], f[1]),
        }))
        .filter((f) => Date.parse(f.time) >= oldest);
      for (const f of this._fires) {
        let best = null;
        for (const p of this._places) {
          const d = haversine(p.lat, p.lon, f.lat, f.lon);
          if (d <= p.r * 2.5 && (!best || d < best.d)) best = { p, d };
        }
        f.near = best;
      }
      this._fires.sort((a, b) => a.km - b.km);
      // fires that get the animated icon: strongest first, then the closest
      const ranked = [...this._fires].sort((a, b) => b.mw / (1 + b.km / 50) - a.mw / (1 + a.km / 50));
      this._iconSet = new Set(ranked.slice(0, MAX_ICONS * 3));
    }

    /* ------------------------------------------------------------ dom */

    _build() {
      if (!this._config || !this._hass) return;
      if (!this._root) this._root = this.attachShadow({ mode: "open" });
      const h = Number(this._config.height) || 260;
      this._root.innerHTML = `<style>${STYLE}</style>
        <ha-card style="--mf-height:${h}px">
          <div class="top"><img class="calm" src="${ICON}" alt=""><div class="t">
            <h3>${esc(this._config.title || "Wildfire Watch")}</h3><div class="s"></div><div class="h"></div></div>
            <div class="big"><b>–</b><span>fires 24 h</span></div></div>
          <div class="map">
            <canvas class="base"></canvas><canvas class="fx"></canvas>
            <div class="chips"></div>
            <div class="ctl"><button class="zin" title="Zoom in">+</button><button class="zout" title="Zoom out">−</button>
              <button class="lay" title="Relief map / today's satellite image">🛰</button><button class="ctr" title="Back to home">⌂</button></div>
            <div class="stamp"></div>
            <div class="legend"><span><i style="background:#facc15"></i>&lt;8</span><span><i style="background:#f59e0b"></i>8–30</span>
              <span><i style="background:#f97316"></i>30–100</span><span><i style="background:#ef4444"></i>100+ MW</span></div>
          </div>
          <div class="wrap"></div>
        </ha-card>`;
      const $ = (s) => this._root.querySelector(s);
      this._mapEl = $(".map");
      this._canvas = $("canvas.base");
      this._fx = $("canvas.fx");
      this._img = new Image();
      this._img.src = ICON;
      this._img.onload = () => this._loop();
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

    _setView(i) {
      this._viewIdx = i;
      const v = this._views[i] || {};
      const home = this._home();
      const lat = Number.isFinite(Number(v.lat)) ? Number(v.lat) : home.lat;
      const lon = Number.isFinite(Number(v.lon)) ? Number(v.lon) : home.lon;
      const px = Math.min(this._w || 400, this._h || 260);
      this._flyTo(lat, lon, zoomFor(lat, Number(v.radius_km) || 150, px));
      this._root.querySelectorAll(".chips button").forEach((b, j) => b.classList.toggle("on", j === i));
      this._closePop();
    }

    _resize() {
      if (!this._mapEl) return;
      const r = this._mapEl.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this._w = r.width;
      this._h = r.height;
      this._dpr = dpr;
      for (const c of [this._canvas, this._fx]) {
        c.width = Math.round(r.width * dpr);
        c.height = Math.round(r.height * dpr);
      }
      if (!this._view) {
        const v = this._views[this._viewIdx] || {};
        const home = this._home();
        const lat = Number.isFinite(Number(v.lat)) ? Number(v.lat) : home.lat;
        const lon = Number.isFinite(Number(v.lon)) ? Number(v.lon) : home.lon;
        this._view = { lat, lon, zoom: zoomFor(lat, Number(v.radius_km) || 150, Math.min(r.width, r.height)) };
      }
      this._drawBase();
      this._loop();
    }

    /* ------------------------------------------------------------ view */

    _flyTo(lat, lon, zoom, ms = 650) {
      if (!this._view) return;
      const from = { ...this._view };
      const to = { lat, lon, zoom: clamp(zoom, 2, 13) };
      const t0 = performance.now();
      this._fly = { from, to, t0, ms };
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
      const before = this._toLatLon(cx, cy);
      this._view.zoom = z;
      const after = this._toLatLon(cx, cy);
      this._view.lat = clamp(this._view.lat + (before.lat - after.lat), -80, 80);
      this._view.lon += before.lon - after.lon;
      this._drawBase();
    }

    _toPx(lat, lon) {
      const z = this._view.zoom;
      const c = project(this._view.lat, this._view.lon, z);
      const p = project(lat, lon, z);
      const world = 256 * 2 ** z;
      let dx = p.x - c.x;
      if (dx > world / 2) dx -= world;
      if (dx < -world / 2) dx += world;
      return { x: this._w / 2 + dx, y: this._h / 2 + (p.y - c.y) };
    }

    _toLatLon(x, y) {
      const z = this._view.zoom;
      const c = project(this._view.lat, this._view.lon, z);
      return unproject(c.x + (x - this._w / 2), c.y + (y - this._h / 2), z);
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
        const ll = this._toLatLon(e.clientX - r.left, e.clientY - r.top);
        this._flyTo(ll.lat, ll.lon, this._view.zoom + 1.2, 400);
      });
    }

    /* ------------------------------------------------------------ drawing */

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
      const dpr = this._dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
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
      if (name === "satellite") this._paintLayer(g, COAST, 9, again, 0.8);
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

    _loop() {
      if (this._raf || !this._fx) return;
      let last = 0;
      const step = (ts) => {
        this._raf = 0;
        if (!this.isConnected) return;
        // about 30 frames per second are enough for flames
        if (ts - last >= 30 || this._fly) {
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

    _paintFx(ts) {
      if (!this._view || !this._w) return;
      const g = this._fx.getContext("2d");
      const dpr = this._dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, this._w, this._h);
      const t = ts / 1000;
      const zoom = this._view.zoom;
      const home = this._home();
      this._hits = [];

      // place markers and home; labels are drawn last and skip each other
      const labels = [];
      const label = (x, y, text, color) => labels.push({ x, y, text, color });
      for (const p of this._places || []) {
        const q = this._toPx(p.lat, p.lon);
        if (q.x < -40 || q.y < -20 || q.x > this._w + 40 || q.y > this._h + 20) continue;
        g.beginPath();
        g.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
        g.fillStyle = "#7dd3c0";
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = "#0a1a22";
        g.stroke();
        label(q.x, q.y, p.name, "#9be5d3");
        this._hits.push({ x: q.x, y: q.y, r: 10, place: p });
      }

      // fire clusters: glow by power, fading with age
      const fires = this._fires || [];
      const icons = [];
      for (const f of fires) {
        const q = this._toPx(f.lat, f.lon);
        if (q.x < -30 || q.y < -30 || q.x > this._w + 30 || q.y > this._h + 30) continue;
        const age = (Date.now() - Date.parse(f.time)) / 3600000;
        const fade = age <= 12 ? 1 : clamp(1 - (age - 12) / 48, 0.35, 1);
        const [r, gg, b] = fireColor(f.mw);
        // a coarse cell far from home is drawn as a wider haze
        const cellPx = f.cell ? (f.cell * 111000) / ((156543.03392 * Math.cos(f.lat * (Math.PI / 180))) / 2 ** zoom) : 0;
        const base = clamp(3 + Math.sqrt(f.mw) * 0.9, 3, 16);
        const rad = Math.max(base, Math.min(cellPx * 0.5, 40));
        const pulse = 1 + 0.12 * Math.sin(t * 3 + f.lat * 7);
        const grd = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, rad * 2.2 * pulse);
        grd.addColorStop(0, `rgba(${r},${gg},${b},${0.85 * fade})`);
        grd.addColorStop(0.35, `rgba(${r},${gg},${b},${0.45 * fade})`);
        grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = grd;
        g.beginPath();
        g.arc(q.x, q.y, rad * 2.2 * pulse, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(q.x, q.y, clamp(base * 0.35, 1.6, 4), 0, Math.PI * 2);
        g.fillStyle = `rgba(255,245,220,${0.9 * fade})`;
        g.fill();
        this._hits.push({ x: q.x, y: q.y, r: Math.max(12, rad), fire: f });
        if (this._iconSet?.has(f)) icons.push({ f, q, fade });
      }

      // animated flame icons on a glowing ring, without overlaps
      const size = clamp(18 + zoom * 1.6, 22, 38);
      const placed = [];
      icons.sort((a, b) => b.f.mw - a.f.mw);
      for (const it of icons) {
        if (placed.length >= MAX_ICONS) break;
        if (placed.some((p) => Math.hypot(p.x - it.q.x, p.y - it.q.y) < size * 0.8)) continue;
        placed.push(it.q);
        const [r, gg, b] = fireColor(it.f.mw);
        const ring = 1 + 0.08 * Math.sin(t * 4 + it.f.lon * 5);
        g.save();
        g.globalAlpha = it.fade;
        g.beginPath();
        g.ellipse(it.q.x, it.q.y, size * 0.42 * ring, size * 0.14 * ring, 0, 0, Math.PI * 2);
        g.lineWidth = 2;
        g.strokeStyle = `rgba(${r},${gg},${b},.95)`;
        g.shadowColor = `rgba(${r},${gg},${b},.9)`;
        g.shadowBlur = 8;
        g.stroke();
        g.shadowBlur = 0;
        if (this._img?.complete && this._img.naturalWidth) {
          const flick = 1 + 0.05 * Math.sin(t * 9 + it.f.lat * 13) + 0.03 * Math.sin(t * 17 + it.f.lon);
          const w = size;
          const h = size * flick;
          // the flame stands on its foot (y = 115 of 128)
          g.drawImage(this._img, it.q.x - w / 2, it.q.y - h * (115 / 128), w, h);
        }
        g.restore();
      }

      // home: gold marker with a slow pulse
      const hq = this._toPx(home.lat, home.lon);
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
      labels.unshift({ x: hq.x, y: hq.y, text: this._config.home_name || "Home", color: "#ffd700" });
      g.font = "700 11px system-ui, sans-serif";
      const boxes = [];
      for (const l of labels) {
        const w = g.measureText(l.text).width;
        // right of the dot, else left of it
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
      const mpp = (156543.03392 * Math.cos(this._view.lat * (Math.PI / 180))) / 2 ** zoom;
      const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
      const km = nice.find((k) => (k * 1000) / mpp > 50) || 2000;
      const px = (km * 1000) / mpp;
      g.fillStyle = "rgba(255,255,255,.8)";
      g.fillRect(this._w - 12 - px, this._h - 24, px, 2);
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "right";
      g.fillText(`${km} km`, this._w - 12, this._h - 28);
      g.textAlign = "left";
    }

    _tap(x, y) {
      let best = null;
      for (const h of this._hits || []) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= h.r && (!best || d < best.d || (h.fire && !best.h.fire))) best = { h, d };
      }
      if (!best) {
        this._closePop();
        return;
      }
      if (best.h.place) {
        const p = best.h.place;
        this._flyTo(p.lat, p.lon, zoomFor(p.lat, p.r * 1.3, Math.min(this._w, this._h)));
        return;
      }
      this._showPop(best.h.fire, best.h.x, best.h.y);
    }

    _closePop() {
      this._root?.querySelector(".pop")?.remove();
    }

    _showPop(f, x, y) {
      this._closePop();
      const [r, g, b] = fireColor(f.mw);
      const near = f.near ? `${Math.round(f.near.d)} km ${compass(bearing(f.near.p.lat, f.near.p.lon, f.lat, f.lon))} of ${esc(f.near.p.name)}` : "";
      const firms = `${FIRMS_MAP}#d:24hrs;@${f.lon.toFixed(3)},${f.lat.toFixed(3)},11.0z`;
      const el = document.createElement("div");
      el.className = "pop";
      el.innerHTML = `<span class="x">×</span>
        <b style="color:rgb(${r},${g},${b})">${esc(fireLabel(f.mw)[0].toUpperCase() + fireLabel(f.mw).slice(1))} fire · ${f.mw} MW</b>
        <div>${Math.round(f.km)} km ${compass(f.brg)} of ${esc(this._config.home_name || "home")}${near ? `<br>${near}` : ""}</div>
        <div class="m">${f.count} detection${f.count === 1 ? "" : "s"} · peak pixel ${f.max} MW · seen ${ago(f.time)}${f.first !== f.time ? `, burning since ${esc(this._time(f.first))}` : ""}</div>
        <div class="m"><a href="${firms}" target="_blank" rel="noopener">NASA FIRMS map ↗</a></div>`;
      this._mapEl.appendChild(el);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      el.style.left = `${clamp(x - w / 2, 6, this._w - w - 6)}px`;
      const top = y - h - 14 >= 4 ? y - h - 14 : y + 14 + h <= this._h - 4 ? y + 14 : 4;
      el.style.top = `${top}px`;
      el.querySelector(".x").addEventListener("click", () => el.remove());
    }

    _time(iso) {
      const tz = this._hass?.config?.time_zone;
      try {
        return new Date(iso).toLocaleString(this._hass?.locale?.language || undefined, {
          timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit",
        });
      } catch (_e) {
        return new Date(iso).toLocaleString();
      }
    }

    /* ------------------------------------------------------------ text */

    _renderBody() {
      if (!this._root) return;
      const wrap = this._root.querySelector(".wrap");
      const sub = this._root.querySelector(".top .s");
      const hint = this._root.querySelector(".top .h");
      const big = this._root.querySelector(".big b");
      const icon = this._root.querySelector(".top img");
      if (!wrap) return;
      if (this._error && !this._data) {
        wrap.innerHTML = `<div class="msg">${this._error === "loading" ? "Magmarium is loading its data…" : `Could not load the data (${esc(this._error)}).`}</div>`;
        return;
      }
      if (!this._data) return;
      if (!this._data.fires_enabled) {
        wrap.innerHTML = `<div class="msg">Wildfires need a free NASA FIRMS map key and a wildfire radius above 0 in the Magmarium options.</div>`;
        sub.textContent = "Not configured";
        return;
      }
      const fires = this._fires || [];
      const day = Date.now() - 24 * 3600000;
      const recent = fires.filter((f) => Date.parse(f.time) >= day);
      const near = recent[0];
      const strong = recent.reduce((m, f) => (!m || f.mw > m.mw ? f : m), null);
      const close = recent.filter((f) => f.km <= 25).length;
      const col = !near ? "#7dd3c0" : near.km <= 10 ? "#ff3b3b" : near.km <= 30 ? "#ff8866" : near.km <= 100 ? "#ffb74d" : "#ffd700";
      big.textContent = String(recent.length);
      big.style.color = recent.length ? col : "#7dd3c0";
      icon.classList.toggle("calm", !recent.length);
      sub.style.color = col;
      sub.textContent = near
        ? `Nearest ${near.km < 10 ? near.km.toFixed(1) : Math.round(near.km)} km ${compass(near.brg)}${near.near ? ` · near ${near.near.p.name}` : ""}`
        : "No fires in the last 24 h";
      const radius = this._data.fires_meta?.radius_km;
      hint.textContent = near
        ? `${close ? `${close} within 25 km · ` : ""}strongest ${strong.mw} MW ${Math.round(strong.km)} km ${compass(strong.brg)}`
        : `Satellite watch within ${radius ? `${Math.round(radius)} km` : "your area"} · NASA FIRMS`;

      let html = "";
      const tiles = [];
      for (const p of this._places || []) {
        const inside = recent.filter((f) => haversine(p.lat, p.lon, f.lat, f.lon) <= p.r);
        const n = inside.length;
        const mw = inside.reduce((m, f) => Math.max(m, f.mw), 0);
        const nearest = inside.reduce((m, f) => Math.min(m, haversine(p.lat, p.lon, f.lat, f.lon)), Infinity);
        tiles.push(`<div class="tile ${n ? "hot" : ""}" data-lat="${p.lat}" data-lon="${p.lon}" data-r="${p.r}">
          <div class="k">${esc(p.name)}</div>
          <div class="v" style="color:${n ? `rgb(${fireColor(mw).join(",")})` : "#7dd3c0"}">${n ? `${n} fire${n === 1 ? "" : "s"}` : "Clear"}</div>
          <div class="s">${n ? `${Math.round(nearest)} km · ${Math.round(mw)} MW` : `within ${p.r} km`}</div></div>`);
      }
      const aq = this._airQuality();
      if (aq) tiles.push(aq);
      if (tiles.length) html += `<div class="tiles">${tiles.join("")}</div>`;

      const n = Number(this._config.list) || 0;
      if (n > 0) {
        if (recent.length) {
          html += `<div class="list">${recent.slice(0, n).map((f, i) => {
            const [r, g, b] = fireColor(f.mw);
            return `<div class="row" data-i="${i}"><span class="dot" style="background:rgb(${r},${g},${b});box-shadow:0 0 8px rgb(${r},${g},${b})"></span>
              <span class="main"><b>${f.km < 10 ? f.km.toFixed(1) : Math.round(f.km)} km ${compass(f.brg)}</b>${f.near ? ` · ${esc(f.near.p.name)}` : ""}</span>
              <span class="pw" style="color:rgb(${r},${g},${b})">${f.mw} MW</span><span class="tm">${ago(f.time)}</span></div>`;
          }).join("")}</div>`;
        } else {
          html += `<div class="none">🌿 No wildfire detected in the last 24 hours${radius ? ` within ${Math.round(radius)} km` : ""}.</div>`;
        }
      }
      const upd = this._data.fires_meta?.updated;
      html += `<div class="foot"><span>Satellites: VIIRS NOAA-20 / S-NPP via <a href="${FIRMS_MAP}" target="_blank" rel="noopener">NASA FIRMS</a></span>${upd ? `<span>checked ${esc(ago(upd))}</span>` : ""}</div>`;
      wrap.innerHTML = html;
      wrap.querySelectorAll(".tile[data-lat]").forEach((el) => el.addEventListener("click", () => {
        const lat = Number(el.dataset.lat);
        this._flyTo(lat, Number(el.dataset.lon), zoomFor(lat, Number(el.dataset.r) * 1.3, Math.min(this._w, this._h)));
      }));
      wrap.querySelectorAll(".row").forEach((el) => el.addEventListener("click", () => {
        const f = recent[Number(el.dataset.i)];
        if (!f) return;
        this._flyTo(f.lat, f.lon, Math.max(this._view.zoom, 10), 600);
        setTimeout(() => {
          const q = this._toPx(f.lat, f.lon);
          this._showPop(f, q.x, q.y);
        }, 650);
      }));
    }

    _airQuality() {
      const id = this._config.air_quality_entity;
      const st = id && this._hass?.states[id];
      if (!st) return "";
      const v = Number(st.state);
      const unit = st.attributes.unit_of_measurement || "";
      const name = this._config.air_quality_name || "Air quality";
      let col = "#7dd3c0";
      let txt = "good";
      if (Number.isFinite(v) && /µg|ug/.test(unit)) {
        if (v > 75) [col, txt] = ["#ef4444", "unhealthy"];
        else if (v > 37.5) [col, txt] = ["#f97316", "unhealthy for some"];
        else if (v > 25) [col, txt] = ["#facc15", "moderate"];
      }
      return `<div class="tile" data-aq="1"><div class="k">${esc(name)}</div>
        <div class="v" style="color:${col}">${esc(st.state)} ${esc(unit)}</div><div class="s">${Number.isFinite(v) && unit ? txt : ""}</div></div>`;
    }
  }

  if (!customElements.get("magmarium-fire-card")) {
    customElements.define("magmarium-fire-card", MagmariumFireCard);
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "magmarium-fire-card",
      name: "Magmarium wildfires",
      description: "Wildfires around your home on a zoomable map with places, the nearest fires and their power (NASA FIRMS).",
      preview: false,
      documentationURL: "https://github.com/mb26-dev/ha-magmarium",
    });
  }
}
