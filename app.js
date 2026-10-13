const $ = s => document.querySelector(s);
const view = $('#view');
const dlg = $('#dlg');

const state = { tab: 'home', cats: [], periods: [], expenses: [], viewPeriodId: null };

const DEFAULT_CATS = ['Alimentari', 'Trasporti', 'Casa', 'Salute', 'Svago', 'Altro'];

// ---------- utilità ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = c => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(c / 100);
const fmtDate = s => (s ? s.split('-').reverse().join('/') : '');
const todayStr = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5) + 1;
const monthLabel = ym => new Date(ym + '-01T00:00:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
const parseEuro = s => {
  const n = parseFloat(String(s).trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const centsToInput = c => (c / 100).toFixed(2).replace('.', ',');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}

// ---------- dati ----------
const openPeriod = () => state.periods.find(p => p.status === 'open');
const catName = id => (state.cats.find(c => c.id === id) || { name: 'Senza causale' }).name;
const periodExpenses = id => state.expenses.filter(e => e.periodId === id);
const sum = list => list.reduce((a, e) => a + e.amount, 0);

async function load() {
  [state.cats, state.periods, state.expenses] = await Promise.all([DB.all('categories'), DB.all('periods'), DB.all('expenses')]);
  if (!state.cats.length) {
    // id fissi: due telefoni che creano le causali di base prima di sincronizzarsi non generano doppioni
    for (const name of DEFAULT_CATS) await DB.put('categories', { id: 'default-' + name.toLowerCase(), name });
    state.cats = await DB.all('categories');
  }
  state.cats.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  state.periods.sort((a, b) => b.start.localeCompare(a.start));
  state.expenses.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

async function refresh() { await load(); render(); }

// ---------- dialog ----------
function showDialog(html, onSubmit) {
  dlg.innerHTML = `<form method="dialog" id="f">${html}</form>`;
  const f = $('#f');
  f.addEventListener('click', e => { if (e.target.dataset.close !== undefined) dlg.close(); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.submitter && e.submitter.dataset.close !== undefined) return;
    if ((await onSubmit(new FormData(f), e.submitter)) !== false) dlg.close();
  });
  dlg.showModal();
  document.body.classList.add('dlg-open');
  return f;
}
dlg.addEventListener('close', () => document.body.classList.remove('dlg-open'));

const catOptions = sel => state.cats.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
const monthName = () => new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());

// Il budget parte da 0 (nessun budget) e, una volta impostato, viene riproposto a ogni nuova nota:
// vale quello dell'ultimo periodo, aperto o chiuso (state.periods è ordinato dal più recente).
const lastBudget = () => (state.periods[0] ? state.periods[0].budget || 0 : 0);

function periodForm(p = {}) {
  return `
    <label>Nome della nota</label><input name="name" required value="${esc(p.name ?? monthName())}">
    <label>Data di apertura</label><input type="date" name="start" required value="${p.start ?? todayStr()}">
    <label>Budget (€) · 0 = nessun budget</label><input name="budget" inputmode="decimal" value="${centsToInput(p.budget ?? lastBudget())}">`;
}

// ---------- azioni ----------
function newPeriodDialog() {
  showDialog(`<h1>Nuova nota spese</h1>${periodForm()}
    <div class="actions"><button class="primary">Crea</button><button type="button" data-close>Annulla</button></div>`, async fd => {
    const budget = fd.get('budget') ? parseEuro(fd.get('budget')) : 0;
    if (Number.isNaN(budget)) { toast('Budget non valido'); return false; }
    await DB.put('periods', { id: uid(), name: fd.get('name').trim(), start: fd.get('start'), end: null, budget, note: '', status: 'open' });
    await refresh();
  });
}

function editPeriodDialog() {
  const p = openPeriod();
  showDialog(`<h1>Modifica nota</h1>${periodForm(p)}
    <div class="actions"><button class="primary">Salva</button><button type="button" data-close>Annulla</button></div>`, async fd => {
    const budget = fd.get('budget') ? parseEuro(fd.get('budget')) : 0;
    if (Number.isNaN(budget)) { toast('Budget non valido'); return false; }
    await DB.put('periods', { ...p, name: fd.get('name').trim(), start: fd.get('start'), budget });
    await refresh();
  });
}

function closePeriodDialog() {
  const p = openPeriod();
  const total = sum(periodExpenses(p.id));
  showDialog(`<h1>Chiudi "${esc(p.name)}"</h1>
    <p class="muted">${periodExpenses(p.id).length} spese, totale ${eur(total)}. Verranno salvate nello storico.</p>
    <label>Data di chiusura</label><input type="date" name="end" required value="${todayStr()}">
    <label>Nota di chiusura</label><textarea name="note" rows="3" placeholder="Come è andato il periodo?"></textarea>
    <label class="check"><input type="checkbox" name="again" checked> Apri subito una nuova nota</label>
    <label>Budget della nuova nota (€) · 0 = nessun budget</label><input name="budget" inputmode="decimal" value="${centsToInput(p.budget || 0)}">
    <div class="actions"><button class="primary">Chiudi periodo</button><button type="button" data-close>Annulla</button></div>`, async fd => {
    const end = fd.get('end');
    if (end < p.start) { toast('La chiusura non può precedere l\'apertura'); return false; }
    const budget = fd.get('budget') ? parseEuro(fd.get('budget')) : 0;
    if (Number.isNaN(budget)) { toast('Budget non valido'); return false; }
    await DB.put('periods', { ...p, end, note: fd.get('note').trim(), status: 'closed' });
    if (fd.get('again')) {
      await DB.put('periods', { id: uid(), name: 'Nuova nota', start: addDays(end, 1), end: null, budget, note: '', status: 'open' });
    }
    toast('Periodo chiuso e salvato nello storico');
    await refresh();
  });
}

// Mostra la fotocamera a schermo intero e restituisce { blob } dopo lo scatto,
// { cancelled: true } se l'utente annulla, { error } se non è disponibile o manca il permesso.
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { error: 'unsupported' };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (err) {
    return { error: err.name || 'error' };
  }
  return new Promise(resolve => {
    const cd = document.createElement('dialog');
    cd.className = 'camdlg';
    cd.innerHTML = `<video playsinline muted autoplay></video>
      <div class="camhint">Inquadra lo scontrino, con il totale ben visibile</div>
      <div class="camctl"><button type="button" class="camcancel">Annulla</button>
      <button type="button" class="shutter" aria-label="Scatta"></button><span></span></div>`;
    document.body.appendChild(cd);
    const video = cd.querySelector('video');
    video.srcObject = stream;
    const done = result => { stream.getTracks().forEach(t => t.stop()); cd.close(); cd.remove(); resolve(result); };
    cd.querySelector('.camcancel').onclick = () => done({ cancelled: true });
    cd.addEventListener('cancel', ev => { ev.preventDefault(); done({ cancelled: true }); });
    cd.querySelector('.shutter').onclick = () => {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob(blob => done({ blob }), 'image/jpeg', 0.92);
    };
    cd.showModal();
    video.play().catch(() => {});
  });
}

