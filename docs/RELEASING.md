# Releasing

## Version numbers

`package.json` → `version` is the single source of truth. The Android `versionName` comes from it, and `versionCode` = `major*10000 + minor*100 + patch` (1.2.3 → 10203). Bump the version for every Play release:

```sh
npm version patch      # or minor / major; creates a commit and a v-tag
git push --follow-tags
```

## Web app (GitHub Pages)

1. One-time setup: repository **Settings → Pages → Source: GitHub Actions**.
2. Every push to `main` runs **Deploy web app**. Users who already have the app see "A new version is ready" and tap *Update*.

The site works under a sub-path (`https://<user>.github.io/<repo>/`). For a custom domain, add it in the Pages settings.

## Android (Google Play)

### 1. Create an upload key (once)

Keep this file and its passwords safe. You need them for every update.

```sh
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.jks > upload.jks.b64     # macOS: base64 -i upload.jks -o upload.jks.b64
```

### 2. Add GitHub secrets

**Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | contents of `upload.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `upload` (or the alias you chose) |
| `ANDROID_KEY_PASSWORD` | key password |

### 3. Build

Push a version tag (`npm version minor && git push --follow-tags`). The **Android app** workflow builds `app-release.aab` and attaches it to a GitHub Release. You can also download it from the run's *Artifacts*.

### 4. Play Console checklist

- Create the app, then upload the `.aab` to *Internal testing* first. Turn on **Play App Signing** (the default).
- **Privacy policy URL**: `https://<user>.github.io/<repo>/privacy.html`.
- **Data safety** (based on what the app does; check it against your final build):
  - *Location → Approximate location*: **collected**. The centre of an area you save is sent to the OpenStreetMap Overpass/Nominatim services to fetch place data. Purpose: *App functionality*. Not shared for advertising. Processed ephemerally. Users choose when this happens.
  - *Precise location*: used on the device only to sort by distance, and never transmitted. Under Play's definitions that is **not collected**.
  - No accounts, no analytics, no ads. All requests use HTTPS (encrypted in transit).
  - Users can delete data by clearing app storage or uninstalling.
- **Permissions declaration**: location is foreground only (no background location).
- **Content rating** questionnaire: the app lists tobacco/pan shops as points of interest. Answer the questionnaire honestly. Usually this means a reference to tobacco, not promotion.
- **Target audience**: adults (18+) is the simplest choice given the tobacco category.
- Screenshots: take them from the debug APK on a phone, or from the web app at phone size.

## Pre-release smoke test (5 minutes)

1. Install the debug APK (or open the web app). Allow location.
2. *Offline areas → Around me*. You should see "Saved N places".
3. Turn on airplane mode, then force-close and reopen the app. The list, filters, search, compass and add-place should all still work.
4. Open the Map tab. Markers show, and the background shows streets you viewed earlier.
5. Test *Export*, delete the area, then *Import* it again.
6. Tap *Open in maps app* on a place. Your maps app opens at that spot.
