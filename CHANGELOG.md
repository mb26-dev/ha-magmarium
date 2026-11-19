# Changelog

## 0.2.0b7 - 2026-11-19

- A DNS lookup that times out is tried again (twice, after a short pause) before a feed counts as failed. Name servers far away, for example the Icelandic Met Office seen from Asia, often answer only after the first lookup gave up
- The "not reachable" repair now names only the feeds that are really down (for example "Icelandic Met Office") instead of every source of the group

## 0.2.0b6 - 2026-11-18

- New earthquakes arrive within 2 minutes: besides the full update every 15 minutes, Magmarium checks the small USGS feed of the day every 2 minutes, so sensors and automations react right away
- The lightning card moved to [Sea State Forecast](https://github.com/mb26-dev/ha-sea-state) as `custom:sea-state-lightning-card`: lightning is weather, Magmarium stays with what comes from the earth. If you used `magmarium-lightning-card`, install Sea State Forecast 0.1.0b9 and change the card type, the options stay the same
- Fixed: the seismic waves of quakes in the western hemisphere could flicker
- README: screenshot of the earthquake card, rendered from the real USGS quakes of the week

## 0.2.0b5 - 2026-11-18

- **New earthquake card** `custom:magmarium-quake-card`: the earthquakes around home on the zoomable NASA map, coloured and sized by magnitude, seismic waves for the last 24 hours, an animated quake marker on the strongest, tsunami bulletins with waves and a banner, tiles and a list with distance, direction and depth
- **New lightning card** `custom:magmarium-lightning-card`: the strikes of the Blitzortung integration as a live radar around home with range rings, a sweep, flashing fresh strikes, the lightning marker on the newest and the storm trend
- New sensor **Earthquakes near home**: quakes within 2000 km in the last 7 days, with the last 24 hours, the strongest and the nearest
- The three map cards share one map engine (`magmarium-maps.js`), the wildfire card works as before
- New earthquake and lightning icons by mb26-dev

## 0.2.0b4 - 2026-11-18

- Satellite hotspots and wildfires also come from **VIIRS NOAA-21**. S-NPP currently delivers no data, so before this only NOAA-20 was used
- The wildfire card lists the satellites that saw the fires
- Air quality tile: PM2.5 sensors without a unit are read as µg/m³ and get their rating (good, moderate, unhealthy)
- README: screenshots of the wildfires on the globe and of the wildfire card, rendered with the real fires of the last 24 hours

## 0.2.0b3 - 2026-11-18

- **Wildfires** (with the NASA FIRMS key): VIIRS fire detections of the last 48 hours within a radius around home (new setting, default 1500 km, checked every hour), grouped into fires: 5 km cells within 400 km of home, 50 km cells further away. Hotspots at volcanoes are left out. Both satellites see the same fire about an hour apart, so per fire the pass with more power counts, not the sum
- New sensor "Wildfires": fires of the last 24 hours with nearest distance and direction, strongest fire, fires within 25 / 100 / 300 km and the 25 nearest fires
- Wildfires on the globe as glowing embers in the colour of their power, the strongest with an animated flame marker; tap for the details. New card option `fires`
- **New wildfire card** `custom:magmarium-fire-card`: zoomable and draggable map (NASA Blue Marble relief or today's VIIRS satellite image), your own places as tiles, an optional air quality tile, the nearest fires and a link to the NASA FIRMS map

## 0.2.0b2 - 2026-11-18

- Tsunami events get their own animated marker on the globe (a breaking wave on a ground ring in the colour of the alert) and in the banner of the compact card

## 0.2.0b1 - 2026-11-18

- **Tsunami warnings:** official bulletins of NOAA (PTWC, NTWC) and BMKG InaTEWS, merged per event. On the globe they roll out as waves from the epicentre in the colour of the alert (warning / threat red, watch orange, advisory yellow, information blue), with a label and an info panel with the bulletin. Warnings stay 12 hours after the last bulletin, information statements 3 hours; cancellations remove them. New sensor "Tsunami alerts", new card option `tsunami`, a banner in the compact card (`tsunami: false` hides it). Switched on for existing installations
- **Satellite hotspots (optional):** with a free NASA FIRMS map key (new setting), VIIRS thermal anomalies within 5 km of the summit of every volcano with a raised alert level, an eruption or ash are checked every 3 hours. They glow on the globe, show in the info panel, the compact card (tile and chip) and the volcano sensors, and get their own sensor "Thermal anomalies". New card option `thermal`
- **New blueprint "Eruption or tsunami near you":** notifies on a new VONA eruption within your radius and on new tsunami bulletins near you from the level you choose
- The "Erupting volcanoes" sensor lists the distance from home of every volcano

## 0.1.6 - 2026-11-18

- Volcano list with `details: true`: long reports (weekly report) are shortened to 3 lines with a "Show more" / "Show less" link that opens the full text right in the card; tapping it never opens the globe
- New option `text_lines` (visual editor: "Lines of long reports"): how many lines a long report shows before "Show more", `0` always shows the full text; VONA notices are always shown in full

## 0.1.5 - 2026-11-18

- Older VONA notices are now loaded too: after the start, a few older pages are read per refresh until the last 120 days are covered, and the newest notice of every volcano is always kept. Volcanoes whose last VONA is weeks old (e.g. an eruption with an ash cloud in August) show it again instead of only the weekly report
- Volcano list with `details: true`: the last reported eruption and ash cloud (height above sea level and above the summit, drift direction, age) also when the notice is older than the live window; "No ash cloud observed" when the newest notice saw none
- VONA texts and times in the list are shown in the time zone of Home Assistant (e.g. "Eruption at 12:09 Bangkok time"), with the date of the notice; VONA texts are shown in full

## 0.1.4 - 2026-11-18

- Volcano list: new option `sort: distance` shows the nearest volcanoes with a raised alert level, an eruption or ash first (or sorts your own `volcanoes` by distance); the distance is measured from your Home Assistant home location
- Volcano list: new option `details: true` adds to every row the eruption time, the ash cloud with height and drift, ash SIGMETs, earthquakes and the latest VONA or report text
- The list rows also show the VONA aviation colour code

## 0.1.3 - 2026-11-18

- New compact card `custom:magmarium-volcano-card` for the home dashboard: one volcano with the animated cone, ash plume, ejecta and a day or night sky, alert level, eruption, ash cloud, wind, earthquakes, SIGMETs, live camera and the latest report; or the most active volcanoes as a list with small animated cones; everything can be switched on and off in the visual editor
- Optional `navigation_path` opens your globe dashboard when the card is tapped

## 0.1.2 - 2026-11-18

- Fixed: on dashboards with hass-swipe-navigation, dragging the globe with a finger switched to another view instead of turning the globe

## 0.1.1 - 2026-11-18

- New daylight mode: the whole visible globe is lit evenly, so no region lies in the dark. It is on by default; the new sun / moon button switches between daylight and the real day and night with city lights and glowing craters. The browser remembers the last choice, the card option "Daylight" sets the default

## 0.1.0 - 2026-11-18

First stable release. Everything from the betas, tested in daily use:

- Globe with NASA day and night imagery, animated volcanoes in the colour of their official alert level, glowing craters, lava and ash plumes that follow the reported height and direction
- Official alert levels: MAGMA Indonesia, USGS, Icelandic Met Office, Japan Meteorological Agency; the Smithsonian / USGS weekly report for the rest of the world
- Official volcanic ash areas (SIGMETs) with their forecast position, earthquakes near volcanoes, ash drift simulation from forecast winds
- "Ash near <place>" binary sensors for your zones, blueprints for alert changes and ash near a place
- 90-day replay, region buttons, fullscreen, visual card editor
- Official live cameras (USGS, GeoNet) and camera links (JMA, MAGMA Indonesia), Wikipedia link for every volcano
- Fixed in this release: the camera links of the Japan Meteorological Agency were not found (the page uses single quotes in its links); a camera list that cannot be loaded is now logged as a warning

## 0.1.0b9 - 2026-11-17

- Wikipedia links of volcanoes with accents or special characters in the article title work again (e.g. Volcán de Fuego, Bárðarbunga, Eyjafjallajökull): the title was encoded twice
- Checked: all 1,422 linked article titles exist on Wikipedia and open correctly

## 0.1.0b8 - 2026-11-17

- Ash SIGMETs are no longer counted twice: the forecast position that a SIGMET carries for the end of its validity is now part of that SIGMET instead of a second one
- The forecast position is drawn as a faint dotted area next to the observed ash area
- "Ash near <place>" also turns on when the official forecast position comes within the radius (attribute `forecast` in the threat)

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
