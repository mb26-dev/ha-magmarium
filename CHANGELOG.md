# Changelog

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
