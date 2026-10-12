// Accesso con Google + sincronizzazione su Drive (cartella privata appDataFolder).
// Tutto avviene dal browser dell'utente verso Google: nessun server intermedio.
const GSI_URL = 'https://accounts.google.com/gsi/client';
const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const DATA_FILE = 'spese-data.json';
const LS_USER = 'sp_user';
const LS_DIRTY = 'sp_dirty';
const LS_LAST = 'sp_last_sync';

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* ignora */ } },
};

const Auth = {
  token: null,
  tokenExp: 0,
  client: null,
  pending: null,
  ready: null,

  get user() { try { return JSON.parse(store.get(LS_USER)); } catch { return null; } },
  configured: () => !!(window.APP_CONFIG && window.APP_CONFIG.GOOGLE_CLIENT_ID),

  // Precarica la libreria Google (serve connessione solo se l'utente non ha ancora fatto l'accesso).
  preload() {
    if (!this.ready) this.ready = loadScript(GSI_URL).catch(() => { this.ready = null; });
    return this.ready;
  },

  hasToken: () => Auth.token && Date.now() < Auth.tokenExp,

  // Richiede un access token. prompt: '' = silenzioso se possibile, 'select_account' = scelta account.
  request(prompt = '') {
    return new Promise((resolve, reject) => {
      if (!window.google || !google.accounts) return reject({ type: 'gsi_unavailable' });
      if (!this.client) {
        this.client = google.accounts.oauth2.initTokenClient({
          client_id: window.APP_CONFIG.GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: r => {
            if (r.error) return this.pending.reject(r);
            this.token = r.access_token;
            this.tokenExp = Date.now() + (Number(r.expires_in) - 60) * 1000;
            this.pending.resolve(r.access_token);
          },
          error_callback: e => this.pending.reject(e),
        });
      }
      this.pending = { resolve, reject };
      const u = this.user;
      this.client.requestAccessToken({ prompt, ...(u && u.email ? { login_hint: u.email } : {}) });
    });
  },

  // La finestra di Google si può aprire solo da un tocco dell'utente: in background (avvio, timer,
  // ritorno nell'app) senza token valido non si tenta nemmeno, si segnala "Tocca per sincronizzare".
  async getToken(interactive = false) {
    if (this.hasToken()) return this.token;
    if (!interactive) throw { type: 'needs_interaction' };
    return this.request('');
  },

  async fetchProfile(token) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error('profilo non disponibile');
    const p = await r.json();
    return { sub: p.sub, email: p.email, name: p.name };
  },

  // Primo accesso: va chiamato direttamente dal click dell'utente.
  async signIn() {
    const token = await this.request('select_account');
    const profile = await this.fetchProfile(token);
    const prev = this.user;
    // dati di un altro account sullo stesso telefono (la modalità prova 'dev' non conta: i dati si tengono)
    if (prev && prev.sub !== profile.sub && prev.sub !== 'dev') await DB.wipe();
    store.set(LS_USER, JSON.stringify(profile));
    return profile;
  },

  async signOut() {
    if (this.token && window.google) google.accounts.oauth2.revoke(this.token, () => {});
    this.token = null;
    this.tokenExp = 0;
    store.del(LS_USER);
    store.del(LS_DIRTY);
    store.del(LS_LAST);
    await DB.wipe();
  },
};

// ---------- Drive ----------
async function drive(token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (r.status === 401) { Auth.token = null; throw { type: 'unauthorized' }; }
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json()).error.message || ''; } catch { /* corpo non JSON */ }
    throw new Error(`Drive ${r.status}${msg ? ': ' + msg : ''}`);
  }
  return r;
}

async function findDataFile(token) {
  const q = encodeURIComponent(`name='${DATA_FILE}'`);
  const r = await drive(token, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  return (await r.json()).files[0] || null;
}

async function downloadData(token, id) {
  const r = await drive(token, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return r.json();
}

async function uploadData(token, id, data) {
  const body = JSON.stringify(data);
  if (id) {
    await drive(token, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    return id;
  }
  const boundary = 'spese' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: DATA_FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await drive(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
  return (await r.json()).id;
}

// ---------- Sincronizzazione ----------
const Sync = {
  state: 'idle', // idle | syncing | ok | offline | auth | error
  lastError: '',
  running: false,
  again: false,
  seq: 0,
  timer: null,
  onState: null,
  onMerged: null,

  set(s) { this.state = s; this.onState && this.onState(s); },
  get dirty() { return store.get(LS_DIRTY) === '1'; },
  get last() { return Number(store.get(LS_LAST)) || 0; },

  touch() { // chiamata a ogni modifica locale
    this.seq++;
    store.set(LS_DIRTY, '1');
    if (!Auth.user) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), 3000);
  },

  // interactive=true solo se chiamata direttamente da un tocco dell'utente.
  async run(interactive = false) {
    if (!Auth.user) return false;
    if (!Auth.configured()) { this.set('noconfig'); return false; }
    if (!navigator.onLine) { this.set('offline'); return false; }
    if (this.running) { this.again = true; return false; }
    this.running = true;
    this.set('syncing');
    const seqAtStart = this.seq;
    let ok = false;
    try {
      const token = await Auth.getToken(interactive);
      const file = await findDataFile(token);
      const remote = file ? await downloadData(token, file.id) : null;
      const applied = remote ? await DB.mergeIn(remote) : 0;
      await uploadData(token, file && file.id, await DB.dump(true));
      store.set(LS_LAST, String(Date.now()));
      if (this.seq === seqAtStart) store.del(LS_DIRTY);
      ok = true;
      this.set('ok');
      if (applied && this.onMerged) await this.onMerged();
    } catch (e) {
      this.lastError = (e && (e.message || e.type || e.error)) || String(e);
      console.error('Sync:', e);
      const t = e && e.type;
      this.set(t === 'needs_interaction' || t === 'popup_failed_to_open' || t === 'popup_closed' || t === 'unauthorized' || t === 'gsi_unavailable' || (e && e.error) ? 'auth' : 'error');
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.run(); }
    }
    return ok;
  },
};
