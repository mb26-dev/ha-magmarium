"""Render the README screenshots of Magmarium with the real card and a data snapshot.

Needs Playwright with Chromium and a web server on port 8765 serving the repository root:

    python -m http.server 8765 &
    python docs/demo/render.py

The NASA Earth images are expected as docs/demo/earth_day.jpg and docs/demo/earth_night.jpg
(the GitHub workflow downloads them; without them the globe is drawn plain).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "images"
URL = "http://localhost:8765/docs/demo/render.html"
WIDTH, HEIGHT, SCALE = 1400, 780, 1.5


async def wait_ready(page) -> None:
    await page.wait_for_function("window.__card && window.__card._volcanoes && window.__card._volcanoes.length > 0", timeout=60000)
    # the Earth images are large: give the decoder time (without them the globe stays plain)
    try:
        await page.wait_for_function("window.__card._earth !== null && window.__card._earth !== undefined", timeout=90000)
    except Exception:  # noqa: BLE001
        print("Earth images not loaded, rendering a plain globe")
    await page.wait_for_timeout(1500)


async def prepare(page) -> None:
    await page.evaluate(
        """() => {
            const c = window.__card;
            c._setPseudoFull(true);
            c._legendSt.textContent = '';
            c._legendSt.classList.remove('bad');
        }"""
    )
    await page.wait_for_timeout(600)


async def fly(page, lat: float, lon: float, zoom: float, region: str | None = None) -> None:
    await page.evaluate(
        "([lat, lon, zoom, region]) => window.__card._flyTo(lat, lon, zoom, 900, region)",
        [lat, lon, zoom, region],
    )
    await page.wait_for_timeout(2600)


async def select(page, name: str, camera: str | None = None) -> bool:
    found = await page.evaluate(
        """([name, camera]) => {
            const c = window.__card;
            const v = c._volcanoes.find((x) => x.name === name || x.local === name);
            if (!v) return false;
            const cams = (c._data.cams || {})[v.id];
            if (camera && cams) {
                // show a daylight camera first instead of a thermal one
                const i = cams.findIndex((x) => x[2] && x[1].includes(camera));
                if (i > 0) cams.unshift(...cams.splice(i, 1));
            }
            c._selected = { kind: 'volcano', v };
            c._renderInfo();
            return true;
        }""",
        [name, camera],
    )
    await page.wait_for_timeout(3500)  # camera images load from the observatories
    return found


async def unselect(page) -> None:
    await page.evaluate("() => { const c = window.__card; c._selected = null; c._renderInfo(); }")


async def shot(page, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.jpg"
    await page.screenshot(path=str(path), type="jpeg", quality=86)
    print("wrote", path.relative_to(ROOT), path.stat().st_size // 1024, "KB")


def best_replay_time(history: dict) -> float | None:
    """The moment of the last 90 days with the most ash clouds on the globe at once."""
    from datetime import datetime

    events = [
        (datetime.fromisoformat(e["t"]).timestamp() * 1000, e)
        for e in history.get("events", [])
        if e.get("ash")
    ]
    best, best_n = None, 0
    for t, _ in events:
        n = len({e["id"] for t2, e in events if 0 <= t - t2 <= 3 * 3600 * 1000})
        if n > best_n:
            best, best_n = t + 20 * 60 * 1000, n
    return best


async def main() -> None:
    history = json.loads((ROOT / "docs" / "demo" / "history.json").read_text())
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/google-chrome" if "--local" in sys.argv else None, args=["--no-sandbox", "--ignore-gpu-blocklist"])
        page = await browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=SCALE)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(URL)
        await wait_ready(page)
        await prepare(page)

        # 1 Indonesia: the Ring of Fire with every alert level
        await fly(page, -3.0, 117.0, 2.9, "indonesia")
        await shot(page, "indonesia")

        # 2 the whole globe
        await fly(page, 8.0, 135.0, 1.0)
        await shot(page, "globe")

        # 3 Central and South America at night: official ash areas, earthquakes, glowing craters
        await fly(page, 5.0, -81.0, 3.3)
        await shot(page, "ash-areas")

        # 4 an erupting volcano with its report, the official ash area and the wind drift
        await fly(page, -8.1, 112.9, 6.5)
        if await select(page, "Semeru"):
            await shot(page, "eruption")
        await unselect(page)

        # 5 live camera of the observatory
        await fly(page, 19.4, -155.3, 7.0, "hawaii")
        if await select(page, "Kilauea", "KO"):
            await shot(page, "live-camera")
        await unselect(page)

        # 6 replay of the last 90 days at the moment with the most ash clouds
        t = best_replay_time(history)
        if t:
            await fly(page, -4.0, 121.0, 3.4, "indonesia")
            await page.evaluate(
                """async (t) => {
                    const c = window.__card;
                    await c._toggleReplay();
                    c._setPlaying(false);
                    c._replay.t = Math.max(c._replay.t0, Math.min(c._replay.t1, t));
                    c._replayState(true);
                }""",
                t,
            )
            await page.wait_for_timeout(4000)
            await shot(page, "replay")

        await browser.close()
        if errors:
            print("page errors:", errors)
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
