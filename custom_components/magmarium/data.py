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

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    ASH_LIVE_HOURS,
    BACKOFF_MINUTES,
    CATALOG_DAYS,
    DOMAIN,
    EARTH_DAY_FALLBACK_MONTH,
    EARTH_DAY_URL,
    EARTH_DIR,
    EARTH_NIGHT_URL,
    ERUPTION_HOURS,
    GVP_CATALOG_URL,
    GVP_CATALOG_URL_FULL,
    GVP_WEEKLY_MINUTES,
    GVP_WEEKLY_URL,
    MAGMA_LEVEL_MINUTES,
    MAGMA_LEVEL_URL,
    MAGMA_VONA_MINUTES,
    MAGMA_VONA_URL,
    ORBITARIUM_EARTH_DIR,
    SOURCE_DOWN_HOURS,
    SOURCE_GVP_WEEKLY,
    SOURCE_LABELS,
    SOURCE_MAGMA,
    STORAGE_KEY,
    STORAGE_VERSION,
    VERSION,
    VONA_MAX_AGE_DAYS,
)
from .model import build_volcanoes
from .parsing import parse_gvp_catalog, parse_gvp_weekly, parse_level_page, parse_vona_list

_LOGGER = logging.getLogger(__name__)

USER_AGENT = f"HomeAssistant-Magmarium/{VERSION} (+https://github.com/mb26-dev/ha-magmarium)"
HTTP_TIMEOUT = aiohttp.ClientTimeout(total=60)
IMAGE_TIMEOUT = aiohttp.ClientTimeout(total=180)
MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]
VONA_MAX_PAGES_FIRST = 3
VONA_KEEP = 600

# feed key -> (source that enables it, refresh minutes)
FEEDS = {
    "magma_levels": (SOURCE_MAGMA, MAGMA_LEVEL_MINUTES),
    "magma_vona": (SOURCE_MAGMA, MAGMA_VONA_MINUTES),
    "gvp_weekly": (SOURCE_GVP_WEEKLY, GVP_WEEKLY_MINUTES),
    "catalog": (None, CATALOG_DAYS * 24 * 60),
}


class FeedError(Exception):
    """A download or parse problem of one feed."""


class MagmariumData:
    """Downloads, caches and merges all volcano sources."""

    def __init__(self, hass: HomeAssistant, sources: list[str]) -> None:
        self.hass = hass
        self.sources = list(sources)
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._lock = asyncio.Lock()
        self.catalog: list[list[Any]] = []
        self.levels: list[dict[str, Any]] = []
        self.vonas: list[dict[str, Any]] = []
        self.weekly: list[dict[str, Any]] = []
        self.weekly_published: str | None = None
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
            self.weekly = stored.get("weekly") or []
            self.weekly_published = stored.get("weekly_published")
            self.feed_state = stored.get("feeds") or {}
        await self.async_rebuild()

    async def _async_save(self) -> None:
        await self._store.async_save({
            "catalog": self.catalog,
            "levels": self.levels,
            "vonas": self.vonas,
            "weekly": self.weekly,
            "weekly_published": self.weekly_published,
            "feeds": self.feed_state,
        })

    # --------------------------------------------------------------- feeds

    def _enabled(self, feed: str) -> bool:
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

    def _fail(self, feed: str, now: float, err: str) -> None:
        st = self.feed_state.setdefault(feed, {})
        st["last_attempt"] = now
        st["error"] = err[:300]
        st["retry_after"] = now + BACKOFF_MINUTES * 60
        if not st.get("failing_since"):
            st["failing_since"] = now
        _LOGGER.warning("Magmarium feed %s failed, next attempt in %s minutes: %s", feed, BACKOFF_MINUTES, err)

    async def _get(self, url: str, binary: bool = False) -> Any:
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(
                url,
                timeout=HTTP_TIMEOUT,
                headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
            ) as resp:
                if resp.status != 200:
                    raise FeedError(f"HTTP {resp.status}")
                return await (resp.read() if binary else resp.text())
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise FeedError(str(err) or err.__class__.__name__) from err

    async def async_refresh(self, force: bool = False) -> bool:
        """Download every feed that is due. Returns True when anything changed."""
        async with self._lock:
            now = time.time()
            changed = False
            for feed in ("catalog", "magma_levels", "magma_vona", "gvp_weekly"):
                if not self._enabled(feed):
                    continue
                if not force and not self._due(feed, now):
                    continue
                try:
                    if feed == "catalog":
                        await self._refresh_catalog()
                    elif feed == "magma_levels":
                        await self._refresh_levels()
                    elif feed == "magma_vona":
                        await self._refresh_vona()
                    else:
                        await self._refresh_weekly()
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
                await self._async_save()
            await self.async_rebuild()
            return changed

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
        if found:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=VONA_MAX_AGE_DAYS)).isoformat()
            merged = [v for v in self.vonas + found if v["issued"] >= cutoff]
            merged.sort(key=lambda v: v["issued"], reverse=True)
            self.vonas = merged[:VONA_KEEP]
            _LOGGER.debug("%s new VONA notices", len(found))

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
        for source in (SOURCE_MAGMA, SOURCE_GVP_WEEKLY):
            feeds = [f for f, (s, _) in FEEDS.items() if s == source]
            since = [
                float((self.feed_state.get(f) or {}).get("failing_since") or 0)
                for f in feeds
            ]
            failing = [s for s in since if s]
            issue_id = f"source_down_{source}"
            if source in self.sources and failing and now - min(failing) >= SOURCE_DOWN_HOURS * 3600:
                ir.async_create_issue(
                    self.hass,
                    DOMAIN,
                    issue_id,
                    is_fixable=False,
                    severity=ir.IssueSeverity.WARNING,
                    translation_key="source_down",
                    translation_placeholders={"source": SOURCE_LABELS[source], "hours": str(SOURCE_DOWN_HOURS)},
                )
            else:
                ir.async_delete_issue(self.hass, DOMAIN, issue_id)

    # --------------------------------------------------------------- building

    async def async_rebuild(self) -> None:
        await self.hass.async_add_executor_job(self._rebuild)

    def _rebuild(self) -> None:
        now = datetime.now(timezone.utc)
        result = build_volcanoes(
            self.catalog,
            self.levels if SOURCE_MAGMA in self.sources else [],
            self.vonas if SOURCE_MAGMA in self.sources else [],
            self.weekly if SOURCE_GVP_WEEKLY in self.sources else [],
            now,
            ASH_LIVE_HOURS,
            ERUPTION_HOURS,
        )
        self.result = result
        self.updated = now.timestamp()
        payload = {
            "version": VERSION,
            "updated": self.updated,
            "home": [self.hass.config.latitude, self.hass.config.longitude],
            "sources": self.source_status(),
            "weekly_published": self.weekly_published,
            "volcanoes": [_card_volcano(v) for v in result["volcanoes"] if v["lat"] is not None],
            "catalog": result["catalog"],
        }
        raw = json.dumps(payload, separators=(",", ":")).encode()
        self.payload_json = raw
        self.payload_gzip = gzip.compress(raw, 6)

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
    }
    return out


def utc_iso(ts: float | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
