/*
 * Magmarium card - active volcanoes on a living globe.
 * https://github.com/mb26-dev/ha-magmarium
 */

import { DEG, ecef, viewFrame, sunDirection, loadEarth, renderEarth } from "./magmarium-earth.js";
import { LEVEL_COLORS, rgba, drawVolcano, drawPulse, AshPlume, Ejecta } from "./magmarium-art.js";

const VERSION = "0.1.0b2";
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

const ICONS = {
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  minus: "M19 13H5v-2h14v2z",
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14A8.2 8.2 0 0 1 4 12c0-.69.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.08 16zm2.95-8H5.08a7.99 7.99 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
  rotate: "M12 6v3l4-4-4-4v3a8 8 0 0 0-6.76 12.26l1.46-1.46A6 6 0 0 1 12 6zm6.76 1.74-1.46 1.46A6 6 0 0 1 12 18v-3l-4 4 4 4v-3a8 8 0 0 0 6.76-12.26z",
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
  .info.hidden { display: none; }
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

  setConfig(config) {
    this._config = {
      title: "Magmarium",
      height: 460,
      center: "home",
      regions: true,
      rotate: false,
      show_all: true,
      weekly_ash: true,
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
      .map((r) => ({ name: r[0], country: r[1], lat: r[2], lon: r[3], elev: r[4], number: r[5], p: ecef(r[2], r[3]) }));

    const keepPlumes = new Set();
    for (const v of this._volcanoes) {
      if (!v.ash) continue;
      if (v.ash.source !== "vona" && !weeklyAsh) continue;
      keepPlumes.add(v.id);
      const ash = { ...v.ash, elev: v.elev };
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
      const names = bad.map(([k]) => (k.startsWith("magma") ? "MAGMA" : "Weekly report"));
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
    for (const kind of ["volcano", "catalog"]) {
      for (const h of this._hits || []) {
        if (h.kind !== kind) continue;
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= h.r && (!best || d < best.d)) best = { ...h, d };
      }
      if (best) return best;
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

    if (sel.kind !== "volcano") {
      parts.push(`<div class="line"><span class="ic">⛰</span><span class="tx">${v.elev != null ? `${fmtInt(v.elev)} m` : "Elevation unknown"}${dist != null ? ` · ${fmtInt(Math.round(dist))} km from home` : ""}</span></div>`);
      parts.push(`<div class="muted">No current activity report for this volcano.</div>`);
      if (v.number) parts.push(`<div class="links"><a href="https://volcano.si.edu/volcano.cfm?vn=${encodeURIComponent(v.number)}" target="_blank" rel="noopener">Global Volcanism Program</a></div>`);
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

    if (v.eruption) {
      const txt = v.eruption.source === "vona"
        ? `Eruption reported ${esc(rel(v.eruption.time))}`
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
      const when = a.source === "vona" ? `observed ${esc(rel(a.time))}` : "reported in the weekly report";
      parts.push(`<div class="line"><span class="ic">☁</span><span class="tx">Ash cloud${bits.length ? ` · ${bits.join(" · ")}` : ""}<div class="muted">${when}</div></span></div>`);
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
    if (v.number) links.push(`<a href="https://volcano.si.edu/volcano.cfm?vn=${encodeURIComponent(v.number)}" target="_blank" rel="noopener">Global Volcanism Program</a>`);
    if (links.length) parts.push(`<div class="links">${links.join("")}</div>`);

    this._info.innerHTML = parts.join("");
    this._info.classList.remove("hidden");
    this._info.querySelector(".x").addEventListener("click", () => {
      this._selected = null;
      this._renderInfo();
    });
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

    for (const p of this._plumes.values()) p.step(dt);
    for (const e of this._ejecta.values()) e.step(dt, this._t);
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

    // active volcanoes, back to front
    const items = [];
    for (const v of this._volcanoes) {
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
      const ej = this._ejecta.get(v.id);
      if (ej) ej.draw(ctx, pr.x, craterY, s, night, alpha);
      const plume = this._plumes.get(v.id);
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

if (!customElements.get("magmarium-card")) {
  customElements.define("magmarium-card", MagmariumCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "magmarium-card",
    name: "Magmarium",
    description: "Active volcanoes on a living globe with alert levels, eruptions and ash clouds.",
    preview: false,
    documentationURL: "https://github.com/mb26-dev/ha-magmarium",
  });
  console.info(`%c MAGMARIUM %c ${VERSION} `, "background:#ff8a1f;color:#111;font-weight:700", "background:#222;color:#ffab4a");
}