function expenseDialog(e = null) {
  if (!openPeriod()) { toast('Crea prima una nota spese'); return; }
  const f = showDialog(`<h1>${e ? 'Modifica spesa' : 'Nuova spesa'}</h1>
    <button type="button" class="primary block" id="scancam">📷 Scansiona scontrino</button>
    <label class="gallery" for="file">oppure scegli una foto dalla galleria</label>
    <input type="file" id="file" accept="image/*" class="sr-only">
    <div id="scanmsg" class="muted" aria-live="polite"></div>
    <label>Importo (€)</label><input name="amount" id="amount" inputmode="decimal" required placeholder="0,00" value="${e ? centsToInput(e.amount) : ''}">
    <label>Causale</label><select name="cat">${catOptions(e?.categoryId)}</select>
    <label>Data</label><input type="date" name="date" required value="${e?.date ?? todayStr()}">
    <label>Descrizione (opzionale)</label><input name="desc" value="${esc(e?.desc ?? '')}">
    <div class="actions">
      <button class="primary">Salva</button>
      <button type="button" data-close>Annulla</button>
      ${e ? '<button type="button" class="danger" id="del">Elimina</button>' : ''}
    </div>`, async fd => {
    const amount = parseEuro(fd.get('amount'));
    if (!(amount > 0)) { toast('Importo non valido'); return false; }
    await DB.put('expenses', {
      id: e?.id ?? uid(), periodId: e?.periodId ?? openPeriod().id, amount, categoryId: fd.get('cat'),
      date: fd.get('date'), desc: fd.get('desc').trim(), createdAt: e?.createdAt ?? Date.now(),
    });
    await refresh();
  });
  const file = f.querySelector('#file');
  const msg = f.querySelector('#scanmsg');
  const steps = { 'loading tesseract core': 'Carico il motore di lettura (la prima volta serve la rete)…',
    'loading language traineddata': 'Carico la lingua italiana…', 'initializing api': 'Avvio la lettura…' };

  async function readImage(img) {
    msg.textContent = 'Immagine ricevuta, preparo la lettura…';
    try {
      const { cents } = await scanReceipt(img, (status, p) => {
        msg.textContent = status === 'recognizing text' ? `Lettura in corso… ${Math.round(p * 100)}%` : (steps[status] || msg.textContent);
      });
      if (cents) {
        f.querySelector('#amount').value = centsToInput(cents);
        msg.textContent = `Totale rilevato: ${eur(cents)}. Controlla che sia corretto.`;
      } else {
        msg.textContent = 'Totale non riconosciuto: inseriscilo a mano o riprova con una foto più nitida.';
      }
    } catch (err) {
      msg.textContent = 'Lettura non riuscita: ' + (err && err.message ? err.message : 'riprova') + ' Puoi inserire l\'importo a mano.';
    }
  }

  // Fotocamera dentro l'app: non si esce dal browser, quindi Android non può chiudere la pagina
  // per liberare memoria mentre si scatta (succede coi telefoni con poca RAM usando l'app fotocamera).
  f.querySelector('#scancam').onclick = async () => {
    msg.textContent = 'Apro la fotocamera…';
    const r = await openCamera();
    if (r.blob) return readImage(r.blob);
    if (r.cancelled) { msg.textContent = ''; return; }
    msg.textContent = r.error === 'NotAllowedError'
      ? 'Permesso per la fotocamera negato. Consentilo dalle impostazioni del sito, oppure scegli una foto dalla galleria.'
      : 'Fotocamera non disponibile su questo dispositivo: scegli una foto dalla galleria.';
  };

  file.onchange = async () => {
    const img = file.files[0];
    if (!img) return;
    await readImage(img);
    file.value = ''; // permette di scegliere di nuovo la stessa foto
  };
  const del = f.querySelector('#del');
  if (del) del.onclick = async () => {
    if (!confirm('Eliminare questa spesa?')) return;
    await DB.del('expenses', e.id);
    dlg.close();
    await refresh();
  };
}

