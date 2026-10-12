# Spese Personali

PWA per le spese personali. I dati stanno sul telefono e vengono sincronizzati nel Google Drive
dell'utente (cartella riservata `appDataFolder`). Nessun server, nessun database tuo.

## 1. Creare il Client ID Google (una volta sola)

1. Vai su https://console.cloud.google.com e crea un progetto (es. "Spese Personali").
2. **API e servizi > Libreria**: abilita **Google Drive API**.
3. **API e servizi > Schermata consenso OAuth**:
   - Tipo utente: **Esterno**.
   - Nome app, email di assistenza, logo, link alla privacy policy.
   - **Ambiti**: aggiungi `openid`, `email`, `profile` e `.../auth/drive.appdata` (tutti non sensibili).
   - Stato di pubblicazione: porta l'app su **In produzione**. In "Test" i token scadono dopo 7 giorni
     e possono accedere solo gli utenti di test.
4. **API e servizi > Credenziali > Crea credenziali > ID client OAuth > Applicazione web**.
   - **Origini JavaScript autorizzate**: l'indirizzo dove pubblichi l'app (es. `https://tuonome.github.io`)
     e, per provare in locale, `http://localhost:8080`. Non servono URI di reindirizzamento.
5. Copia il Client ID in `config.js`:
   ```js
   window.APP_CONFIG = { GOOGLE_CLIENT_ID: '1234-abcd.apps.googleusercontent.com' };
   ```

## 2. Provare in locale

```
npx serve . -l 8080        # oppure: python -m http.server 8080
```
Apri `http://localhost:8080`. Con `http://localhost:8080/?dev` (solo su localhost) salti il login
Google per provare l'interfaccia.

## 3. Pubblicare

Carica la cartella su un hosting statico HTTPS (GitHub Pages, Netlify, Cloudflare Pages).
Su Android, Chrome propone "Installa app". Per il Play Store: impacchetta con Bubblewrap/PWABuilder
(serve anche `/.well-known/assetlinks.json`).

Quando cambi i file dell'app, incrementa `CACHE` in `sw.js` (es. `spese-v4`) per forzare l'aggiornamento.

## Come funziona la sincronizzazione

- Ogni record ha `updatedAt`; le cancellazioni sono lapidi. Il record più recente vince.
- Si sincronizza 3 secondi dopo ogni modifica, al ritorno nell'app e quando torna la rete.
- Il token Google dura circa un'ora e il browser non offre un refresh silenzioso: se scade, in alto compare
  "Tocca per sincronizzare" e basta un tocco. Nel frattempo l'app funziona offline.
- "Esci" rimuove i dati dal telefono; restano su Drive e si recuperano con il login.
