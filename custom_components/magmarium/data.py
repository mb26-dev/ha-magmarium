"""Data handling for Magmarium: downloads, cache, merge and the card payload."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import gzip
import json
import logging
from pathlib import Path
import time
from typing import Any
from urllib.parse import urlsplit

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    ASH_LIVE_HOURS,
    BACKOFF_MINUTES,
    CAMS_MINUTES,
    DPC_MINUTES,
    INGV_CAMS_MINUTES,
    INGV_QUAKE_MINUTES,
    INGV_VONA_MINUTES,
    CATALOG_DAYS,
    DOMAIN,
    EARTH_DAY_FALLBACK_MONTH,
    EARTH_DAY_URL,
    EARTH_DIR,
    EARTH_NIGHT_URL,
    ERUPTION_HOURS,
    FEED_LABELS,
    GVP_CATALOG_URL,
    GVP_CATALOG_URL_FULL,
    GVP_WEEKLY_MINUTES,
    GVP_WEEKLY_URL,
    HISTORY_DAYS,
    MAGMA_LEVEL_MINUTES,
    MAGMA_LEVEL_URL,
    MAGMA_VONA_MINUTES,
    MAGMA_VONA_URL,
    OFFICIAL_MINUTES,
    ORBITARIUM_EARTH_DIR,
    QUAKE_MINUTES,
    SIGMET_MINUTES,
    SOURCE_DOWN_HOURS,
    SOURCE_GVP_WEEKLY,
    SOURCE_LABELS,
    SOURCE_MAGMA,
    SOURCE_ITALY,
    SOURCE_OFFICIAL,
    SOURCE_QUAKES,
    SOURCE_SIGMET,
    SOURCE_TSUNAMI,
    STORAGE_KEY,
    STORAGE_VERSION,
    THERMAL_MAX_HOURS,
    THERMAL_MINUTES,
    FIRE_MINUTES,
    TSUNAMI_MINUTES,
    VERSION,
    VONA_MAX_AGE_DAYS,
    WIKI_DAYS,
    WIND_MINUTES,
)
from .cams import (
    JMA_CAMS_URL,
    MAGMA_CCTV_URL,
    USGS_CAMS_URL,
    INGV_CAM_PAGES,
    geonet_cams,
    link_cams,
    parse_ingv_cams,
    parse_jma_cams,
    parse_magma_cctv,
    parse_usgs_cams,
)
from .extra import (
    IMO_URL,
    JMA_LIST_URL,
    JMA_WARNING_URL,
    QUAKE_MAX,
    QUAKE_URLS,
    SIGMET_URL,
    USGS_URL,
    WIKIDATA_URL,
    choose_wiki,
    mark_volcanic,
    parse_imo,
    parse_jma,
    parse_quakes,
    parse_sigmets,
    parse_usgs,
    parse_wikidata,
)
from .italy import (
    DPC_URL,
    INGV_VONA_URL,
    ingv_quake_url,
    keep_ingv_quake,
    merge_quakes,
    parse_dpc_levels,
    parse_ingv_quakes,
    parse_ingv_vona,
)
from .hazards import (
    BMKG_LATEST_URL,
    BMKG_RECENT_URL,
    FIRE_DAYS,
    FIRE_HOURS,
    FIRMS_DAYS,
    FIRMS_LABELS,
    FIRMS_SOURCES,
    FIRMS_URL,
    TSUNAMI_ATOM_URLS,
    FirmsKeyError,
    active_tsunami,
    cluster_fires,
    fire_area,
    firms_area,
    merge_thermal,
    parse_bmkg,
    parse_firms,
    parse_tsunami_atom,
    thermal_summary,
)
from .model import build_history, build_volcanoes
from .parsing import haversine_km, parse_gvp_catalog, parse_gvp_weekly, parse_level_page, parse_vona_list
from .wind import build_url as wind_url, parse_response as parse_wind, points_key, wind_for, wind_points

_LOGGER = logging.getLogger(__name__)

DNS_RETRIES = 2
DNS_RETRY_SECONDS = 8


def _is_dns_error(err: BaseException) -> bool:
    """True when a request failed while resolving the host name."""
    dns_cls = getattr(aiohttp, "ClientConnectorDNSError", None)
    if dns_cls is not None and isinstance(err, dns_cls):
        return True
    text = str(err).lower()
    return "dns" in text or "name resolution" in text or "temporary failure in name" in text


USER_AGENT = f"HomeAssistant-Magmarium/{VERSION} (+https://github.com/mb26-dev/ha-magmarium)"
HTTP_TIMEOUT = aiohttp.ClientTimeout(total=60)
IMAGE_TIMEOUT = aiohttp.ClientTimeout(total=180)
MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]
VONA_MAX_PAGES_FIRST = 3
VONA_KEEP = 1500
# older VONA pages are read a few per refresh until VONA_MAX_AGE_DAYS are covered,
# so every volcano gets its newest notice even when it is weeks old
VONA_BACKFILL_PAGES = 3
VONA_BACKFILL_MAX_PAGE = 150

# feed key -> (source that enables it, refresh minutes)
FEEDS = {
    "magma_levels": (SOURCE_MAGMA, MAGMA_LEVEL_MINUTES),
    "magma_vona": (SOURCE_MAGMA, MAGMA_VONA_MINUTES),
    "gvp_weekly": (SOURCE_GVP_WEEKLY, GVP_WEEKLY_MINUTES),
    "catalog": (None, CATALOG_DAYS * 24 * 60),
    "wind": (None, WIND_MINUTES),
    "usgs": (SOURCE_OFFICIAL, OFFICIAL_MINUTES),
    "imo": (SOURCE_OFFICIAL, OFFICIAL_MINUTES),
    "jma": (SOURCE_OFFICIAL, OFFICIAL_MINUTES),
    "dpc": (SOURCE_ITALY, DPC_MINUTES),
    "ingv_vona": (SOURCE_ITALY, INGV_VONA_MINUTES),
    "ingv_quakes": (SOURCE_ITALY, INGV_QUAKE_MINUTES),
    "ingv_cams": (SOURCE_ITALY, INGV_CAMS_MINUTES),
    "sigmet": (SOURCE_SIGMET, SIGMET_MINUTES),
    "quakes": (SOURCE_QUAKES, QUAKE_MINUTES),
    "wiki": (None, WIKI_DAYS * 24 * 60),
    "cams": (None, CAMS_MINUTES),
    "tsunami": (SOURCE_TSUNAMI, TSUNAMI_MINUTES),
    # only with a NASA FIRMS map key
    "thermal": (None, THERMAL_MINUTES),
    "fires": (None, FIRE_MINUTES),
}
# feeds read in the main loop, in this order
MAIN_FEEDS = (
    "catalog", "wiki", "magma_levels", "magma_vona", "gvp_weekly", "usgs", "imo", "jma",
    "dpc", "ingv_vona", "sigmet", "quakes", "ingv_quakes", "cams", "ingv_cams", "tsunami", "thermal", "fires",
)
# repair issues are raised per source, for the feeds of that source
REPAIR_SOURCES = (SOURCE_MAGMA, SOURCE_GVP_WEEKLY, SOURCE_OFFICIAL, SOURCE_ITALY, SOURCE_SIGMET, SOURCE_QUAKES)


class FeedError(Exception):
    """A download or parse problem of one feed."""


class MagmariumData:
    """Downloads, caches and merges all volcano sources."""

    def __init__(
        self,
        hass: HomeAssistant,
        sources: list[str],
        firms_key: str | None = None,
        fire_radius_km: float = 0.0,
    ) -> None:
        self.hass = hass
        self.sources = list(sources)
        self.firms_key = (firms_key or "").strip()
        self.fire_radius_km = max(0.0, float(fire_radius_km or 0))
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._lock = asyncio.Lock()
        self.catalog: list[list[Any]] = []
        self.levels: list[dict[str, Any]] = []
        self.vonas: list[dict[str, Any]] = []
        self.vona_backfill: dict[str, Any] = {"page": VONA_MAX_PAGES_FIRST + 1, "done": False}
        self.weekly: list[dict[str, Any]] = []
        self.weekly_published: str | None = None
        # winds aloft per volcano id, and the set of places they were fetched for
        self.wind: dict[str, dict[str, Any]] = {}
        self.wind_key: str = ""
        # official alert levels per source, ash SIGMETs, earthquakes, Wikipedia titles per volcano number
        self.official: dict[str, list[dict[str, Any]]] = {}
        self.sigmets: list[dict[str, Any]] = []
        self.quakes: list[dict[str, Any]] = []
        self.ingv_quakes: list[dict[str, Any]] = []
        self.wiki: dict[str, list[str]] = {}
        # official volcano cameras per provider
        self.cams: dict[str, list[dict[str, Any]]] = {}
        self.cam_map: dict[str, list[dict[str, Any]]] = {}
        # tsunami bulletins of all sources, satellite hotspots per volcano id
        self.tsunami: list[dict[str, Any]] = []
        self.thermal: dict[str, dict[str, Any]] = {}
        # wildfire clusters around home (NASA FIRMS)
        self.fires: list[dict[str, Any]] = []
        self.fires_meta: dict[str, Any] = {}
        self.history_json: bytes | None = None
        self.history_gzip: bytes | None = None
        self._history_key: str = ""
        # feed -> {"last_ok": ts, "last_attempt": ts, "retry_after": ts, "error": str|None, "failing_since": ts|None}
        self.feed_state: dict[str, dict[str, Any]] = {}
        self.result: dict[str, Any] = {"volcanoes": [], "catalog": [], "latest_vona": None}
        self.updated: float = 0.0
        self.payload_json: bytes | None = None
        self.payload_gzip: bytes | None = None
        # earth imagery
        self.earth_dir = Path(hass.config.path(".storage", EARTH_DIR))
        self.orbitarium_dir = Path(hass.config.path(".storage", ORBITARIUM_EARTH_DIR))
        self._earth_lock = asyncio.Lock()
        self._earth_retry = 0.0
        self.earth_day_file: Path | None = None
        self.earth_night_file: Path | None = None

    # ------------------------------------------------------------------ store

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            self.catalog = stored.get("catalog") or []
            self.levels = stored.get("levels") or []
            self.vonas = stored.get("vonas") or []
            self.vona_backfill = stored.get("vona_backfill") or {"page": VONA_MAX_PAGES_FIRST + 1, "done": False}
            self.weekly = stored.get("weekly") or []
            self.weekly_published = stored.get("weekly_published")
            self.wind = stored.get("wind") or {}
            self.wind_key = stored.get("wind_key") or ""
            self.official = stored.get("official") or {}
            self.sigmets = stored.get("sigmets") or []
            self.quakes = stored.get("quakes") or []
            self.ingv_quakes = stored.get("ingv_quakes") or []
            self.wiki = stored.get("wiki") or {}
            self.cams = stored.get("cams") or {}
            self.tsunami = stored.get("tsunami") or []
            self.thermal = stored.get("thermal") or {}
            self.fires = stored.get("fires") or []
            self.fires_meta = stored.get("fires_meta") or {}
            self.feed_state = stored.get("feeds") or {}
        await self.async_rebuild()

    async def _async_save(self) -> None:
        await self._store.async_save({
            "catalog": self.catalog,
            "levels": self.levels,
            "vonas": self.vonas,
            "vona_backfill": self.vona_backfill,
            "weekly": self.weekly,
            "weekly_published": self.weekly_published,
            "wind": self.wind,
            "wind_key": self.wind_key,
            "official": self.official,
            "sigmets": self.sigmets,
            "quakes": self.quakes,
            "ingv_quakes": self.ingv_quakes,
            "wiki": self.wiki,
            "cams": self.cams,
            "tsunami": self.tsunami,
            "thermal": self.thermal,
            "fires": self.fires,
            "fires_meta": self.fires_meta,
            "feeds": self.feed_state,
        })

    # --------------------------------------------------------------- feeds

    def _enabled(self, feed: str) -> bool:
        if feed == "thermal":
            return bool(self.firms_key)
        if feed == "fires":
            return bool(self.firms_key) and self.fire_radius_km > 0 and self.hass.config.latitude is not None
        source = FEEDS[feed][0]
        return source is None or source in self.sources

    def _due(self, feed: str, now: float) -> bool:
        st = self.feed_state.get(feed) or {}
        if now < float(st.get("retry_after") or 0):
            return False
        return now - float(st.get("last_ok") or 0) >= FEEDS[feed][1] * 60

    def _ok(self, feed: str, now: float) -> None:
        st = self.feed_state.setdefault(feed, {})
        st.update({"last_ok": now, "last_attempt": now, "retry_after": 0, "error": None, "failing_since": None})

    def _mask(self, text: str) -> str:
        """Hide the NASA FIRMS map key: it is part of the request path and must never reach a log."""
        if self.firms_key and text:
            return text.replace(self.firms_key, "***")
        return text

    def _fail(self, feed: str, now: float, err: str) -> None:
        err = self._mask(err)
        st = self.feed_state.setdefault(feed, {})
        st["last_attempt"] = now
        st["error"] = err[:300]
        st["retry_after"] = now + BACKOFF_MINUTES * 60
        if not st.get("failing_since"):
            st["failing_since"] = now
        _LOGGER.warning("Magmarium feed %s failed, next attempt in %s minutes: %s", feed, BACKOFF_MINUTES, err)

    async def _get(self, url: str, binary: bool = False) -> Any:
        """GET a feed. A DNS lookup that times out is tried again after a short pause:
        the first answer from a far away name server often arrives only after the
        resolver gave up, and the second lookup then comes from the cache."""
        session = async_get_clientsession(self.hass)
        for attempt in range(DNS_RETRIES + 1):
            try:
                async with session.get(
                    url,
                    timeout=HTTP_TIMEOUT,
                    headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
                ) as resp:
                    if resp.status == 204:
                        return b"" if binary else ""
                    if resp.status != 200:
                        raise FeedError(f"HTTP {resp.status}")
                    return await (resp.read() if binary else resp.text())
            except (aiohttp.ClientError, asyncio.TimeoutError) as err:
                if attempt < DNS_RETRIES and _is_dns_error(err):
                    _LOGGER.debug(
                        "Magmarium: DNS lookup for %s failed, trying again: %s", urlsplit(url).hostname, self._mask(str(err))
                    )
                    await asyncio.sleep(DNS_RETRY_SECONDS * (attempt + 1))
                    continue
                raise FeedError(self._mask(str(err)) or err.__class__.__name__) from err
        raise FeedError("DNS lookup failed")

    async def async_refresh(self, force: bool = False) -> bool:
        """Download every feed that is due. Returns True when anything changed."""
        async with self._lock:
            now = time.time()
            changed = False
            for feed in MAIN_FEEDS:
                if not self._enabled(feed):
                    continue
                if not force and not self._due(feed, now):
                    continue
                try:
                    await self._refresh_feed(feed)
                except FeedError as err:
                    self._fail(feed, now, str(err))
                    continue
                except (ValueError, TypeError, KeyError, IndexError) as err:
                    self._fail(feed, now, f"unexpected content: {err}")
                    continue
                self._ok(feed, now)
                changed = True
            self.async_update_repairs()
            if changed:
                await self.async_rebuild()
            if await self._refresh_wind(now, force):
                changed = True
            if changed:
                await self._async_save()
            await self.async_rebuild()
            return changed

    async def async_refresh_quakes(self) -> bool:
        """Fast path for new earthquakes: the small USGS day feed (M2.5+), merged into the list.

        The full refresh (week and day feed) keeps its own interval; this only adds quakes
        that are not known yet, so alerts follow within minutes. Returns True on new quakes.
        """
        if not self._enabled("quakes"):
            return False
        async with self._lock:
            now = time.time()
            st = self.feed_state.get("quakes") or {}
            if now < float(st.get("retry_after") or 0):
                return False
            try:
                text = await self._get(QUAKE_URLS[-1])
                fresh = await self.hass.async_add_executor_job(parse_quakes, [text])
            except FeedError as err:
                _LOGGER.debug("Magmarium fast quake check failed: %s", err)
                return False
            except (ValueError, TypeError, KeyError, IndexError) as err:
                _LOGGER.debug("Magmarium fast quake check: unexpected content: %s", err)
                return False
            known = {q.get("id") for q in self.quakes}
            new = [q for q in fresh if q["id"] not in known]
            if not new:
                return False
            self.quakes = sorted(new + self.quakes, key=lambda q: q["time"], reverse=True)[:QUAKE_MAX]
            await self.async_rebuild()
            return True

    async def _refresh_feed(self, feed: str) -> None:
        if feed == "catalog":
            await self._refresh_catalog()
        elif feed == "wiki":
            text = await self._get(WIKIDATA_URL)
            self.wiki = await self.hass.async_add_executor_job(parse_wikidata, text)
        elif feed == "magma_levels":
            await self._refresh_levels()
        elif feed == "magma_vona":
            await self._refresh_vona()
        elif feed == "gvp_weekly":
            await self._refresh_weekly()
        elif feed == "usgs":
            text = await self._get(USGS_URL)
            self.official["usgs"] = await self.hass.async_add_executor_job(parse_usgs, text)
        elif feed == "imo":
            page = await self._get(IMO_URL)
            rows = await self.hass.async_add_executor_job(parse_imo, page)
            if not rows:
                raise FeedError("no notifications found on the Icelandic Met Office page")
            self.official["imo"] = rows
        elif feed == "jma":
            warning = await self._get(JMA_WARNING_URL)
            vlist = await self._get(JMA_LIST_URL)
            self.official["jma"] = await self.hass.async_add_executor_job(parse_jma, warning, vlist)
        elif feed == "dpc":
            text = await self._get(DPC_URL)
            rows = await self.hass.async_add_executor_job(parse_dpc_levels, text)
            if not rows:
                raise FeedError("no alert levels found in the Civil Protection data")
            self.official["dpc"] = rows
        elif feed == "ingv_vona":
            page = await self._get(INGV_VONA_URL)
            self.official["ingv"] = await self.hass.async_add_executor_job(
                parse_ingv_vona, page, datetime.now(timezone.utc)
            )
        elif feed == "ingv_quakes":
            text = await self._get(ingv_quake_url(datetime.now(timezone.utc)))
            self.ingv_quakes = await self.hass.async_add_executor_job(parse_ingv_quakes, text)
        elif feed == "sigmet":
            text = await self._get(SIGMET_URL)
            if not text.strip():
                self.sigmets = []  # no volcanic ash SIGMET in force anywhere
            else:
                self.sigmets = await self.hass.async_add_executor_job(parse_sigmets, text, datetime.now(timezone.utc))
        elif feed == "quakes":
            texts = [await self._get(url) for url in QUAKE_URLS]
            self.quakes = await self.hass.async_add_executor_job(parse_quakes, texts)
        elif feed == "cams":
            await self._refresh_cams()
        elif feed == "ingv_cams":
            pages = [(url, await self._get(url)) for url in INGV_CAM_PAGES]
            rows = await self.hass.async_add_executor_job(parse_ingv_cams, pages, time.time())
            if not rows:
                raise FeedError("no current camera image on the INGV pages")
            self.cams["ingv"] = rows
        elif feed == "tsunami":
            await self._refresh_tsunami()
        elif feed == "thermal":
            await self._refresh_thermal()
        elif feed == "fires":
            await self._refresh_fires()

    async def _refresh_tsunami(self) -> None:
        """NOAA warning centers and BMKG; one failing source keeps the others."""
        events: list[dict[str, Any]] = []
        errors: list[str] = []
        for center, url in TSUNAMI_ATOM_URLS.items():
            try:
                text = await self._get(url)
                events += await self.hass.async_add_executor_job(parse_tsunami_atom, text, center)
            except Exception as err:  # noqa: BLE001
                errors.append(f"NOAA {center}: {err}")
        try:
            texts = [await self._get(BMKG_LATEST_URL), await self._get(BMKG_RECENT_URL)]
            events += await self.hass.async_add_executor_job(parse_bmkg, texts)
        except Exception as err:  # noqa: BLE001
            errors.append(f"BMKG: {err}")
        if len(errors) == 3:
            raise FeedError("; ".join(errors))
        if errors:
            _LOGGER.warning("Some tsunami sources could not be loaded: %s", "; ".join(errors))
            # keep the bulletins of the failing sources from the last time
            failed = [e.split(":")[0] for e in errors]
            events += [ev for ev in self.tsunami if any(ev["source"].startswith(prefix) for prefix in failed)]
        self.tsunami = events

    async def _refresh_thermal(self) -> None:
        """NASA FIRMS hotspots around every volcano with a raised alert level, an eruption or ash."""
        targets = [
            v for v in (self.result.get("volcanoes") or [])
            if v.get("lat") is not None and ((v.get("level") or 0) >= 2 or v.get("eruption") or v.get("ash"))
        ]
        sem = asyncio.Semaphore(4)
        found: dict[str, dict[str, Any]] = {}
        failures: list[str] = []

        async def one(v: dict[str, Any]) -> None:
            summary = None
            for source in FIRMS_SOURCES:
                url = FIRMS_URL.format(key=self.firms_key, source=source, area=firms_area(v["lat"], v["lon"]), days=FIRMS_DAYS)
                async with sem:
                    text = await self._get(url)
                points = await self.hass.async_add_executor_job(parse_firms, text)
                label = FIRMS_LABELS[source]
                summary = merge_thermal(summary, thermal_summary(points, v["lat"], v["lon"], label))
            if summary:
                found[v["id"]] = summary

        for v in targets:
            try:
                await one(v)
            except FirmsKeyError as err:
                raise FeedError(f"NASA FIRMS refused the map key: {err}") from err
            except Exception as err:  # noqa: BLE001
                failures.append(f"{v['name']}: {err}")
                if len(failures) >= 5 and not found:
                    raise FeedError("; ".join(failures[:5])) from err
        if failures:
            _LOGGER.debug("Thermal anomalies not loaded for %s volcanoes: %s", len(failures), self._mask(str(failures[:5])))
        self.thermal = found

    async def _refresh_fires(self) -> None:
        """NASA FIRMS hotspots around home, grouped into fire clusters."""
        home = (float(self.hass.config.latitude), float(self.hass.config.longitude))
        area = fire_area(home[0], home[1], self.fire_radius_km)
        points: list[dict[str, Any]] = []
        errors: list[str] = []
        for source in FIRMS_SOURCES:
            label = FIRMS_LABELS[source]
            url = FIRMS_URL.format(key=self.firms_key, source=source, area=area, days=FIRE_DAYS)
            try:
                text = await self._get(url)
                rows = await self.hass.async_add_executor_job(parse_firms, text)
            except FirmsKeyError as err:
                raise FeedError(f"NASA FIRMS refused the map key: {err}") from err
            except FeedError as err:
                errors.append(f"{label}: {err}")
                continue
            for row in rows:
                row["src"] = label
            points += rows
        if errors and len(errors) == len(FIRMS_SOURCES):
            raise FeedError("; ".join(errors))
        volcanoes = [(r[3], r[4]) for r in self.catalog if len(r) > 4 and isinstance(r[3], (int, float))]
        volcanoes += [(v["lat"], v["lon"]) for v in (self.result.get("volcanoes") or []) if v.get("lat") is not None]
        now = datetime.now(timezone.utc)
        self.fires = await self.hass.async_add_executor_job(
            cluster_fires, points, home, self.fire_radius_km, volcanoes, now
        )
        self.fires_meta = {
            "updated": now.isoformat(),
            "hotspots": len(points),
            "radius_km": self.fire_radius_km,
            # satellites that answered and saw at least one hotspot
            "satellites": sorted({p["src"] for p in points}),
        }

    async def _refresh_cams(self) -> None:
        """Official camera lists; a provider that fails keeps its last list."""
        errors: list[str] = []

        async def usgs() -> list[dict[str, Any]]:
            text = await self._get(USGS_CAMS_URL)
            return await self.hass.async_add_executor_job(parse_usgs_cams, text, time.time())

        async def jma() -> list[dict[str, Any]]:
            page = await self._get(JMA_CAMS_URL)
            vlist = await self._get(JMA_LIST_URL)
            return await self.hass.async_add_executor_job(parse_jma_cams, page, vlist)

        async def magma() -> list[dict[str, Any]]:
            page = await self._get(MAGMA_CCTV_URL)
            return await self.hass.async_add_executor_job(parse_magma_cctv, page)

        for key, job in (("usgs", usgs), ("jma", jma), ("magma", magma)):
            try:
                self.cams[key] = await job()
            except (FeedError, ValueError, TypeError, KeyError) as err:
                errors.append(f"{key}: {err}")
        if len(errors) == 3:
            raise FeedError("; ".join(errors))
        if errors:
            _LOGGER.warning("Some camera lists could not be loaded, the last lists are kept: %s", "; ".join(errors))

    async def _refresh_wind(self, now: float, force: bool) -> bool:
        """Winds aloft for every volcano with ash or an eruption, hourly or when that set changes."""
        points = wind_points(self.result.get("volcanoes") or [])
        if not points:
            self.wind = {}
            self.wind_key = ""
            return False
        key = points_key(points)
        st = self.feed_state.get("wind") or {}
        if now < float(st.get("retry_after") or 0):
            return False
        if not force and key == self.wind_key and not self._due("wind", now):
            return False
        try:
            text = await self._get(wind_url(points))
            data = await self.hass.async_add_executor_job(json.loads, text)
            self.wind = await self.hass.async_add_executor_job(parse_wind, data, points)
        except FeedError as err:
            self._fail("wind", now, str(err))
            return False
        except (ValueError, TypeError, KeyError, IndexError) as err:
            self._fail("wind", now, f"unexpected content: {err}")
            return False
        self.wind_key = key
        self._ok("wind", now)
        return True

    async def _refresh_catalog(self) -> None:
        try:
            text = await self._get(GVP_CATALOG_URL)
            rows = await self.hass.async_add_executor_job(parse_gvp_catalog, text)
        except (FeedError, ValueError):
            # some GeoServer versions reject propertyName; the full list works everywhere
            text = await self._get(GVP_CATALOG_URL_FULL)
            rows = await self.hass.async_add_executor_job(parse_gvp_catalog, text)
        self.catalog = rows
        _LOGGER.info("Volcano catalogue ready: %s Holocene volcanoes", len(rows))

    async def _refresh_levels(self) -> None:
        page = await self._get(MAGMA_LEVEL_URL)
        rows = await self.hass.async_add_executor_job(parse_level_page, page)
        if not rows:
            raise FeedError("no volcanoes found on the activity level page")
        self.levels = rows

    async def _refresh_vona(self) -> None:
        known = {self._vona_key(v) for v in self.vonas}
        newest_known = max((v["issued"] for v in self.vonas), default=None)
        pages = 1 if newest_known else VONA_MAX_PAGES_FIRST
        found: list[dict[str, Any]] = []
        page_no = 1
        while page_no <= VONA_MAX_PAGES_FIRST:
            url = MAGMA_VONA_URL if page_no == 1 else f"{MAGMA_VONA_URL}?page={page_no}"
            page = await self._get(url)
            items = await self.hass.async_add_executor_job(parse_vona_list, page)
            if not items:
                if page_no == 1:
                    raise FeedError("no notices found on the VONA page")
                break
            for item in items:
                item = {**item, "issued": item["issued"].isoformat()}
                if self._vona_key(item) not in known:
                    found.append(item)
            oldest = min(i["issued"] for i in items).isoformat()
            # continue paging only on the first run or when there is a gap to the cache
            if page_no >= pages and (newest_known is None or oldest <= newest_known):
                break
            page_no += 1
        cutoff = (datetime.now(timezone.utc) - timedelta(days=VONA_MAX_AGE_DAYS)).isoformat()
        found += await self._backfill_vona(known, cutoff)
        if found:
            self.vonas = self._merge_vonas(self.vonas + found, cutoff)
            _LOGGER.debug("%s new VONA notices", len(found))

    async def _backfill_vona(self, known: set[str], cutoff: str) -> list[dict[str, Any]]:
        """Read a few older VONA pages per refresh until the notices reach back to the cutoff.

        New notices push the old ones to later pages, so a page can repeat notices
        already known, but none is skipped.
        """
        state = self.vona_backfill
        if state.get("done"):
            return []
        found: list[dict[str, Any]] = []
        for _ in range(VONA_BACKFILL_PAGES):
            page_no = int(state.get("page") or VONA_MAX_PAGES_FIRST + 1)
            if page_no > VONA_BACKFILL_MAX_PAGE:
                state["done"] = True
                break
            try:
                page = await self._get(f"{MAGMA_VONA_URL}?page={page_no}")
                items = await self.hass.async_add_executor_job(parse_vona_list, page)
            except Exception as err:  # noqa: BLE001
                # the newest notices are already in; try the older ones again next time
                _LOGGER.debug("Older VONA page %s not loaded: %s", page_no, err)
                break
            if not items:
                state["done"] = True
                break
            for item in items:
                item = {**item, "issued": item["issued"].isoformat()}
                if self._vona_key(item) not in known:
                    known.add(self._vona_key(item))
                    found.append(item)
            state["page"] = page_no + 1
            if min(i["issued"] for i in items).isoformat() < cutoff:
                state["done"] = True
                break
        if state.get("done"):
            _LOGGER.info("Older VONA notices loaded")
        return found

    @staticmethod
    def _merge_vonas(vonas: list[dict[str, Any]], cutoff: str) -> list[dict[str, Any]]:
        """Notices of the last VONA_MAX_AGE_DAYS, and always the newest notice of every volcano."""
        vonas = sorted(vonas, key=lambda v: v["issued"], reverse=True)
        newest: set[str] = set()
        keep: list[dict[str, Any]] = []
        for v in vonas:
            name = (v.get("name") or "").lower()
            first = name not in newest
            newest.add(name)
            if first or (v["issued"] >= cutoff and len(keep) < VONA_KEEP):
                keep.append(v)
        return keep

    @staticmethod
    def _vona_key(v: dict[str, Any]) -> str:
        if v.get("magma_id"):
            return f"id:{v['magma_id']}"
        return f"{v.get('name')}|{v.get('issued')}"

    async def _refresh_weekly(self) -> None:
        data = await self._get(GVP_WEEKLY_URL, binary=True)
        parsed = await self.hass.async_add_executor_job(parse_gvp_weekly, data)
        self.weekly = parsed["items"]
        self.weekly_published = parsed["published"]

    # --------------------------------------------------------------- repairs

    def async_update_repairs(self) -> None:
        now = time.time()
        for source in REPAIR_SOURCES:
            feeds = [f for f, (s, _) in FEEDS.items() if s == source]
            down = [
                f for f in feeds
                if self._enabled(f)
                and (since := float((self.feed_state.get(f) or {}).get("failing_since") or 0))
                and now - since >= SOURCE_DOWN_HOURS * 3600
            ]
            issue_id = f"source_down_{source}"
            if source in self.sources and down:
                # name only the feeds that are really down, not the whole source group
                names = [FEED_LABELS[f] for f in down if f in FEED_LABELS]
                label = ", ".join(names) if names and len(names) < len(feeds) else SOURCE_LABELS[source]
                ir.async_create_issue(
                    self.hass,
                    DOMAIN,
                    issue_id,
                    is_fixable=False,
                    severity=ir.IssueSeverity.WARNING,
                    translation_key="source_down",
                    translation_placeholders={"source": label, "hours": str(SOURCE_DOWN_HOURS)},
                )
            else:
                ir.async_delete_issue(self.hass, DOMAIN, issue_id)

    # --------------------------------------------------------------- building

    async def async_rebuild(self) -> None:
        await self.hass.async_add_executor_job(self._rebuild)

    def _rebuild(self) -> None:
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        official: list[dict[str, Any]] = []
        if SOURCE_OFFICIAL in self.sources:
            for key in ("usgs", "imo", "jma"):
                official.extend(self.official.get(key) or [])
        if SOURCE_ITALY in self.sources:
            for key in ("dpc", "ingv"):
                official.extend(self.official.get(key) or [])
        sigmets = (
            [s for s in self.sigmets if not s.get("to") or s["to"] >= now_iso]
            if SOURCE_SIGMET in self.sources
            else []
        )
        result = build_volcanoes(
            self.catalog,
            self.levels if SOURCE_MAGMA in self.sources else [],
            self.vonas if SOURCE_MAGMA in self.sources else [],
            self.weekly if SOURCE_GVP_WEEKLY in self.sources else [],
            now,
            ASH_LIVE_HOURS,
            ERUPTION_HOURS,
            official,
            sigmets,
        )
        volcanoes = result["volcanoes"]
        for v in volcanoes:
            v["wind"] = wind_for(v, self.wind.get(v["id"]), now)
            v["wiki"] = choose_wiki(self.wiki.get(str(v["number"])) if v.get("number") else None, v["name"], v.get("local_name"))

        # earthquakes of the last 7 days, linked to the nearest volcano within 30 km
        # (Italy: INGV, small quakes only near a volcano; USGS copies of INGV quakes are dropped)
        quakes: list[dict[str, Any]] = []
        usgs_quakes = self.quakes if SOURCE_QUAKES in self.sources else []
        ingv_quakes = self.ingv_quakes if SOURCE_ITALY in self.sources else []
        if usgs_quakes or ingv_quakes:
            week = (now - timedelta(days=7)).isoformat()
            recent = [q for q in merge_quakes(usgs_quakes, ingv_quakes) if q["time"] >= week]
            points = [(v["lat"], v["lon"], v.get("local_name") or v["name"], v["id"]) for v in volcanoes if v["lat"] is not None]
            points += [(r[2], r[3], r[0], f"gvp:{r[5]}") for r in result["catalog"]]
            quakes = [q for q in mark_volcanic(recent, points) if keep_ingv_quake(q)]
            counts: dict[str, list[float]] = {}
            for q in quakes:
                if q.get("volcano_key"):
                    counts.setdefault(q["volcano_key"], []).append(q["mag"])
            for v in volcanoes:
                mags = counts.get(v["id"])
                v["quakes_7d"] = len(mags) if mags else 0
                v["quake_max"] = max(mags) if mags else None
        result["quakes"] = quakes

        # tsunami bulletins in force, with the distance from home
        tsunami: list[dict[str, Any]] = []
        if SOURCE_TSUNAMI in self.sources:
            home = (self.hass.config.latitude, self.hass.config.longitude)
            for ev in active_tsunami(self.tsunami, now):
                ev["home_km"] = round(haversine_km(home[0], home[1], ev["lat"], ev["lon"])) if home[0] is not None else None
                tsunami.append(ev)
        result["tsunami"] = tsunami

        # satellite hotspots at the summit (NASA FIRMS)
        oldest = (now - timedelta(hours=THERMAL_MAX_HOURS)).isoformat()
        for v in volcanoes:
            t = self.thermal.get(v["id"]) if self.firms_key else None
            v["thermal"] = t if t and t["time"] >= oldest else None

        # wildfire clusters of the last two days around home
        fire_oldest = (now - timedelta(hours=FIRE_HOURS)).isoformat()
        fires = [c for c in self.fires if c["time"] >= fire_oldest] if self._enabled("fires") else []
        result["fires"] = fires

        # official volcano cameras
        cam_keys = ("usgs", "jma", "magma", "ingv") if SOURCE_ITALY in self.sources else ("usgs", "jma", "magma")
        all_cams = [c for key in cam_keys for c in self.cams.get(key) or []] + geonet_cams()
        self.cam_map = link_cams(self.catalog, all_cams)
        for v in volcanoes:
            v["cams"] = self.cam_map.get(v["id"]) or []
        self.result = result
        self.updated = now.timestamp()
        catalog_rows = [
            [*r, choose_wiki(self.wiki.get(str(r[5])) if r[5] else None, r[0])]
            for r in result["catalog"]
        ]
        payload = {
            "version": VERSION,
            "updated": self.updated,
            "home": [self.hass.config.latitude, self.hass.config.longitude],
            "sources": self.source_status(),
            "weekly_published": self.weekly_published,
            "volcanoes": [_card_volcano(v) for v in volcanoes if v["lat"] is not None],
            "catalog": catalog_rows,
            "sigmets": result.get("sigmets") or [],
            "quakes": [
                [q["lat"], q["lon"], q["mag"], q["depth_km"], q["time"], q["place"], q["url"], q.get("volcano")]
                for q in quakes
            ],
            "cams": {
                key: [[c["src"], c["name"], c["img"], c["page"], c["time"]] for c in cams]
                for key, cams in self.cam_map.items()
            },
            "tsunami": [
                {k: ev.get(k) for k in ("level", "category", "bulletin", "region", "lat", "lon", "mag", "time", "url", "sources", "home_km")}
                for ev in tsunami
            ],
            "thermal_enabled": bool(self.firms_key),
            "fires_enabled": self._enabled("fires"),
            "fires_meta": self.fires_meta if self._enabled("fires") else None,
            # lat, lon, detections, total MW, strongest MW, newest pass, first pass, km from home, bearing, cell size
            "fires": [
                [c["lat"], c["lon"], c["count"], c["frp_mw"], c["max_mw"], c["time"], c["first"], c["km"], c["bearing"], c["cell_deg"]]
                for c in fires
            ],
        }
        raw = json.dumps(payload, separators=(",", ":")).encode()
        self.payload_json = raw
        self.payload_gzip = gzip.compress(raw, 6)
        self._rebuild_history(now)

    def _rebuild_history(self, now: datetime) -> None:
        if SOURCE_MAGMA not in self.sources:
            events: list[dict[str, Any]] = []
        else:
            key = f"{len(self.vonas)}|{self.vonas[0]['issued'] if self.vonas else ''}|{len(self.catalog)}|{now.date()}"
            if key == self._history_key and self.history_json is not None:
                return
            self._history_key = key
            events = build_history(self.catalog, self.vonas, now, HISTORY_DAYS)
        raw = json.dumps({"days": HISTORY_DAYS, "events": events}, separators=(",", ":")).encode()
        self.history_json = raw
        self.history_gzip = gzip.compress(raw, 6)

    def source_status(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for feed, (source, _minutes) in FEEDS.items():
            st = self.feed_state.get(feed) or {}
            enabled = source is None or source in self.sources
            last_ok = st.get("last_ok")
            out[feed] = {
                "enabled": enabled,
                "ok": bool(last_ok) and not st.get("error"),
                "last_ok": datetime.fromtimestamp(last_ok, tz=timezone.utc).isoformat() if last_ok else None,
                "error": st.get("error"),
            }
        return out

    # --------------------------------------------------------------- earth

    def _scan_earth(self) -> None:
        month = dt_util.now().month
        self.earth_day_file = None
        self.earth_night_file = None
        for folder in (self.earth_dir, self.orbitarium_dir):
            if not folder.is_dir():
                continue
            night = folder / "earth_night.jpg"
            if self.earth_night_file is None and night.is_file():
                self.earth_night_file = night
            current = folder / f"earth_day_{month:02d}.jpg"
            if self.earth_day_file is None and current.is_file():
                self.earth_day_file = current
        if self.earth_day_file is None:
            for folder in (self.earth_dir, self.orbitarium_dir):
                files = sorted(folder.glob("earth_day_*.jpg")) if folder.is_dir() else []
                if files:
                    self.earth_day_file = files[-1]
                    break

    def earth_path(self, kind: str) -> Path | None:
        if kind == "day":
            return self.earth_day_file
        if kind == "night":
            return self.earth_night_file
        return None

    def earth_status(self) -> str:
        day = self.earth_day_file
        night = self.earth_night_file
        if day and night:
            return "ready"
        if day or night:
            return "partial"
        return "missing"

    async def async_ensure_earth(self) -> None:
        """Download the NASA day and night images once (Orbitarium's copies are used when present)."""
        if time.time() < self._earth_retry or self._earth_lock.locked():
            return
        async with self._earth_lock:
            await self.hass.async_add_executor_job(self._scan_earth)
            month = dt_util.now().month
            have_day = self.earth_day_file is not None and self.earth_day_file.name == f"earth_day_{month:02d}.jpg"
            have_night = self.earth_night_file is not None
            if have_day and have_night:
                return
            await self.hass.async_add_executor_job(lambda: self.earth_dir.mkdir(parents=True, exist_ok=True))
            session = async_get_clientsession(self.hass)
            ok = True
            if not have_day:
                image = None
                for m in (month, EARTH_DAY_FALLBACK_MONTH):
                    image = await self._fetch_image(session, EARTH_DAY_URL.format(month_name=MONTH_NAMES[m - 1], month=m))
                    if image:
                        break
                if image:
                    await self.hass.async_add_executor_job(self._store_day_image, month, image)
                else:
                    ok = False
            if not have_night:
                image = await self._fetch_image(session, EARTH_NIGHT_URL)
                if image:
                    await self.hass.async_add_executor_job((self.earth_dir / "earth_night.jpg").write_bytes, image)
                else:
                    ok = False
            await self.hass.async_add_executor_job(self._scan_earth)
            if not ok:
                self._earth_retry = time.time() + 6 * 3600

    def _store_day_image(self, month: int, image: bytes) -> None:
        path = self.earth_dir / f"earth_day_{month:02d}.jpg"
        path.write_bytes(image)
        for old in self.earth_dir.glob("earth_day_*.jpg"):
            if old != path:
                old.unlink(missing_ok=True)

    async def _fetch_image(self, session: aiohttp.ClientSession, url: str) -> bytes | None:
        try:
            async with session.get(url, timeout=IMAGE_TIMEOUT, headers={"User-Agent": USER_AGENT}) as resp:
                if resp.status != 200:
                    return None
                body = await resp.read()
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            _LOGGER.warning("Could not download Earth image %s: %s", url, err)
            return None
        if len(body) < 50_000 or not body.startswith(b"\xff\xd8"):
            return None
        return body


def _card_volcano(v: dict[str, Any]) -> dict[str, Any]:
    """Trim a volcano for the card payload."""
    out = {
        "id": v["id"],
        "name": v["name"],
        "local": v.get("local_name"),
        "country": v["country"],
        "lat": v["lat"],
        "lon": v["lon"],
        "elev": v.get("elevation"),
        "level": v["level"],
        "alert": v.get("alert"),
        "province": v.get("province"),
        "color": v.get("aviation_color"),
        "erupting": v["erupting"],
        "eruption": v.get("eruption"),
        "ash": v.get("ash"),
        "notice": v.get("notice"),
        "weekly": v.get("weekly"),
        "report": v.get("report_url"),
        "number": v.get("number"),
        "sources": v.get("sources"),
        "wind": v.get("wind"),
        "official": v.get("official"),
        "officials": v.get("officials") or [],
        "sigmets": v.get("sigmets") or [],
        "quakes_7d": v.get("quakes_7d") or 0,
        "quake_max": v.get("quake_max"),
        "wiki": v.get("wiki"),
        "thermal": v.get("thermal"),
    }
    return out


def utc_iso(ts: float | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
