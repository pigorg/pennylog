# Pennylog

Free expense tracker (PWA) that keeps your data in **your own Google Drive**. No server, no database, no ads.
Live at **https://pennylog.istore-lab.com** · by [istore-lab.com](https://istore-lab.com)

English and Italian. Track spending by category and by period, set a budget, scan receipts (on-device OCR), reports, history.

## Layout

```
/                  landing page (EN)         index.html, privacy.html, terms.html
/it/               landing page (IT)         index.html, privacy.html, terms.html
/assets/           shared images and site.css
/app/              the app (PWA)             index.html, app.js, i18n.js, db.js, drive.js, ocr.js, sw.js, manifest.webmanifest, icons/
```

Plain HTML/CSS/JS, no build step and no framework.

## Run locally

```
npx serve . -l 8080        # or: python -m http.server 8080
```

- Landing: http://localhost:8080/
- App: http://localhost:8080/app/ (add `?dev` to skip Google sign-in while testing the UI; only works on localhost)

## Google sign-in and Drive (one-time setup)

1. https://console.cloud.google.com → create a project and enable **Google Drive API**.
2. **Google Auth Platform**: Branding (app name, home page, privacy and terms links, authorized domain `istore-lab.com`), Data access scopes: `openid`, `email`, `profile`, `.../auth/drive.appdata` (all non-sensitive). Publish the app (In production), otherwise only test users can sign in.
3. **Credentials → OAuth client ID → Web application**. Authorized JavaScript origins: `https://pennylog.istore-lab.com` and, for local tests, `http://localhost:8080`. No redirect URIs.
4. Put the Client ID in `app/config.js`. The client secret is not used and must never be committed.

## Deploy (GitHub Pages)

Settings → Pages → Deploy from branch `main`, folder `/ (root)`. Custom domain: DNS `CNAME pennylog → <github-user>.github.io`, then set the custom domain in Pages and enable *Enforce HTTPS*.

After changing files under `app/`, bump `CACHE` in `app/sw.js` so installed apps pick up the update.

## How sync works

Each record carries `updatedAt`; deletions are tombstones; the most recent change wins. The app writes one JSON file to Drive's hidden `appDataFolder` (scope `drive.appdata`), 3 seconds after each change, when you return to the app and when the connection comes back. The Google access token lasts about an hour and cannot be refreshed silently without a server, so after expiry the app shows "Tap to sync".

## Languages and currencies

`app/i18n.js` holds the dictionary (Italian text is the key, English is looked up). Language follows the phone and can be changed in Settings. Currency is chosen from the region and can be changed in Settings; amounts are stored in minor units.

## Analytics and cookies

Google Analytics 4 (`G-GJSYVKX67S`) runs **only on the website** (landing, privacy, terms, cookies, 404), never inside `/app/`. It is loaded by `assets/consent.js` only after the visitor accepts the cookie banner (Consent Mode v2, everything denied by default, Google signals and ad personalisation off). The choice is stored in `localStorage` (`pl_consent`, 6 months) and can be changed from the "Cookie settings" link in every footer. Global Privacy Control is treated as a refusal.

To reuse the banner elsewhere, add `<script src="/assets/consent.js" defer></script>` to the page and a `data-cookie-settings` attribute to any link or button that should reopen the preferences.

In Google Analytics (Admin): turn off Google signals, set data retention to 14 months or less, uncheck all data-sharing settings, accept the Data Processing Amendment. Keep the privacy and cookie pages in sync with whatever is configured there.

## Security

- **Untrusted data is validated.** A backup you import and the file read from Drive are rebuilt field by field in `app/db.js` (`sanitizeData`): ids must match `[A-Za-z0-9_-]{1,64}` (and not `__proto__`/`constructor`), dates must be real `YYYY-MM-DD`, amounts safe integers between 1 and 10^11 cents, texts are length-limited. Anything else is dropped and the number of dropped items is shown after an import.
- **Everything is escaped** before it reaches `innerHTML` (`esc()`), including ids and dates used in attributes. Dictionaries keyed by data use `Object.create(null)`.
- **Content Security Policy** (meta tag in `app/index.html`, plus `frame-ancestors 'self'` from `app/.htaccess`): scripts only from the same origin and Google's sign-in script, connections only to Google (sign-in and Drive), no inline scripts, no `eval`, no plugins.
- **No third-party code at runtime.** The receipt reader (Tesseract.js, WebAssembly core, language data) is hosted in `app/vendor/tesseract/`, with sources and SHA-384 hashes in `NOTICE.txt`. No CDN.
- **Tokens** live only in memory, never in storage. Logout wipes the local database.
- **Headers** (`.htaccess`): HTTPS redirect, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (camera only for the app itself).
- Report vulnerabilities to the address in `/.well-known/security.txt`.

Known limits: data on the device and in Drive is not end-to-end encrypted (it is protected by the phone and by the Google account); the app has no PIN lock; the Google access token lasts about an hour.
