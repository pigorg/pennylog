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