// ---------- viste ----------
function budgetCard(p, total) {
  if (!p.budget) return '';
  const left = p.budget - total;
  const pct = Math.min(100, Math.round((total / p.budget) * 100));
  return `<div class="row"><span class="muted">Budget ${eur(p.budget)}</span><b class="${left < 0 ? 'neg' : 'pos'}">${left < 0 ? 'Sforato di ' + eur(-left) : 'Restano ' + eur(left)}</b></div>
    <div class="bar ${left < 0 ? 'over' : ''}"><i style="width:${pct}%"></i></div>`;
}

function homeView() {
  const p = openPeriod();
  if (!p) {
    return `<h1>Spese</h1><div class="card empty">Nessuna nota spese aperta.<div class="actions" style="justify-content:center"><button class="primary" data-act="new-period">Crea nota spese</button></div></div>`;
  }
  const list = periodExpenses(p.id);
  const total = sum(list);
  let lastDay = '';
  const items = list.map(e => {
    const head = e.date !== lastDay ? `<div class="day">${fmtDate(e.date)}</div>` : '';
    lastDay = e.date;
    return `${head}<div class="item" data-act="edit-exp" data-id="${e.id}">
      <div>${esc(catName(e.categoryId))}<small>${esc(e.desc)}</small></div><b>${eur(e.amount)}</b></div>`;
  }).join('');
  return `
    <div class="row"><h1>${esc(p.name)}</h1><button class="link" data-act="edit-period">Modifica</button></div>
    <div class="muted">Aperta dal ${fmtDate(p.start)}</div>
    <div class="card"><div class="muted">Speso</div><div class="big">${eur(total)}</div>${budgetCard(p, total)}</div>
    <div class="card">${items || '<div class="empty">Nessuna spesa. Tocca + per aggiungerne una.</div>'}</div>
    <div class="actions"><button data-act="close-period">Chiudi periodo</button></div>
    <button class="primary fab" data-act="add-exp" aria-label="Aggiungi spesa">+</button>`;
}

