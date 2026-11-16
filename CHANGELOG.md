# Changelog

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
