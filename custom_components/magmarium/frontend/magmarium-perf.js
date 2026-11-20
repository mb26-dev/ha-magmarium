/*
 * Magmarium performance mode, shared by all Magmarium cards.
 *
 * "full": smooth animation at the full screen resolution (default on desktops and phones).
 * "eco":  for weak wall tablets: half the frame rate, normal pixel density, a lighter Earth
 *         image and fewer ash particles. The look stays the same, the tablet stays cool.
 *
 * The card option `performance` (auto / full / eco) sets the default. The leaf button on the
 * globe overrides it for this browser only, so one wall tablet can run eco while the desktop
 * stays on full. In "auto" a weak device (few cores or little memory) or a globe that cannot
 * keep up switches to eco by itself.
 */

const KEY = "magmarium-eco";
const listeners = new Set();
let slow = false;

/** a touch device with few CPU cores, or little memory: typical for older or cheap wall tablets */
export function weakDevice() {
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const touch = (navigator.maxTouchPoints || 0) > 0;
  return mem <= 2 || (touch && cores <= 4);
}

/** the choice made with the leaf button in this browser, or null */
export function storedEco() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "1" || v === "0") return v === "1";
  } catch (e) {
    /* storage not available */
  }
  return null;
}

/** true when the cards should run in eco mode; option is the card option "performance" */
export function ecoMode(option) {
  const s = storedEco();
  if (s !== null) return s;
  const o = String(option || "auto").toLowerCase();
  if (o === "eco" || o === "low") return true;
  if (o === "full" || o === "high") return false;
  return slow || weakDevice();
}

/** set by the leaf button: remembered in this browser, all Magmarium cards follow */
export function setEco(on) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch (e) {
    /* storage not available: the choice lasts until the page is reloaded */
  }
  notify();
}

/** called by the globe when it cannot keep up in auto mode */
export function reportSlow() {
  if (slow) return;
  slow = true;
  notify();
}

export function onEcoChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      /* a card that is gone */
    }
  }
}

/** settings of the two modes */
export const PERF = {
  full: { frameMs: 31, maxDpr: 2, earthScale: 1, earthMoving: 0.5, maxEarthPx: 1.6e6, lod: 1 },
  eco: { frameMs: 66, maxDpr: 1, earthScale: 0.75, earthMoving: 0.35, maxEarthPx: 0.7e6, lod: 0.5 },
};

export function perf(eco) {
  return eco ? PERF.eco : PERF.full;
}
