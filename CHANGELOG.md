# Changelog

## 0.1.0b7 - 2026-11-17

- Notice texts are easier to read: times like "1218 UTC (1918 local)" are shown as "12:18 UTC (19:18 local)"
- Sentences that a notice repeats (e.g. "Ash-cloud is not observed.") are shown only once

## 0.1.0b6 - 2026-11-17

- Live cameras: tap a volcano and its newest official camera image is shown in the info panel, a tap opens the camera page
- Sources, all official observatories only: USGS AshCam (all US volcano cameras, Alaska, Cascades, Hawaii), GeoNet New Zealand (Ruapehu, Tongariro, Taranaki, Whakaari, Raoul Island), Japan Meteorological Agency (links to the monitoring cameras of every observed volcano), MAGMA Indonesia (links to the CCTV pages, e.g. Semeru, Bromo, Ijen, Anak Krakatau, Sinabung)
- Cameras also for quiet volcanoes from the catalogue
- Watched volcano sensors get `camera_image` and `cameras`
- New card option `cams`

## 0.1.0b5 - 2026-11-17

- New logo and icon: the volcano emblem in its glowing ring with the Magmarium wordmark, in the integration list, the store and the README
- The brand images are rendered from the artwork in `brand_src/magmarium_logo.jpg`

## 0.1.0b4 - 2026-11-17

- Official alert levels outside Indonesia: USGS (all US volcanoes), Icelandic Met Office (aviation colour code), Japan Meteorological Agency (volcanic alert levels); they replace the estimate from the weekly report
- Official volcanic ash areas for aviation: ash SIGMETs from AviationWeather.gov, drawn as polygons with height and validity; the named volcano gets an ash plume moving in the SIGMET direction
- Earthquakes of the last 7 days from the USGS as rings, linked to volcanoes within 30 km
- New binary sensors "Ash near <place>" for chosen zones (home, airports) with a radius; on for a SIGMET area, an ash plume or a simulated drift track; new blueprint "volcanic ash near a place"
- New sensors: Ash SIGMETs, Earthquakes near volcanoes; watched volcano sensors get the official alert, earthquake count and Wikipedia link
- Replay: the eruptions and ash clouds of the last 90 days (VONA) play on the globe, with play, pause and a time slider
- Wikipedia link for every volcano, matched through Wikidata by the Smithsonian volcano number
- Visual card editor and card preview in the card picker
- New card options `ash_areas`, `quakes`, `replay`
- Existing setups switch the new sources on automatically

## 0.1.0b3 - 2026-11-17

- Ash drift simulation: hourly forecast winds from Open-Meteo at the height of each ash cloud (850 to 250 hPa), fetched only for volcanoes with an ash cloud or an eruption
- Plumes without a reported direction, including all weekly report plumes, now drift with the forecast wind
- Dashed, animated 6 hour drift track for every plume and for a selected erupting volcano, with the wind at plume height in the info panel
- New card option `wind_tracks`
- Fullscreen button; where the browser has no fullscreen (iOS, some app views) the card fills the window, Escape closes it

## 0.1.0b2 - 2026-11-17

- Region buttons in the card: one tap turns the globe to Indonesia, the Philippines, Japan, Kamchatka, Alaska, the Cascades, Hawaii, Central America, the Caribbean, the Andes, Iceland, the Azores and Canaries, the Mediterranean, East Africa, PNG and Vanuatu or New Zealand and Tonga
- Each region button shows its number of active volcanoes and the colour of its highest alert level
- New option `regions`: `false` hides the buttons, a list picks and orders them; every region key also works as `center`
- Quiet volcanoes grow with the zoom and get muted name labels in a zoomed-in region
- Chip rows scroll with the mouse wheel and by dragging on desktop

## 0.1.0b1 - 2026-11-17

First beta.

- Integration `magmarium` with UI setup: data sources and watched volcanoes
- MAGMA Indonesia: official alert levels (Level I-IV) and VONA aviation notices with ash cloud height, drift direction, colour and intensity
- Smithsonian / USGS Weekly Volcanic Activity Report for the rest of the world
- Volcano catalogue of the Global Volcanism Program (all Holocene volcanoes)
- Sensors: elevated volcanoes, erupting volcanoes, ash clouds, nearest active volcano, latest VONA, data sources, one sensor per watched volcano
- Repair notice when a source has not answered for 24 hours
- Card `custom:magmarium-card`: globe with NASA day and night imagery, animated volcanoes in the colour of their alert level, glowing craters and lava while erupting, ash plumes that rise and drift with the reported height and direction only while an ash cloud is actually reported
- Blueprint: notification when the alert level of a watched volcano changes or an ash cloud is reported