function statsHtml(p, list) {
  const total = sum(list);
  const end = p.end || todayStr();
  const days = Math.max(1, daysBetween(p.start, end));
  const rows = [
    ['Apertura', fmtDate(p.start)],
    ['Chiusura', p.end ? fmtDate(p.end) : 'in corso'],
    ['Durata', `${days} giorni`],
    ['Totale speso', eur(total)],
    ['Media giornaliera', eur(Math.round(total / days))],
    ['Numero spese', list.length],
  ];
  return `<div class="card"><div class="kv">${rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div>${p.budget ? `<div style="margin-top:14px">${budgetCard(p, total)}</div>` : ''}</div>
    ${p.note ? `<div class="card"><div class="muted">Nota di chiusura</div>${esc(p.note)}</div>` : ''}`;
}

function byCategoryHtml(list, p) {
  const total = sum(list) || 1;
  const days = Math.max(1, daysBetween(p.start, p.end || todayStr()));
  const map = {};
  list.forEach(e => {
    const c = map[e.categoryId] || (map[e.categoryId] = { sum: 0, n: 0, max: 0 });
    c.sum += e.amount;
    c.n++;
    c.max = Math.max(c.max, e.amount);
  });
  const rows = Object.entries(map).sort((a, b) => b[1].sum - a[1].sum).map(([id, c]) => {
    const pct = Math.round((c.sum / total) * 100);
    return `<div class="stat"><div class="row"><span>${esc(catName(id))} <span class="muted">${pct}%</span></span><b>${eur(c.sum)}</b></div>
     <div class="bar"><i style="width:${pct}%"></i></div>
     <div class="muted" style="margin-top:4px">${c.n} ${c.n === 1 ? 'spesa' : 'spese'} · media ${eur(Math.round(c.sum / c.n))} · max ${eur(c.max)} · ${eur(Math.round(c.sum / days))}/giorno</div></div>`;
  }).join('');
  return `<h2>Statistica per causale</h2><div class="card">${rows || '<div class="empty">Nessuna spesa</div>'}</div>`;
}

function monthlyHtml() {
  const map = {};
  state.expenses.forEach(e => { const k = e.date.slice(0, 7); map[k] = (map[k] || 0) + e.amount; });
  const rows = Object.keys(map).sort().reverse().map(k =>
    `<div class="item" style="cursor:default"><span>${esc(monthLabel(k))}</span><b>${eur(map[k])}</b></div>`).join('');
  return `<h2>Riepilogo mensile</h2><div class="card">${rows || '<div class="empty">Nessuna spesa</div>'}</div>`;
}

