// Central settings. Change these before publishing under your own name.

export const APP_NAME = 'Nearby Offline';

// Where users can report problems (shown in the app's About section).
export const SUPPORT_URL = 'https://github.com/utsavvvv/Nearby-app/issues';

// The street map. OpenFreeMap (https://openfreemap.org) is free, needs no API key, allows
// commercial use and allows keeping viewed map data for offline use. Other styles:
// .../styles/bright, .../styles/positron. Any MapLibre style URL works if you change MAP_HOST too.
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const MAP_HOST = 'tiles.openfreemap.org';
export const MAX_CACHED_MAP_FILES = 8000; // vector tiles are small: roughly 100-200 MB at most

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
