# Google Play store listing — Nearby Offline

Copy each field into **Play Console → Grow → Store presence → Main store listing**.
Character limits are Play's; counts are given so you can edit safely.

## App name (max 30)

```
Nearby Offline: Paan & ATMs
```
(27. Alternative: `Nearby Offline – India Travel` (29))

## Short description (max 80)

```
No signal? No stress. Find paan, chai, ATMs & chemists with offline routes.
```

Alternatives:
- `Nearby shops, ATMs & chemists with offline maps & routes. Made for India trips.`
- `Zero network? Still find chai, ATMs, toilets & routes around you. 100% offline.`

## Full description (max 4000)

```
no signal? no stress ⚡

Nearby Offline is your travel buddy for India: it finds what you need around you — paan & chai stalls, kirana stores, ATMs, chemists, toilets, drinking water, schools, hotels, bus & train stations — and keeps working when the network dies.

Save your area once on Wi-Fi. After that, the list, the map and even walking and driving routes work in airplane mode. Perfect for ghats, hill stations, old-city galis, long train rides and roaming without data.

🌿 FIND STUFF FAST
• Nearest first, with distance and an arrow that points the way
• "Open now" / "closed" badges, hide-closed filter
• Type what you need: "chai", "ATM", "chemist", "school"
• 14 categories: Paan & Kiosks, Stores & Grocery, Tea & Cafe, Food, Pharmacy, ATM & Bank, Hospital & Clinic, Toilets, Drinking Water, Schools & Colleges, Hotels & Stay, Bus/Train/Taxi, Fuel, Police

🧭 ROUTES THAT WORK OFFLINE
• Tap Route for a blue line along real roads, right on your phone
• Walk or drive: walking takes lanes and footpaths, driving prefers main roads and respects one-way streets
• Time, distance, steps and your first turn; "start navigation" follows you as you walk
• Hand-off to Google Maps for voice turn-by-turn when you're online

🗺️ A REAL STREET MAP, OFFLINE
• Each saved area includes the full street map at every zoom level
• Search a town to save it before your trip
• Compass mode: point your phone and follow the arrow

📍 DROP A SECRET PIN
• Found a stall that's not on any map? Add it with a name, hours and a note
• Saved only on your phone; export and share a backup file with friends

🔒 PRIVATE BY DESIGN
• No account, no ads, no tracking
• Your location stays on your phone; it's only used to sort places and plan routes

⭐ NEARBY PRO (optional, one-time)
• Unlimited saved areas and big 10 & 20 km packs
• One payment through Google Play. No subscription.
• The free version keeps 2 areas up to 5 km, with every other feature included

Made for travellers in India, by an indie developer. Light and dark mode included.

Place and map data © OpenStreetMap contributors (ODbL). Map by OpenFreeMap / OpenMapTiles. Shop details come from OpenStreetMap and may be incomplete; you can add the places you find.
```
(about 2,200 characters)

## Graphics (in this folder)

| Asset | File | Play requirement |
|---|---|---|
| App icon | `icon-512.png` | 512 × 512 PNG |
| Feature graphic | `feature-graphic.png` | 1024 × 500 PNG/JPG |
| Phone screenshots | `screenshots/1-nearby.png` … `6-dark.png` | 2–8 images, 1080 × 2160 |

The screenshots show the real app with **demo data** (made-up shop names, not real businesses).
Real screenshots from your phone in your city are even better — swap them in any time.
Regenerate these with: `npm run build && node scripts/store-assets.mjs`

## Other Play Console answers

- **Category:** Travel & Local
- **Tags:** Travel, Maps, Navigation, Offline, Local
- **Contact email:** your email (required, shown publicly)
- **Privacy policy URL:** `https://<user>.github.io/Nearby-app/privacy.html` (after enabling GitHub Pages)
- **Content rating:** answer honestly. The Paan & Kiosks category lists shops, some of which sell tobacco, as places on a map. The app doesn't sell, price or promote tobacco.
- **Target audience:** 18+
- **Ads:** No
- **Data safety:** see `docs/RELEASING.md`
- **In-app products:** `nearby_pro`, one-time