function reportView() {
  const id = state.viewPeriodId && state.periods.find(p => p.id === state.viewPeriodId) ? state.viewPeriodId : (openPeriod() || state.periods[0] || {}).id;
  const p = state.periods.find(x => x.id === id);
  const sel = state.periods.map(x => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${esc(x.name)} (${fmtDate(x.start)}${x.end ? ' – ' + fmtDate(x.end) : ' – in corso'})</option>`).join('');
  if (!p) return `<h1>Report</h1><div class="card empty">Nessun dato.</div>`;
  const list = periodExpenses(p.id);
  const del = p.status === 'closed'
    ? `<div class="actions"><button class="danger block" data-act="del-period" data-id="${p.id}">Elimina questo periodo</button></div>` : '';
  return `<h1>Report</h1><select id="pick">${sel}</select>${statsHtml(p, list)}${del}${byCategoryHtml(list, p)}${monthlyHtml()}`;
}

function historyView() {
  const closed = state.periods.filter(p => p.status === 'closed');
  const rows = closed.map(p => {
    const list = periodExpenses(p.id);
    return `<div class="item" data-act="open-report" data-id="${p.id}">
      <div><b>${esc(p.name)}</b><small>${fmtDate(p.start)} – ${fmtDate(p.end)} · ${list.length} ${list.length === 1 ? 'spesa' : 'spese'}</small>${p.note ? `<small>“${esc(p.note)}”</small>` : ''}</div>
      <b>${eur(sum(list))}</b></div>`;
  }).join('');
  const clear = closed.length
    ? '<div class="actions"><button class="danger block" data-act="clear-history">Pulisci storico</button></div>' : '';
  return `<h1>Storico</h1><div class="card">${rows || '<div class="empty">Nessun periodo chiuso.</div>'}</div>${clear}`;
}

// Elimina periodi chiusi con le loro spese. La nota aperta non si tocca mai.
async function deletePeriods(ids) {
  const set = new Set(ids);
  const items = state.periods.filter(p => set.has(p.id) && p.status === 'closed').map(p => ['periods', p.id]);
  state.expenses.filter(e => set.has(e.periodId)).forEach(e => items.push(['expenses', e.id]));
  await DB.delMany(items);
  state.viewPeriodId = null;
  await refresh();
}

async function deletePeriod(id) {
  const p = state.periods.find(x => x.id === id);
  if (!p || p.status !== 'closed') return;
  const n = periodExpenses(id).length;
  if (!confirm(`Eliminare "${p.name}" con ${n} ${n === 1 ? 'spesa' : 'spese'}? Non si può annullare.`)) return;
  await deletePeriods([id]);
  toast('Periodo eliminato');
}

async function clearHistory() {
  const closed = state.periods.filter(p => p.status === 'closed');
  if (!closed.length) return;
  const n = closed.reduce((a, p) => a + periodExpenses(p.id).length, 0);
  if (!confirm(`Eliminare tutti i ${closed.length} periodi chiusi e le loro ${n} spese? Non si può annullare. La nota aperta non viene toccata.`)) return;
  await deletePeriods(closed.map(p => p.id));
  toast('Storico svuotato');
}

function historyCard() {
  const closed = state.periods.filter(p => p.status === 'closed');
  const n = closed.reduce((a, p) => a + periodExpenses(p.id).length, 0);
  const info = closed.length
    ? `${closed.length} ${closed.length === 1 ? 'periodo chiuso' : 'periodi chiusi'}, ${n} ${n === 1 ? 'spesa' : 'spese'}. La nota aperta non viene toccata.`
    : 'Lo storico è vuoto.';
  return `<h2>Storico</h2><div class="card"><p class="muted">${info}</p>
    <div class="actions"><button class="danger" data-act="clear-history" ${closed.length ? '' : 'disabled'}>Pulisci storico</button></div></div>`;
}

function settingsView() {
  const cats = state.cats.map(c => `<div class="item" style="cursor:default"><span>${esc(c.name)}</span>
    <span><button class="link" data-act="ren-cat" data-id="${c.id}">Rinomina</button><button class="link danger" data-act="del-cat" data-id="${c.id}">Elimina</button></span></div>`).join('');
  return `<h1>Impostazioni</h1>
    <div id="install"></div>
    <h2>Causali</h2><div class="card">${cats}<div class="actions"><button class="primary" data-act="add-cat">+ Nuova causale</button></div></div>
    <h2>Backup</h2><div class="card"><p class="muted">I dati sono salvati solo su questo telefono. Esporta un backup per non perderli.</p>
      <div class="actions"><button data-act="export">Esporta backup</button><button data-act="import">Importa backup</button></div>
      <input type="file" id="imp" accept="application/json" hidden></div>
    ${historyCard()}
    ${accountCard()}
    <p class="muted small" style="text-align:center;margin-top:24px"><a href="privacy.html">Privacy</a> · <a href="terms.html">Termini di servizio</a></p>`;
}

function accountCard() {
  const u = Auth.user;
  if (!u) return '';
  if (u.sub === 'dev') {
    return `<h2>Account Google</h2><div class="card warnbox"><b>Modalità prova</b>
      <p class="muted">Nessun account Google collegato: i dati restano solo su questo telefono e non vengono salvati su Drive.</p>
      <div class="actions"><button class="primary" data-act="link-account">Collega account Google</button></div></div>`;
  }
  const last = Sync.last ? new Date(Sync.last).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : 'mai';
  return `<h2>Account Google</h2><div class="card">
    <div style="overflow-wrap:anywhere"><b>${esc(u.name || u.email)}</b><div class="muted">${esc(u.email)}</div></div>
    <p class="muted">I dati sono salvati nel tuo Google Drive, in una cartella riservata a questa app. Ultima sincronizzazione: ${last}.</p>
    ${Sync.state === 'error' && Sync.lastError ? `<p class="small neg" style="overflow-wrap:anywhere">Errore: ${esc(Sync.lastError)}</p>` : ''}
    <div class="actions"><button class="primary" data-act="sync-now">Sincronizza ora</button><button class="danger" data-act="logout">Esci / cambia account</button></div></div>`;
}

// ---------- accesso e sincronizzazione ----------
const SYNC_LABEL = { idle: '', syncing: 'Sincronizzazione…', ok: 'Salvato su Drive', offline: 'Offline · modifiche in attesa',
  auth: 'Tocca per sincronizzare', error: 'Errore di sincronizzazione · riprova', noconfig: 'Sincronizzazione non attiva' };

function paintSync(s = Sync.state) {
  const el = $('#sync');
  el.className = s;
  el.textContent = Auth.user ? SYNC_LABEL[s] : '';
  if (state.tab === 'settings' && Auth.user) render();
}
Sync.onState = paintSync;
Sync.onMerged = refresh;

async function syncNow() {
  const ok = await Sync.run(true); // chiamata da un tocco: può aprire la finestra di Google
  if (!ok && Sync.state === 'auth') toast('Autorizza l\'accesso a Google per sincronizzare');
  if (!ok && Sync.state === 'error') toast(Sync.lastError || 'Errore di sincronizzazione');
}

// Collega (o cambia) l'account Google scegliendolo dalla finestra di Google, senza uscire dall'app.
async function linkAccount() {
  if (!Auth.configured()) return toast('Manca il Client ID Google in config.js (vedi LEGGIMI.md)');
  await Auth.preload();
  try {
    await Auth.signIn();
  } catch (e) {
    const t = e && (e.type || e.error);
    return toast(t === 'popup_closed' ? 'Accesso annullato' : t === 'popup_failed_to_open' ? 'Consenti i popup del browser e riprova' : 'Accesso non riuscito');
  }
  toast('Account collegato');
  await Sync.run();
  await refresh();
}

function loginView(err = '') {
  document.body.classList.add('locked');
  const setup = !Auth.configured();
  view.innerHTML = `<div class="login">
    <img class="logo-big" src="icons/logo-512.png" alt="Spese Personali, by istore-lab.com">
    <h1 class="sr-only">Spese Personali</h1>
    <p class="muted">Tieni sotto controllo le tue spese, per causale e per periodo. Accedi con Google per salvare i tuoi dati.</p>
    <p class="muted small">I dati sono salvati nel tuo Google Drive, in una cartella riservata a questa app. Nessun altro può leggerli.</p>
    <p class="small"><a href="privacy.html">Privacy</a> · <a href="terms.html">Termini di servizio</a></p>
    <div id="install"></div>
    ${err ? `<div class="card warnbox">${esc(err)}</div>` : ''}
    ${setup ? '<div class="card warnbox small">Accesso Google non configurato: inserisci il Client ID in <b>config.js</b> (vedi LEGGIMI.md).</div>' : ''}
    <button class="gbtn" data-act="login" ${setup ? 'disabled' : ''}>
      <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.5 5.8c4.4-4.1 7-10.1 7-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.500 14.500 0 0 1 9.5 24c0-1.600.3-3.200.9-4.700l-7.900-6.100A24 24 0 0 0 0 24c0 3.900.9 7.500 2.600 10.800l7.900-6.100z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.500-5.800c-2.100 1.400-4.800 2.300-8.400 2.300-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z"/></svg>
      Accedi con Google</button>
  </div>`;
  paintSync();
  refreshInstall();
}

// ---------- installazione come app ----------
let installEvent = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function refreshInstall() {
  const el = $('#install');
  if (el) el.innerHTML = installCard();
}

function installCard() {
  if (isStandalone()) return '';
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua);
  const inApp = /Android/.test(ua) && (/; wv\)/.test(ua) || /FBAN|FBAV|Instagram|Line\/|Telegram|Snapchat/.test(ua));
  let text, btn = '';
  if (installEvent) {
    text = 'Installala sul telefono: si apre a schermo intero come una vera app.';
    btn = '<button class="primary block" data-act="install">Installa l\'app</button>';
  } else if (inApp) {
    text = 'Questo browser non permette di installare l\'app. Aprila in Chrome.';
    const intent = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=${location.protocol.replace(':', '')};package=com.android.chrome;end`;
    btn = `<a class="btn primary block" href="${intent}">Apri in Chrome</a>`;
  } else if (ios) {
    text = 'Tocca Condividi (il quadrato con la freccia) e poi «Aggiungi alla schermata Home».';
  } else {
    text = 'Per installarla apri il menu ⋮ di Chrome e scegli «Installa app». Se non la vedi, usa Chrome e naviga qualche secondo nell\'app.';
  }
  return `<div class="card"><b>Installa l'app</b><p class="muted">${text}</p>${btn}</div>`;
}

