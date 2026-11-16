// Central settings. Change these before publishing under your own name.

export const APP_NAME = 'Nearby Offline';

// Where users can report problems (shown in the app's About section).
export const SUPPORT_URL = 'https://github.com/utsavvvv/Nearby-app/issues';

// Map tiles. The public OpenStreetMap server is fine for light use, but its policy
// (https://operations.osmfoundation.org/policies/tiles/) does not allow heavy traffic or bulk
// downloading. If the app gets popular, switch to a commercial tile provider here.
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const TILE_MAX_ZOOM = 19;
export const MAX_CACHED_TILES = 4000; // roughly 60-100 MB

// Servers that answer place-data queries. Tried in order until one works.
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
export const OVERPASS_TIMEOUT_MS = 100000;

// Town search / place names.
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
export const NOMINATIM_TIMEOUT_MS = 12000;

// Map starting point when we know nothing about the user (Kolkata).
export const DEFAULT_CENTER = [22.5726, 88.3639];

// Suggest refreshing a saved area after this many days.
export const STALE_AFTER_DAYS = 60;
