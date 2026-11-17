# Nearby Offline 📍

A travel app that finds **nearby stores, pan shops, tea stalls, ATMs, pharmacies, toilets, hotels** and more, and keeps working **with no internet**.

It ships as:
- **A web app (PWA)**: open it in a phone browser and tap *Add to Home screen*. Auto-deployed to GitHub Pages.
- **An Android app**: built with Capacitor. GitHub Actions builds the APK/AAB for the Play Store.

There's no server, no account and no tracking. Everything is stored on the phone.

## Features

| Feature | Needs internet? |
|---|---|
| Save an area (shops & services from OpenStreetMap, 2–20 km radius) | Once, while online |
| Plan ahead: search a town and save it before the trip | Once, while online |
| Your location (GPS) | No |
| Nearest-first list with distance, walking time and direction | No |
| Compass arrow pointing to each place | No |
| "Open now" / "Closed" from opening hours, and *Hide closed* | No |
| Category filters & search | No |
| Add your own places (e.g. an unmapped pan shop) | No |
| Export / import places as a file (backup, share with friends) | No |
| Street map with markers (OpenFreeMap) | Areas you've viewed online are cached for offline use |
| Directions | Hands off to the phone's maps app |
| Light / Dark / System appearance | No |
| App updates | Web: shows "A new version is ready" → *Update* |
| Hotel "Check prices & book" links (Booking.com affiliate) | Yes |
| **Nearby Pro** (one-time Google Play purchase): unlimited areas, 10–20 km areas | Buying needs internet; Pro works offline |

**Categories:** 🌿 Pan & Tobacco (incl. kiosks) · 🛒 Stores & Grocery · ☕ Tea & Cafe · 🍛 Food · 💊 Pharmacy · 🏧 ATM & Bank · 🏥 Hospital & Clinic · 🚻 Toilets · 🚰 Drinking Water · 🛏️ Hotels · 🚉 Bus, Train & Taxi · ⛽ Fuel · 👮 Police

## Development

Requires Node.js 20+.

```sh
npm install
npm run serve        # build and serve on http://localhost:8080
npm run lint
npm test             # unit tests (node:test)
npm run test:e2e     # browser tests (Playwright, mocked network). First time: npx playwright install chromium
npm run check        # all of the above
```

There's no framework and no bundler. The app is plain ES modules in `src/`. `npm run build` copies them to `dist/` and generates the service worker. The worker's cache name is a hash of the content, so every release updates cleanly.

### Project layout

```
src/
  index.html, privacy.html, manifest.webmanifest, sw.js (template)
  css/style.css
  js/
    app.js          UI and app logic
    config.js       ← servers, tile source, support URL: edit before publishing
    categories.js   categories ↔ OpenStreetMap tags, Overpass query builder
    overpass.js     downloads places (timeouts, fallback servers, cancel)
    db.js           IndexedDB storage
    hours.js        opening_hours parser ("Open now")
    map.js          street map (MapLibre + OpenFreeMap) with offline caching
    model.js        validation of imported data
    theme.js        light / dark / system appearance (theme-init.js applies it before first paint)
    platform.js     web vs Android differences (links, file export)
    pro.js          Nearby Pro purchase and free limits (Google Play Billing)
    hotels.js       hotel booking (affiliate) links
    geo.js          distance / bearing helpers
scripts/            build, local server, Android icon generator
test/unit, test/e2e
android/            Capacitor Android project
.github/workflows/  CI, GitHub Pages deploy, Android build
```

### Android

```sh
npm run android:sync   # build www/ and copy into android/
npm run android:open   # open in Android Studio (needs Android SDK + JDK 21)
```

You don't need Android Studio for releases. The **Android app** workflow builds a debug APK on every push. With signing secrets set, it also builds a signed AAB for Google Play. See [docs/RELEASING.md](docs/RELEASING.md).

To change the app icon, edit `src/icons/icon.svg` and run `node scripts/android-assets.mjs`.

## Earning

- **Hotel links:** join the [Booking.com affiliate programme](https://www.booking.com/affiliate-program/) and put your ID in `BOOKING_AFFILIATE_ID` (`src/js/config.js`).
- **Nearby Pro:** a one-time in-app product `nearby_pro` in Play Console. Free limits (`FREE_MAX_AREAS`, `FREE_MAX_RADIUS`) are in the same config file. See [docs/RELEASING.md](docs/RELEASING.md#selling-nearby-pro).

## Before going live

1. In `src/js/config.js`, set `SUPPORT_URL`. The map uses [OpenFreeMap](https://openfreemap.org), which is free with no API key and allows commercial use. To use another provider, change `MAP_STYLE_URL` and `MAP_HOST` (any MapLibre style works, e.g. MapTiler or Stadia with your key).
2. In `src/privacy.html`, check the contact details.
3. In `capacitor.config.json` and `android/app/build.gradle`, set the app ID (`app.nearbyoffline.travel`) to one you own. **It can't change after you publish to Play.**
4. Choose a license (currently `UNLICENSED`, meaning all rights reserved).
5. Follow [docs/RELEASING.md](docs/RELEASING.md).

## Data & credits

Place data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL. Downloads use the public [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API), and town search uses [Nominatim](https://nominatim.org/). The street map is from [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org/), drawn with [MapLibre GL JS](https://maplibre.org/) (BSD-3-Clause).
