# Changelog

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