async function doInstall() {
  if (!installEvent) return;
  installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  if (choice.outcome === 'accepted') toast('Installazione in corso…');
  refreshInstall();
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; refreshInstall(); });
window.addEventListener('appinstalled', () => { installEvent = null; toast('App installata'); refreshInstall(); });

async function login() {
  const btn = $('.gbtn');
  btn.disabled = true;
  try {
    await Auth.signIn();
  } catch (e) {
    btn.disabled = false;
    const t = e && (e.type || e.error);
    if (t === 'popup_closed') return loginView('Accesso annullato.');
    if (t === 'popup_failed_to_open') return loginView('Il browser ha bloccato la finestra di accesso. Consenti i popup e riprova.');
    if (t === 'gsi_unavailable') return loginView('Impossibile contattare Google. Controlla la connessione e riprova.');
    return loginView('Accesso non riuscito. Riprova.');
  }
  view.innerHTML = '<div class="login"><p class="muted">Recupero dei tuoi dati da Drive…</p></div>';
  await Sync.run();
  await enterApp();
}

async function logout() {
  if (Sync.dirty) await Sync.run(true);
  const msg = Sync.dirty
    ? 'Ci sono modifiche non ancora salvate su Drive che andranno perse. Uscire comunque?'
    : 'I tuoi dati restano su Google Drive e verranno rimossi da questo telefono. Uscire?';
  if (!confirm(msg)) return;
  await Auth.signOut();
  state.cats = []; state.periods = []; state.expenses = [];
  state.tab = 'home';
  loginView();
}

