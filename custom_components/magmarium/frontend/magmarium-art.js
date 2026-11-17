/*
 * Magmarium artwork: volcano cones, crater glow, lava, ash plumes and ejecta.
 * Everything is drawn on a 2D canvas in CSS pixels. Plume particles live in
 * "plume space" (age and random seeds) and are placed relative to the volcano
 * on every frame, so they follow the globe when it is turned or zoomed.
 */

export const LEVEL_COLORS = {
  0: "#9aa0a6",
  1: "#34c759",
  2: "#ffd60a",
  3: "#ff9f0a",
  4: "#ff453a",
};

function hexRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// --------------------------------------------------------------- random

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --------------------------------------------------------------- puff sprites

const TONES = 14;
const VARIANTS = 5;
let SPRITES = null;

/**
 * Billowing ash puffs from dark (index 0) to light (index TONES-1). Each puff
 * is lit from above: bright cauliflower tops, darker undersides.
 */
function sprites() {
  if (SPRITES) return SPRITES;
  SPRITES = [];
  const size = 72;
  const rnd = mulberry(7);
  for (let vi = 0; vi < VARIANTS; vi++) {
    const layout = [];
    const blobs = 7 + Math.floor(rnd() * 5);
    for (let k = 0; k < blobs; k++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * size * 0.22;
      layout.push([size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d * 0.85, size * (0.14 + rnd() * 0.14)]);
    }
    const set = [];
    for (let t = 0; t < TONES; t++) {
      const f = t / (TONES - 1);
      // ash is a warm grey-brown when dark, neutral white when light
      const r = Math.round(58 + f * 184);
      const g = Math.round(52 + f * 186);
      const b = Math.round(48 + f * 188);
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d");
      for (const [ox, oy, rad] of layout) {
        const grad = ctx.createRadialGradient(ox - rad * 0.3, oy - rad * 0.42, rad * 0.08, ox, oy, rad);
        grad.addColorStop(0, `rgba(${Math.min(255, r + 38)},${Math.min(255, g + 36)},${Math.min(255, b + 34)},0.92)`);
        grad.addColorStop(0.5, `rgba(${r},${g},${b},0.78)`);
        grad.addColorStop(0.82, `rgba(${Math.round(r * 0.72)},${Math.round(g * 0.7)},${Math.round(b * 0.68)},0.42)`);
        grad.addColorStop(1, `rgba(${Math.round(r * 0.6)},${Math.round(g * 0.58)},${Math.round(b * 0.56)},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(ox, oy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      // soften the outer edge so overlapping puffs blend into one cloud
      ctx.globalCompositeOperation = "destination-in";
      const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
      edge.addColorStop(0, "rgba(0,0,0,1)");
      edge.addColorStop(0.7, "rgba(0,0,0,0.85)");
      edge.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, size, size);
      set.push(c);
    }
    SPRITES.push(set);
  }
  return SPRITES;
}

let GLOW = null;
function glowSprite() {
  if (GLOW) return GLOW;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,240,180,1)");
  g.addColorStop(0.25, "rgba(255,170,60,0.85)");
  g.addColorStop(0.6, "rgba(255,80,20,0.3)");
  g.addColorStop(1, "rgba(255,40,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  GLOW = c;
  return GLOW;
}

// --------------------------------------------------------------- cones

/**
 * Draw one volcano standing at (x, y) (base centre) with size s (CSS px).
 * opts: level, erupting (0..1 strength), night (0..1), t (seconds), alpha, selected, minor
 */
export function drawVolcano(ctx, x, y, s, opts) {
  const level = opts.level || 0;
  const color = LEVEL_COLORS[level] || LEVEL_COLORS[0];
  const alpha = opts.alpha == null ? 1 : opts.alpha;
  const erupt = opts.erupting || 0;
  const night = opts.night || 0;
  const t = opts.t || 0;
  const w = s * 1.15;
  const h = s * 1.45;
  ctx.save();
  ctx.globalAlpha = alpha;

  if (opts.minor) {
    // background volcanoes from the catalogue: a small, quiet triangle
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x, y - h);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fillStyle = "rgba(60,44,34,0.85)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,225,190,0.35)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.restore();
    return;
  }

  // glow of an erupting volcano behind the cone (reflection on the ash and the sky)
  if (erupt > 0) {
    const pulse = 1 + 0.15 * Math.sin(t * 3.1 + x);
    const r = s * (1.5 + 1.3 * night) * pulse;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha * erupt * (0.28 + 0.42 * night);
    ctx.drawImage(glowSprite(), x - r, y - h - r * 0.7, r * 2, r * 2);
    ctx.restore();
  }

  // ground shadow
  ctx.beginPath();
  ctx.ellipse(x + s * 0.18, y + s * 0.08, w * 1.12, s * 0.32, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();

  // alert level halo on the ground
  const halo = ctx.createRadialGradient(x, y, s * 0.2, x, y, w * 1.75);
  halo.addColorStop(0, rgba(color, 0.42));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(x, y, w * 1.75, s * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.13);
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.beginPath();
  ctx.ellipse(x, y, w * 1.28, s * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();

  // cone body
  const topW = w * 0.3;
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.bezierCurveTo(x - w * 0.62, y - h * 0.18, x - topW * 1.25, y - h * 0.72, x - topW, y - h);
  ctx.lineTo(x + topW, y - h);
  ctx.bezierCurveTo(x + topW * 1.25, y - h * 0.72, x + w * 0.62, y - h * 0.18, x + w, y);
  ctx.quadraticCurveTo(x, y + s * 0.2, x - w, y);
  ctx.closePath();
  const body = ctx.createLinearGradient(x - w, 0, x + w, 0);
  body.addColorStop(0, "#9b7a5c");
  body.addColorStop(0.42, "#6a4e3b");
  body.addColorStop(1, "#24170f");
  ctx.fillStyle = body;
  ctx.fill();
  // darker toe and lighter shoulder
  const shade = ctx.createLinearGradient(0, y - h, 0, y);
  shade.addColorStop(0, "rgba(255,230,200,0.12)");
  shade.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = shade;
  ctx.fill();

  // erosion gullies
  if (s > 6) {
    ctx.strokeStyle = "rgba(20,12,8,0.45)";
    ctx.lineWidth = Math.max(0.6, s * 0.06);
    for (const f of [-0.55, -0.15, 0.3, 0.62]) {
      ctx.beginPath();
      ctx.moveTo(x + topW * f * 1.6, y - h * 0.94);
      ctx.quadraticCurveTo(x + w * f * 0.55, y - h * 0.45, x + w * f * 0.92, y - s * 0.05);
      ctx.stroke();
    }
  }

  // lava flows down the flank while erupting
  if (erupt > 0 && s > 5) {
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.3 + x * 0.1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const f of [-0.35, 0.22]) {
      const grad = ctx.createLinearGradient(0, y - h, 0, y);
      grad.addColorStop(0, `rgba(255,220,120,${0.95 * erupt * pulse})`);
      grad.addColorStop(0.5, `rgba(255,110,30,${0.75 * erupt * pulse})`);
      grad.addColorStop(1, "rgba(160,30,10,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(0.8, s * 0.1);
      ctx.beginPath();
      ctx.moveTo(x + topW * f * 1.4, y - h * 0.97);
      ctx.bezierCurveTo(
        x + w * f * 0.35, y - h * 0.62,
        x + w * f * 0.85, y - h * 0.4,
        x + w * f * 0.7, y - h * 0.08,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // crater
  ctx.beginPath();
  ctx.ellipse(x, y - h, topW * 1.02, Math.max(0.8, s * 0.16), 0, 0, Math.PI * 2);
  if (erupt > 0) {
    const g = ctx.createRadialGradient(x, y - h, 0, x, y - h, topW * 1.1);
    g.addColorStop(0, "#fff2b0");
    g.addColorStop(0.45, "#ff8a1f");
    g.addColorStop(1, "#7a1a06");
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = "#1b110c";
  }
  ctx.fill();
  ctx.lineWidth = Math.max(0.8, s * 0.09);
  ctx.strokeStyle = level >= 2 ? rgba(color, 0.95) : "rgba(220,190,160,0.6)";
  ctx.stroke();

  // selected volcano
  if (opts.selected) {
    const r = w * 2.1 + Math.sin(t * 4) * s * 0.12;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.4, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // hot crater (additive), stronger at night
  if (erupt > 0) {
    const pulse = 1 + 0.22 * Math.sin(t * 4.3 + x * 0.7);
    const r = s * 0.75 * pulse;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha * erupt * (0.55 + 0.35 * night);
    ctx.drawImage(glowSprite(), x - r, y - h - r * 0.8, r * 2, r * 1.6);
    ctx.restore();
  }
}

/** expanding rings for volcanoes at warning (and watch while erupting) */
export function drawPulse(ctx, x, y, s, level, t, alpha) {
  const color = LEVEL_COLORS[level] || LEVEL_COLORS[0];
  const period = level >= 4 ? 1.8 : 2.8;
  ctx.save();
  for (let k = 0; k < 2; k++) {
    const p = ((t / period) + k * 0.5) % 1;
    const r = s * (1.4 + p * 3.6);
    ctx.globalAlpha = alpha * (1 - p) * 0.75;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.16 * (1 - p));
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.2, r * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// --------------------------------------------------------------- plumes

const ASH_TONE = {
  white: [0.82, 1.0],
  "white to gray": [0.5, 0.95],
  "white to grey": [0.5, 0.95],
  gray: [0.32, 0.72],
  grey: [0.32, 0.72],
  "gray to black": [0.12, 0.5],
  "grey to black": [0.12, 0.5],
  black: [0.04, 0.32],
};

const INTENSITY = {
  thin: { count: 34, size: 0.75, alpha: 0.55 },
  medium: { count: 58, size: 1.0, alpha: 0.75 },
  thick: { count: 86, size: 1.25, alpha: 0.95 },
};

/**
 * Ash plume of one volcano. Built from the VONA (height above summit, drift,
 * ash colour and intensity) or, more subtle, from the weekly report.
 */
export class AshPlume {
  constructor(id, ash) {
    this.id = id;
    this.update(ash);
  }

  update(ash) {
    this.ash = ash;
    const weekly = ash.source !== "vona";
    const intensity = INTENSITY[ash.intensity] || INTENSITY.medium;
    this.weekly = weekly;
    this.strength = Math.max(0.15, Math.min(1, ash.strength || (weekly ? 0.35 : 1)));
    // particles for the most detailed view; fewer are drawn when zoomed out
    this.count = weekly ? 30 : Math.round(intensity.count * 1.8);
    this.sizeF = weekly ? 0.7 : intensity.size;
    this.alphaF = weekly ? 0.42 : intensity.alpha;
    this.tone = ASH_TONE[ash.color] || (weekly ? [0.55, 0.9] : [0.3, 0.78]);
    let km = null;
    if (ash.above_summit_m != null) km = ash.above_summit_m / 1000;
    else if (ash.top_m != null && ash.elev != null) km = Math.max(0.3, (ash.top_m - ash.elev) / 1000);
    else if (ash.top_m != null) km = Math.max(0.5, ash.top_m / 1000 - 1.5);
    this.km = km == null ? (weekly ? 0.6 : 1.0) : km;
    this.dirDeg = ash.toward_deg;
    const rnd = mulberry(hashString(this.id));
    if (!this.parts || this.parts.length !== this.count) {
      this.parts = [];
      for (let i = 0; i < this.count; i++) {
        const life = 3.2 + rnd() * 3.4;
        this.parts.push({
          life,
          age: rnd() * life, // staggered so the plume is complete right away
          sx: rnd() - 0.5,
          sy: rnd(),
          rot: rnd(),
          wob: rnd() * Math.PI * 2,
          v: Math.floor(rnd() * VARIANTS),
        });
      }
    }
  }

  step(dt) {
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) p.age -= p.life;
    }
  }

  /**
   * x, y: crater position, s: cone size, zf: zoom factor for the plume height,
   * dir: screen unit vector of the drift (or null), night 0..1, erupting 0..1
   */
  draw(ctx, x, y, s, zf, dir, night, erupting, t, alpha, lod = 1) {
    const spr = sprites();
    const H = Math.min(130, 20 + this.km * 15) * zf;
    const drift = dir ? H * 0.95 : H * 0.18;
    const dx = dir ? dir[0] : 0.35;
    const dy = dir ? dir[1] : 0;
    const base = this.alphaF * this.strength * alpha;
    // darker at night, lighter in daylight
    const toneShift = -0.28 * night;
    // with more zoom more (and smaller) puffs: a finer, more detailed cloud
    const n = Math.min(this.parts.length, Math.round(this.parts.length * Math.min(1, 0.55 + 0.45 * lod)));
    const sorted = this.parts.slice(0, n).sort((a, b) => a.age / a.life - b.age / b.life);
    const shrink = 1 / Math.sqrt(Math.max(1, lod));
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      const u = p.age / p.life;
      const rise = H * (1 - Math.pow(1 - u, 2.1));
      const shear = drift * Math.pow(u, 1.5);
      const widen = (s * 0.22 + H * 0.36 * Math.pow(u, 0.9)) * p.sx;
      const wob = (Math.sin(t * 0.9 + p.wob) + 0.5 * Math.sin(t * 2.1 + p.wob * 3)) * s * 0.14 * u;
      const px = x + widen + wob + dx * shear;
      const py = y - rise + dy * shear * 0.55 + p.sy * s * 0.12;
      const r = (s * 0.36 + (H * 0.17 + s * 0.45) * Math.pow(u, 0.8)) * this.sizeF * (0.75 + 0.5 * p.rot) * (0.6 + 0.4 * shrink);
      const fadeIn = u < 0.08 ? u / 0.08 : 1;
      const a = base * fadeIn * Math.pow(1 - u, 1.25);
      if (a <= 0.01) continue;
      // lower parts of the column are darker, the top is lit
      let tone = this.tone[0] + (this.tone[1] - this.tone[0]) * Math.min(1, u * 1.4) + toneShift;
      tone = Math.max(0, Math.min(1, tone));
      const idx = Math.round(tone * (TONES - 1));
      ctx.globalAlpha = a;
      ctx.drawImage(spr[p.v][idx], px - r, py - r, r * 2, r * 2);
    }
    // incandescent base of an erupting column at night
    if (erupting > 0 && night > 0.2 && !this.weekly) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35 * night * erupting * alpha;
      const r = s * 1.6;
      ctx.drawImage(glowSprite(), x - r, y - r * 1.4, r * 2, r * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

/** glowing ejecta (Strombolian bursts) for live eruptions */
export class Ejecta {
  constructor(id) {
    this.rnd = mulberry(hashString(id) ^ 0x9e3779b9);
    this.parts = [];
    this.next = 0;
  }

  step(dt, t) {
    if (t >= this.next) {
      const n = 6 + Math.floor(this.rnd() * 8);
      for (let i = 0; i < n; i++) {
        this.parts.push({
          x: 0,
          y: 0,
          vx: (this.rnd() - 0.5) * 1.6,
          vy: -(1.6 + this.rnd() * 1.8),
          age: 0,
          life: 0.9 + this.rnd() * 0.9,
        });
      }
      this.next = t + 0.8 + this.rnd() * 2.6;
    }
    for (const p of this.parts) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 3.2 * dt;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
  }

  draw(ctx, x, y, s, night, alpha) {
    if (!this.parts.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.parts) {
      const u = p.age / p.life;
      ctx.globalAlpha = alpha * (1 - u) * (0.55 + 0.45 * night);
      ctx.fillStyle = u < 0.4 ? "#ffe9a8" : "#ff7a1a";
      const r = Math.max(0.7, s * 0.09 * (1 - u * 0.5));
      ctx.beginPath();
      ctx.arc(x + p.x * s * 2.2, y + p.y * s * 2.2, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
