/*
 * Magmarium globe renderer.
 * Day side: NASA Blue Marble Next Generation, night side: NASA Black Marble
 * (both NASA Earth Observatory). The images are downloaded by the integration
 * and served from Home Assistant; this module decodes them and renders the
 * lit globe pixel by pixel in an orthographic projection with zoom.
 */

export const DEG = Math.PI / 180;

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** unit vector (earth fixed) for latitude/longitude in degrees */
export function ecef(latDeg, lonDeg) {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

/** view frame looking at (lat, lon): view, east and north unit vectors */
export function viewFrame(latDeg, lonDeg) {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
  return {
    view: [cl * co, cl * so, sl],
    east: [-so, co, 0],
    north: [-sl * co, -sl * so, cl],
  };
}

/** sun direction (earth fixed) for a time in ms, low precision */
export function sunDirection(ms) {
  const jd = ms / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const T = n / 36525.0;
  let gmst = (280.46061837 + 360.98564736629 * n + 0.000387933 * T * T) % 360;
  if (gmst < 0) gmst += 360;
  const lon = ra / DEG - gmst;
  return ecef(dec / DEG, lon);
}

async function decode(blob, w, h) {
  let source;
  if (typeof createImageBitmap === "function") {
    source = await createImageBitmap(blob);
  } else {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  if (source.close) source.close();
  return ctx.getImageData(0, 0, w, h).data;
}

/** texture size: high resolution on desktops, half on phones */
export function textureSize() {
  let big = true;
  try {
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const mem = navigator.deviceMemory;
    if (coarse || (typeof mem === "number" && mem < 4)) big = false;
  } catch (_e) {
    big = true;
  }
  return big ? [4096, 2048] : [2048, 1024];
}

/** download both images through the authenticated API and decode them */
export async function loadEarth(hass) {
  const [w, h] = textureSize();
  const get = async (kind) => {
    const resp = await hass.fetchWithAuth(`/api/magmarium/earth/${kind}`);
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return decode(await resp.blob(), w, h);
  };
  const [day, night] = await Promise.all([get("day"), get("night").catch(() => null)]);
  return { w, h, day, night };
}

/** decode an already available image source (used by the preview page) */
export async function earthFromBlobs(dayBlob, nightBlob) {
  const [w, h] = textureSize();
  const day = await decode(dayBlob, w, h);
  const night = nightBlob ? await decode(nightBlob, w, h) : null;
  return { w, h, day, night };
}

/**
 * Render the globe into `canvas` (width x height pixels).
 * G: view frame, sunE: sun direction, R: globe radius in pixels.
 * Pixels outside the disk stay transparent.
 */
export function renderEarth(canvas, earth, G, sunE, width, height, R) {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  const d = img.data;
  const E = G.east, N = G.north, V = G.view;
  const cx = width / 2, cy = height / 2;
  const invR = 1 / R;
  const inv2pi = 1 / (2 * Math.PI);
  const invPi = 1 / Math.PI;
  const has = !!(earth && earth.day);
  const w = has ? earth.w : 0;
  const h = has ? earth.h : 0;
  const day = has ? earth.day : null;
  const night = has ? earth.night : null;
  // texels larger than screen pixels: bilinear filtering avoids blocky coasts
  const bilinear = has && R * 2 * Math.PI > w * 1.15;
  // rows and columns that can contain the disk at all
  const j0 = Math.max(0, Math.floor(cy - R));
  const j1 = Math.min(height, Math.ceil(cy + R));
  const i0 = Math.max(0, Math.floor(cx - R));
  const i1 = Math.min(width, Math.ceil(cx + R));
  for (let j = j0; j < j1; j++) {
    const y = (cy - (j + 0.5)) * invR;
    const yy = y * y;
    let o = (j * width + i0) * 4;
    for (let i = i0; i < i1; i++, o += 4) {
      const x = (i + 0.5 - cx) * invR;
      const q = x * x + yy;
      if (q >= 1) continue;
      const z = Math.sqrt(1 - q);
      const n0 = x * E[0] + y * N[0] + z * V[0];
      const n1 = x * E[1] + y * N[1] + z * V[1];
      const n2 = x * E[2] + y * N[2] + z * V[2];
      const dot = n0 * sunE[0] + n1 * sunE[1] + n2 * sunE[2];
      const dayF = smooth(-0.12, 0.08, dot);
      const light = 0.35 + 0.75 * Math.min(1, Math.max(0, dot * 1.3 + 0.12));
      const k = dayF * light;
      let R0, G0, B0, Rn = 0, Gn = 0, Bn = 0;
      if (has) {
        const lat = Math.asin(n2 > 1 ? 1 : n2 < -1 ? -1 : n2);
        const lon = Math.atan2(n1, n0);
        const fu = (lon * inv2pi + 0.5) * w - 0.5;
        const fv = (0.5 - lat * invPi) * h - 0.5;
        if (bilinear) {
          let u0 = Math.floor(fu);
          let v0 = Math.floor(fv);
          const du = fu - u0;
          const dv = fv - v0;
          let u1 = u0 + 1;
          let v1 = v0 + 1;
          if (u0 < 0) u0 += w;
          if (u1 >= w) u1 -= w;
          if (u0 >= w) u0 -= w;
          if (v0 < 0) v0 = 0;
          if (v1 >= h) v1 = h - 1;
          if (v0 >= h) v0 = h - 1;
          const a = (v0 * w + u0) * 4, b = (v0 * w + u1) * 4, c = (v1 * w + u0) * 4, e = (v1 * w + u1) * 4;
          const w00 = (1 - du) * (1 - dv), w10 = du * (1 - dv), w01 = (1 - du) * dv, w11 = du * dv;
          R0 = day[a] * w00 + day[b] * w10 + day[c] * w01 + day[e] * w11;
          G0 = day[a + 1] * w00 + day[b + 1] * w10 + day[c + 1] * w01 + day[e + 1] * w11;
          B0 = day[a + 2] * w00 + day[b + 2] * w10 + day[c + 2] * w01 + day[e + 2] * w11;
          if (night) {
            Rn = night[a] * w00 + night[b] * w10 + night[c] * w01 + night[e] * w11;
            Gn = night[a + 1] * w00 + night[b + 1] * w10 + night[c + 1] * w01 + night[e + 1] * w11;
            Bn = night[a + 2] * w00 + night[b + 2] * w10 + night[c + 2] * w01 + night[e + 2] * w11;
          }
        } else {
          let u = Math.round(fu);
          let v = Math.round(fv);
          if (u < 0) u += w;
          if (u >= w) u -= w;
          if (v < 0) v = 0;
          if (v >= h) v = h - 1;
          const t = (v * w + u) * 4;
          R0 = day[t];
          G0 = day[t + 1];
          B0 = day[t + 2];
          if (night) {
            Rn = night[t];
            Gn = night[t + 1];
            Bn = night[t + 2];
          }
        }
      } else {
        // no imagery yet: a plain ocean globe
        R0 = 18;
        G0 = 58;
        B0 = 110;
      }
      let Rc = R0 * k, Gc = G0 * k, Bc = B0 * k;
      const nf = (1 - dayF) * 1.25;
      if (night) {
        Rc += Rn * nf;
        Gc += Gn * nf;
        Bc += Bn * nf;
      } else {
        Bc += 18 * (1 - dayF);
        Gc += 6 * (1 - dayF);
      }
      const rim = Math.pow(1 - z, 2.2);
      const al = rim * (0.25 + 0.5 * dayF);
      Rc = Rc * (1 - al) + 110 * al;
      Gc = Gc * (1 - al) + 165 * al;
      Bc = Bc * (1 - al) + 255 * al;
      d[o] = Rc > 255 ? 255 : Rc;
      d[o + 1] = Gc > 255 ? 255 : Gc;
      d[o + 2] = Bc > 255 ? 255 : Bc;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
