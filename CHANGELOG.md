# Changelog

## 2.2.0

- Map shows which way you're facing: a blue beam on your location dot (like Google Maps), from the
  phone's compass while the Map tab is open, or the GPS direction of travel when moving fast.
  Fixed: newer Chrome/WebView versions need a sensor permission request, which blocked the compass.
- The centre crosshair only shows after you drag the map.

## 2.1.0

- 🏔️ Uttarakhand city packs: Rishikesh, Haridwar, Mussoorie, Nainital, Almora, Joshimath & Auli,
  Badrinath, Kedarnath trek and Dehradun. One tap saves places, roads and the map plus ~11,000
  extra shops, hotels, ATMs, chemists and more from Overture Maps (open data), with duplicates
  of OpenStreetMap places removed. Dehradun and Kedarnath (bigger than 5 km) are Pro.
- Town search suggests the city pack when there is one.
- Unnamed ATMs, chemists and petrol pumps are named from their brand/operator.
- Each place shows where its data comes from.
- Packs are rebuilt monthly from the newest Overture release (GitHub Actions "City packs").

## 2.0.1

- "Pan & Tobacco" is now "Paan & Kiosks"; OSM "tobacco" shops show as "paan shop".
  E-cigarette shops are no longer listed (banned in India).
- More compact route sheet, so more of the map and route stay visible.
- Play Store assets: feature graphic, icon, 6 screenshots and listing text in store/.

## 2.0.0

New look, from the Google Stitch design: a Gen-Z "zine sticker-book" style.
- Warm paper background, thick ink outlines, hard offset shadows, buttons that press in,
  sticker chips and badges; Space Grotesk + Plus Jakarta Sans fonts bundled for offline use.
- Nearby: "no signal? no stress" hero, "found N spots" line, compass heading card,
  sticker place cards with a Navigate button, big lime "Offline route" button, pack summary card,
  "point phone toward…" ticker.
- Map: name-label pins when zoomed in, ink-outlined blue route with white dashes, compact
  route sheet with Walk/Drive times, step count, first-turn hint and Start navigation (map follows you).
- Saved tab: radius tiles, download progress bar, "100% ready" pack cards, storage sticker.
- New "drop a secret pin" sheet with category stickers, Pro sheet with price sticker, offline
  card, empty state and a 3-step first-run onboarding. Night version for dark mode.

## 1.5.0

- Offline map at every zoom level: saving an area now downloads its whole street map (zoom 0–14;
  closer zooms reuse 14), so zooming in offline no longer shows white squares. Areas saved
  earlier get their map automatically when online. Deleting an area removes its map data.
- Missing map squares outside saved areas keep showing the less detailed map instead of white.
- Driving routes now prefer main roads (fastest by road type: primary 40 km/h, residential
  16 km/h, etc., respecting speed limits), like an online router; times use those speeds.
  Saved roads are refreshed to the new format automatically when online.

## 1.4.1

- Routes follow the roads offline in more cases:
  - Areas saved before 1.4.0 get their roads automatically in the background when online.
  - Tapping Route where no roads are saved (while online) downloads the roads for that trip
    first and keeps them, so the same route works offline later.
  - Road downloads skip parking aisles and driveways, and retry with a smaller area if the
    server can't handle a big, dense one.

## 1.4.0

- 🧭 Route: tap Route on any place (list or map marker) to see a blue route line from your
  location, with distance and time, Walk / Drive, and a Google Maps hand-off for turn-by-turn.
- Offline shortest routes: saving an area now also saves its roads (up to 10 km), and the
  shortest path is calculated on the phone (A*). Walking uses footpaths; driving respects one-way streets.
- Areas without saved roads use the online routing service, or a straight line when offline.
- The route updates as you walk.

## 1.3.1

- Typing a kind of place ("school", "ATM", "chemist") in the search box now finds those
  near you (saving your area first if needed) instead of towns with that name abroad.
- Town search stays in your own country, with a "Search outside India" button if you need it.
- The Map tab always opens on your current location and follows you until you move the map.
- The street map stays light in dark mode.

## 1.3.0

- Appearance: System (follows the phone), Light or Dark. Switch with the 🌓 button in the
  header or under Offline areas → Appearance. Remembered, with no flash on start.
- Dark street map in dark mode (falls back to the light map if the dark one isn't saved offline).

## 1.2.1

- New category: 🏫 Schools & Colleges.
- Town search shows up to 5 matches, nearest to you first, with the distance, so a
  same-named place abroad (e.g. "School", Busan) can't be picked by mistake.
- Typing a kind of place ("school", "chemist", "ATM") in town search explains how to find
  those and jumps to the right category.

## 1.2.0

- Hotels: "Check prices & book" on each hotel and "Compare hotels" for your area (Booking.com
  affiliate links, with a clear commission notice). Hidden offline.
- Nearby Pro: one-time Google Play purchase. Free keeps 2 saved areas up to 5 km; Pro unlocks
  unlimited areas and 10/20 km. Restore purchase, pending payments and refunds handled.

## 1.1.0

- New street map: OpenFreeMap vector map drawn with MapLibre (no API key). Fixes the
  "Access blocked" map in the Android app, which came from OpenStreetMap's tile-server policy.
- Map data you view is cached for offline use, including in the Android app.
- Falls back to a clear message if the device can't draw the map; the list keeps working.

## 1.0.0

First production release.

- Save areas (2–20 km) or whole towns for offline use from OpenStreetMap.
- Nearest-first list with distance, walking time, direction and compass arrows.
- 13 traveller categories, including pan & tobacco shops and kiosks.
- "Open now" / "Closed" badges and a *Hide closed* filter.
- Add your own places; export/import backups.
- Offline map with tiles cached as you browse.
- Installable web app with in-app update prompt; Android app via Capacitor.
- Privacy policy, CSP, input validation, request timeouts and server fallbacks.
