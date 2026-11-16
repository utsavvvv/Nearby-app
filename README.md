# Nearby Offline 📍

A travel app that finds **nearby stores, pan shops, tea stalls, ATMs, pharmacies, toilets, hotels** and more, and keeps working **without internet**.

It is a Progressive Web App (PWA): open it in a phone browser, tap **Add to Home screen**, and it behaves like an installed app.

## How it works offline

| Feature | Needs internet? |
|---|---|
| Saving an area (downloads shops & places from OpenStreetMap) | Once, while online |
| Your location (GPS) | No: GPS works with no signal |
| Nearest-first list, distance, walking time, direction | No |
| Compass arrow pointing to each place | No |
| Search & category filters | No |
| Adding your own places (e.g. an unmapped pan shop) | No |
| Map view | Tiles you've already viewed online are cached; markers always show |
| Turn-by-turn directions | Opens your maps app (works offline if that app has offline maps) |

1. **While online** (hotel Wi‑Fi, or before the trip), open **Offline areas** and tap **Around me**, or search a town and save the area around the map centre. You can pick a radius of 2 to 20 km.
2. Places are stored in the phone's IndexedDB. The app itself is cached by a service worker.
3. **Offline**, the **Nearby** tab sorts saved places by distance from your GPS position. Tap 🧭 to turn on the compass and follow the arrows.

## Categories

🌿 Pan & Tobacco (incl. kiosks/paan stalls) · 🛒 Stores & Grocery · ☕ Tea & Cafe · 🍛 Food · 💊 Pharmacy · 🏧 ATM & Bank · 🏥 Hospital & Clinic · 🚻 Toilets · 🚰 Drinking Water · 🛏️ Hotels · 🚉 Bus, Train & Taxi · ⛽ Fuel · 👮 Police

Mappings from OpenStreetMap tags live in `js/categories.js`. Add a category there and it flows through the download query, filters and map.

Many small pan shops aren't on OpenStreetMap. Use **＋** to save ones you find. They stay only on your phone, and you can **Export** them as a JSON file to back up or share with travel companions (**Import** on their phone).

## Run locally

No build step. Serve the folder over HTTP (service workers need `http://localhost` or HTTPS):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To use it on a phone, host it on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages). All paths are relative, so a sub-path such as `https://<user>.github.io/Nearby-app/` works.

## Project layout

```
index.html            UI shell
css/style.css         Mobile-first styles (light & dark)
js/app.js             App logic: GPS, compass, list, map, areas, add/import/export
js/categories.js      Categories and OpenStreetMap tag mapping, Overpass query builder
js/overpass.js        Downloads places from the Overpass API (with fallback servers)
js/db.js              IndexedDB storage
js/geo.js             Distance, bearing and formatting helpers
sw.js                 Service worker: caches app files and viewed map tiles
vendor/leaflet/       Leaflet 1.9.4 (bundled so the map works offline)
```

## Data & credits

Place data and map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Downloads use the public Overpass API, and town search uses Nominatim. Please keep usage light: the app only caches tiles you view, and doesn't bulk-download them.
