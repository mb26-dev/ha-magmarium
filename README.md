<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="custom_components/magmarium/brand/dark_logo@2x.png">
    <source media="(prefers-color-scheme: light)" srcset="custom_components/magmarium/brand/logo@2x.png">
    <img src="custom_components/magmarium/brand/dark_logo@2x.png" alt="Magmarium" width="420">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/hacs/integration"><img src="https://img.shields.io/badge/HACS-Custom-41BDF5.svg" alt="HACS Custom"></a>
  <img src="https://img.shields.io/github/v/release/mb26-dev/ha-magmarium?include_prereleases" alt="Release">
  <img src="https://img.shields.io/badge/Home%20Assistant-2025.1%2B-blue" alt="Home Assistant">
  <img src="https://img.shields.io/github/license/mb26-dev/ha-magmarium" alt="License">
  <a href="https://ko-fi.com/mb26dev"><img src="https://img.shields.io/badge/Ko--fi-Buy%20me%20a%20coffee-FF5E5B?logo=ko-fi&logoColor=white" alt="Buy me a coffee on Ko-fi"></a>
</p>

# Magmarium

Active volcanoes on a living globe for Home Assistant. Magmarium shows **every volcano with a current report** on a 3D Earth: coloured by its official alert level, glowing while it erupts, and with **ash plumes that rise and drift exactly as the latest official notice describes**, only while an ash cloud is actually reported.

It starts with the best volcano data there is for Indonesia, the official alert levels and VONA aviation notices from **MAGMA Indonesia**, and adds the whole world from the **Smithsonian / USGS Weekly Volcanic Activity Report**. No API key, no account.

> **Beta.** Magmarium 0.1 is the first public test version. Feedback and bug reports are very welcome.

## Features

**Lovelace card** `custom:magmarium-card` (installed and registered automatically)

- Globe with real NASA imagery: Blue Marble by day, city lights by night, live day and night terminator
- Every volcano with a current report drawn as a small 3D cone, ringed in the colour of its alert level (Normal, Advisory, Watch, Warning)
- **Eruptions:** glowing crater, lava running down the flanks and glowing ejecta, stronger on the night side
- **Ash clouds from VONA:** the plume rises to the reported height above the summit, drifts in the reported direction, takes the reported colour (white, grey, black) and density (thin, medium, thick) and fades out within 4 hours. A newer notice without ash makes the old cloud fade faster.
- Ash plumes from the weekly report are drawn lighter, as "reported this week"
- Warning level volcanoes pulse
- All ~1,200 known Holocene volcanoes as small background cones (switchable)
- Tap a volcano for its alert level, aviation colour code, eruption time, ash cloud height and drift, the full notice text and links to the official reports
- Filter chips: all, erupting, ash clouds, elevated
- **Region buttons:** one tap turns the globe to Indonesia, Japan, Iceland, the Andes and twelve more volcanic regions, each with its number of active volcanoes
- Drag to turn, mouse wheel or pinch to zoom, double tap to zoom in, optional slow rotation
- Works on phones and wall tablets, pauses itself when it is not on screen

**Sensors**

| Sensor | State | Attributes |
| --- | --- | --- |
| Elevated volcanoes | volcanoes above normal level | count per level, list of volcanoes |
| Erupting volcanoes | volcanoes with a reported eruption (VONA in the last 24 h, or the current weekly report) | list, which ones are live from VONA |
| Ash clouds | ash clouds reported by VONA in the last 4 hours | height, drift direction, intensity per cloud |
| Nearest active volcano | name of the nearest volcano with elevated activity | distance from home, level, eruption, ash cloud |
| Latest VONA | time of the newest VONA (timestamp) | volcano, aviation colour, notice text, ash height, link |
| `<volcano>` | alert level of a watched volcano: normal, advisory, watch, warning | official alert (e.g. *Level III (Siaga)*), aviation colour, eruption, ash cloud, notice, distance |
| Data sources (diagnostic) | ok, degraded or waiting | status of every feed, cache sizes, Earth imagery |

If a source has not answered for 24 hours, Home Assistant shows a repair notice. The last known data stays on the globe, and the notice disappears by itself when the source answers again.

The integration is translated into English and German.

## Installation

### HACS (custom repository)