async function enterApp() {
  document.body.classList.remove('locked');
  await load();
  render();
  paintSync();
}

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  view.innerHTML = { home: homeView, report: reportView, history: historyView, settings: settingsView }[state.tab]();
  const pick = $('#pick');
  if (pick) pick.onchange = () => { state.viewPeriodId = pick.value; render(); };
  const imp = $('#imp');
  if (imp) imp.onchange = importBackup;
  refreshInstall();
}

// ---------- causali e backup ----------
function catDialog(c) {
  showDialog(`<h1>${c ? 'Rinomina causale' : 'Nuova causale'}</h1>
    <label>Nome</label><input name="name" required value="${esc(c?.name ?? '')}">
    <div class="actions"><button class="primary">Salva</button><button type="button" data-close>Annulla</button></div>`, async fd => {
    const name = fd.get('name').trim();
    if (!name) return false;
    if (state.cats.some(x => x.id !== c?.id && x.name.toLowerCase() === name.toLowerCase())) { toast('Causale già presente'); return false; }
    await DB.put('categories', { id: c?.id ?? uid(), name });
    await refresh();
  });
}

async function delCat(id) {
  const used = state.expenses.filter(e => e.categoryId === id).length;
  const msg = used ? `Questa causale è usata da ${used} spese, che resteranno "Senza causale". Eliminarla?` : 'Eliminare la causale?';
  if (!confirm(msg)) return;
  await DB.del('categories', id);
  await refresh();
}

