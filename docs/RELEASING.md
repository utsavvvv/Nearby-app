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

Store listing text, the feature graphic, the icon and screenshots are ready in [`store/`](../store/LISTING.md).

- Create the app, then upload the `.aab` to *Internal testing* first. Turn on **Play App Signing** (the default).
- **Privacy policy URL**: `https://<user>.github.io/<repo>/privacy.html`.
- **Data safety** (based on what the app does; check it against your final build):
  - *Location → Approximate location*: **collected**. The centre of an area you save is sent to the OpenStreetMap Overpass/Nominatim services to fetch place data. Purpose: *App functionality*. Not shared for advertising. Processed ephemerally. Users choose when this happens.
  - *Precise location*: used on the device only to sort by distance, and never transmitted. Under Play's definitions that is **not collected**.
  - *Purchase history*: purchases are processed by Google Play. The app only reads ownership from Play on the device and sends nothing to us. Check Play's current guidance for apps using Play Billing only.
  - No accounts, no analytics, no ads. All requests use HTTPS (encrypted in transit).
  - Users can delete data by clearing app storage or uninstalling.
- **Permissions declaration**: location is foreground only (no background location).
- **Content rating** questionnaire: the "Paan & Kiosks" category lists paan shops and kiosks, some of which sell tobacco, as points of interest. Answer the questionnaire honestly. Usually this means a reference to tobacco, not promotion. The app never sells, prices or promotes tobacco products.
- **Target audience**: adults (18+) is the simplest choice given the paan category.
- Screenshots: take them from the debug APK on a phone, or from the web app at phone size.

## Selling Nearby Pro

Pro is a one-time **in-app product** sold through Google Play Billing. The plugin adds the billing permission automatically.

1. Upload a signed AAB to a testing track first. Play Console only lets you create products once the app has an APK/AAB that uses billing.
2. In **Play Console → Monetize with Play → Products → In-app products**, create a product:
   - **Product ID:** `nearby_pro` (must match `PRO_PRODUCT_ID` in `src/js/config.js`)
   - **Name:** Nearby Pro. **Description:** "Unlimited saved areas and 10–20 km areas."
   - **Price:** e.g. ₹79. Play converts it for other countries. Then **Activate** it.
3. Add your Google account under **Settings → License testing**. Test purchases are then free and get refunded automatically.
4. Install the app from the testing track's link (not a debug APK: billing only works for Play-installed apps), then buy Pro and use *Restore purchase*.
5. **Payments profile:** Play Console → Setup → Payments profile, with your bank account for payouts. Google keeps 15% of your first US$1M per year.

How it works: the app asks Google Play which products the account owns, at every start and on *Restore purchase*. It acknowledges new purchases (otherwise Google refunds them after 3 days), handles pending UPI/cash payments, and removes Pro if a purchase is refunded. Pro is remembered on the phone, so it keeps working offline.

There's no server check of purchases. A determined user on a rooted phone could unlock Pro without paying, which is normal for small one-time purchases. If that becomes a problem, add server verification, or use RevenueCat (`@revenuecat/purchases-capacitor`).

## Hotel affiliate links

1. Apply at <https://www.booking.com/affiliate-program/>. They usually want a live website or app listing, so apply once the app is on Play or the web version is live.
2. Put your affiliate ID in `BOOKING_AFFILIATE_ID` in `src/js/config.js` and release.
3. Commissions show in the Booking.com partner centre. For another partner (Agoda, MakeMyTrip), add a link builder in `src/js/hotels.js` using the deep-link format from their partner dashboard.

The app already shows "We may earn a commission" next to every booking link. Keep that: affiliate programmes and Indian consumer rules expect it.

## Pre-release smoke test (5 minutes)

1. Install the debug APK (or open the web app). Allow location.
2. *Offline areas → Around me*. You should see "Saved N places".
3. Turn on airplane mode, then force-close and reopen the app. The list, filters, search, compass and add-place should all still work.
4. Open the Map tab. Markers show, and the background shows streets you viewed earlier.
5. Test *Export*, delete the area, then *Import* it again.
6. Tap *Open in maps app* on a place. Your maps app opens at that spot.