1. HACS → three dots → **Custom repositories** → add `https://github.com/mb26-dev/ha-magmarium` as **Integration**, or use this button:

   [![Open your Home Assistant instance and open Magmarium in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=mb26-dev&repository=ha-magmarium&category=integration)

2. Download **Magmarium** (switch on *Show beta versions* for the 0.1 beta) and restart Home Assistant
3. **Settings → Devices & services → Add integration → Magmarium**, or use this button:

   [![Open your Home Assistant instance and start setting up Magmarium.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=magmarium)

### Manual

Copy `custom_components/magmarium` into your `config/custom_components` folder and restart Home Assistant.

## Configuration

All settings are done in the UI and can be changed later under **Configure**:

| Option | Default | Description |
| --- | --- | --- |
| Data sources | MAGMA Indonesia, Weekly report | MAGMA Indonesia: official alert levels and VONA notices for all Indonesian volcanoes. Weekly report: worldwide activity from the Smithsonian Global Volcanism Program and USGS. |
| Volcanoes to watch | empty | Comma separated names, e.g. `Semeru, Merapi, Anak Krakatau, Lewotobi`. Each one gets its own sensor. |

Update intervals: VONA notices every 10 minutes, MAGMA alert levels every hour, the weekly report every 6 hours, the volcano catalogue once a month. Every source has its own cache and backoff, so a source that is down never blocks the others, and restarts do not download anything again. The NASA Earth images (about 3 MB) are downloaded once; if [Orbitarium](https://github.com/mb26-dev/ha-orbitarium) is installed, its images are used and nothing is downloaded.

## The card

```yaml
type: custom:magmarium-card
```

All options are optional:

```yaml
type: custom:magmarium-card
title: Magmarium
height: 460            # height in px
center: home           # home, world, ring_of_fire, a region key (see below) or [lat, lon]
zoom: 2.4              # 1 shows the whole globe
regions: true          # region buttons; false hides them, a list picks and orders them
rotate: false          # slow rotation when nobody touches the card
show_all: true         # all known volcanoes as small background cones
weekly_ash: true       # light ash plumes for ash reported in the weekly report
labels: true
```

### Region buttons

A second row of buttons flies the globe to a volcanic region. Each button shows how many volcanoes there are currently active, with a dot in the colour of the highest alert level; quiet regions are dimmed. Once a region is zoomed in, the quiet volcanoes are labelled too.

| Key | Region |
|---|---|
| `indonesia` | Indonesia |
| `philippines` | Philippines |
| `japan` | Japan |
| `kamchatka` | Kamchatka & Kurils |
| `alaska` | Alaska & Aleutians |
| `cascades` | Cascades |
| `hawaii` | Hawaii |
| `central_america` | Mexico & Central America |
| `caribbean` | Caribbean |
| `andes` | Andes |
| `iceland` | Iceland |
| `atlantic` | Azores & Canaries |
| `mediterranean` | Italy & Mediterranean |
| `east_africa` | East Africa |
| `melanesia` | PNG & Vanuatu |
| `new_zealand` | New Zealand & Tonga |

Only some of them, in your order:

```yaml
type: custom:magmarium-card
center: indonesia
regions: [indonesia, philippines, japan, iceland, mediterranean]
```

## Alert notifications (blueprint)

[![Open your Home Assistant instance and show the blueprint import dialog with a specific blueprint pre-filled.](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fmb26-dev%2Fha-magmarium%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmagmarium%2Falert_level_change.yaml)

Pick a watched volcano and what should happen. The actions get the variables `volcano`, `level`, `previous`, `alert`, `ash_top_m`, `ash_moving_to`, `text` and `url`, for example:

```yaml
- action: notify.notify
  data:
    title: "{{ volcano }}: {{ level }}"
    message: "{{ alert }}. {{ text }}"
```

## How it reads the reports

| Shown on the globe | Comes from |
| --- | --- |
| Colour of the ring | Indonesia: official MAGMA alert level (Level I Normal, II Waspada, III Siaga, IV Awas). Elsewhere: the weekly report (new eruptive activity = Watch, unrest or ongoing activity = Advisory). |
| Glowing crater and lava | a VONA in the last 24 hours that reports an eruption, or eruptive activity in the current weekly report |
| Ash plume | a VONA in the last 4 hours with an ash cloud: height above the summit, drift direction, ash colour and intensity are taken from the notice. Exercise notices (*VA EXERCISE*) are ignored. |
| Light ash plume | ash plumes mentioned in the current weekly report |

Ash clouds and eruptions on the globe are illustrations of the official reports, not measurements or forecasts. For aviation or safety decisions always use the official sources.

## Support

If Magmarium makes your dashboard erupt, a coffee keeps the lava flowing. ☕🌋

<a href="https://ko-fi.com/mb26dev"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi"></a>

A star on GitHub, a bug report or a screenshot of your dashboard helps just as much. Thank you!

## Credits

- Volcano alert levels and VONA notices for Indonesia: [MAGMA Indonesia](https://magma.esdm.go.id), PVMBG / CVGHM, Geological Agency of Indonesia
- Weekly Volcanic Activity Report and Volcanoes of the World: [Smithsonian Institution Global Volcanism Program](https://volcano.si.edu) and [USGS](https://www.usgs.gov/programs/VHP)
- Earth imagery: NASA Earth Observatory, [Blue Marble Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/) by Reto Stöckli and [Black Marble 2016](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps)
- Volcano, lava and ash drawings are original artwork rendered in the card

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.