async function exportBackup() {
  const blob = new Blob([JSON.stringify(await DB.dump(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spese-backup-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importBackup(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.periods || !data.expenses || !data.categories) throw new Error();
    if (!confirm('L\'importazione sostituisce tutti i dati attuali. Continuare?')) return;
    await DB.replaceAll(data);
    toast('Backup importato');
    await refresh();
  } catch {
    toast('File di backup non valido');
  }
}

// ---------- eventi ----------
document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'new-period': return newPeriodDialog();
    case 'edit-period': return editPeriodDialog();
    case 'close-period': return closePeriodDialog();
    case 'add-exp': return expenseDialog();
    case 'edit-exp': return expenseDialog(state.expenses.find(x => x.id === id));
    case 'open-report': state.viewPeriodId = id; state.tab = 'report'; return render();
    case 'add-cat': return catDialog();
    case 'ren-cat': return catDialog(state.cats.find(c => c.id === id));
    case 'del-cat': return delCat(id);
    case 'export': return exportBackup();
    case 'import': return $('#imp').click();
    case 'login': return login();
    case 'install': return doInstall();
    case 'sync-now': return syncNow();
    case 'logout': return logout();
    case 'link-account': return linkAccount();
    case 'del-period': return deletePeriod(id);
    case 'clear-history': return clearHistory();
  }
});

$('#sync').addEventListener('click', () => {
  if (Sync.state === 'noconfig') return toast('Manca il Client ID Google in config.js (vedi LEGGIMI.md)');
  if (Auth.user && Auth.user.sub === 'dev') { state.tab = 'settings'; return render(); }
  if (Sync.state === 'auth' || Sync.state === 'error') syncNow();
});

// Ogni modifica locale pianifica una sincronizzazione; al ritorno nell'app si risincronizza.
DB.onChange = () => Sync.touch();
document.addEventListener('visibilitychange', () => { if (!document.hidden && Auth.user) Sync.run(); });
window.addEventListener('online', () => { if (Auth.user) Sync.run(); });
window.addEventListener('offline', () => { if (Auth.user) Sync.set('offline'); });

// ---------- avvio ----------
(async () => {
  if ('serviceWorker' in navigator) {
    // Quando arriva una nuova versione dell'app, ricarica una volta per usarla subito.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  // Solo in sviluppo su localhost: ?dev salta l'accesso Google per provare l'interfaccia.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.search.includes('dev') && !Auth.user) {
    store.set(LS_USER, JSON.stringify({ sub: 'dev', email: 'dev@localhost', name: 'Sviluppo' }));
  }
  if (!Auth.user) {
    Auth.preload();
    return loginView();
  }
  await enterApp();
  if (Auth.configured()) {
    await Auth.preload();
    Sync.run();
  }
})();
