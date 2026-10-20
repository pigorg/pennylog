const $ = s => document.querySelector(s);
const view = $('#view');
const dlg = $('#dlg');

const state = { tab: 'home', cats: [], periods: [], expenses: [], viewPeriodId: null };

// ---------- utilità ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5) + 1;
const legalHref = page => (LANG === 'it' ? `../it/${page}.html` : `../${page}.html`);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('on'), 2600);
}

// Testi fissi dell'HTML (barra di navigazione) nella lingua corrente.
function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('#tabs').setAttribute('aria-label', t('Sezioni'));
}

// ---------- dati ----------
const openPeriod = () => state.periods.find(p => p.status === 'open');
const catName = id => { const c = state.cats.find(x => x.id === id); return c ? catLabel(c) : t('Senza causale'); };
const sortedCats = () => [...state.cats].sort((a, b) => catLabel(a).localeCompare(catLabel(b), LANG));
const periodExpenses = id => state.expenses.filter(e => e.periodId === id);
const sum = list => list.reduce((a, e) => a + e.amount, 0);

async function load() {
  [state.cats, state.periods, state.expenses] = await Promise.all([DB.all('categories'), DB.all('periods'), DB.all('expenses')]);
  if (!state.cats.length) {
    // id fissi: due telefoni che creano le causali di base prima di sincronizzarsi non generano doppioni
    for (const [id, it, en] of DEFAULT_CATS) await DB.put('categories', { id, name: LANG === 'it' ? it : en });
    state.cats = await DB.all('categories');
  }
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

const catOptions = sel => sortedCats().map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('');

// Il budget parte da 0 (nessun budget) e, una volta impostato, viene riproposto a ogni nuova nota:
// vale quello dell'ultimo periodo, aperto o chiuso (state.periods è ordinato dal più recente).
const lastBudget = () => (state.periods[0] ? state.periods[0].budget || 0 : 0);

const buttons = (ok, extra = '') => `<div class="actions"><button class="primary">${ok}</button><button type="button" data-close>${t('Annulla')}</button>${extra}</div>`;

function periodForm(p = {}) {
  return `
    <label>${t('Nome della nota')}</label><input name="name" required maxlength="80" value="${esc(p.name ?? monthName())}">
    <label>${t('Data di apertura')}</label><input type="date" name="start" required value="${esc(p.start ?? todayStr())}">
    <label>${t('Budget ({sym}) · 0 = nessun budget', { sym: curSymbol() })}</label><input name="budget" inputmode="decimal" value="${centsToInput(p.budget ?? lastBudget())}">`;
}

// ---------- azioni ----------
function newPeriodDialog() {
  showDialog(`<h1>${t('Nuova nota spese')}</h1>${periodForm()}${buttons(t('Crea'))}`, async fd => {
    const budget = fd.get('budget') ? parseAmount(fd.get('budget')) : 0;
    if (Number.isNaN(budget) || budget > MAX_CENTS) { toast(t('Budget non valido')); return false; }
    await DB.put('periods', { id: uid(), name: fd.get('name').trim(), start: fd.get('start'), end: null, budget, note: '', status: 'open' });
    await refresh();
  });
}

function editPeriodDialog() {
  const p = openPeriod();
  showDialog(`<h1>${t('Modifica nota')}</h1>${periodForm(p)}${buttons(t('Salva'))}`, async fd => {
    const budget = fd.get('budget') ? parseAmount(fd.get('budget')) : 0;
    if (Number.isNaN(budget) || budget > MAX_CENTS) { toast(t('Budget non valido')); return false; }
    await DB.put('periods', { ...p, name: fd.get('name').trim(), start: fd.get('start'), budget });
    await refresh();
  });
}

function closePeriodDialog() {
  const p = openPeriod();
  const list = periodExpenses(p.id);
  showDialog(`<h1>${t('Chiudi "{name}"', { name: esc(p.name) })}</h1>
    <p class="muted">${t('{count}, totale {total}. Verranno salvate nello storico.', { count: tn(list.length, '{n} spesa', '{n} spese'), total: money(sum(list)) })}</p>
    <label>${t('Data di chiusura')}</label><input type="date" name="end" required value="${todayStr()}">
    <label>${t('Nota di chiusura')}</label><textarea name="note" rows="3" maxlength="1000" placeholder="${t('Come è andato il periodo?')}"></textarea>
    <label class="check"><input type="checkbox" name="again" checked> ${t('Apri subito una nuova nota')}</label>
    <label>${t('Budget della nuova nota ({sym}) · 0 = nessun budget', { sym: curSymbol() })}</label><input name="budget" inputmode="decimal" value="${centsToInput(p.budget || 0)}">
    ${buttons(t('Chiudi periodo'))}`, async fd => {
    const end = fd.get('end');
    if (end < p.start) { toast(t('La chiusura non può precedere l\'apertura')); return false; }
    const budget = fd.get('budget') ? parseAmount(fd.get('budget')) : 0;
    if (Number.isNaN(budget) || budget > MAX_CENTS) { toast(t('Budget non valido')); return false; }
    await DB.put('periods', { ...p, end, note: fd.get('note').trim(), status: 'closed' });
    if (fd.get('again')) {
      await DB.put('periods', { id: uid(), name: t('Nuova nota'), start: addDays(end, 1), end: null, budget, note: '', status: 'open' });
    }
    toast(t('Periodo chiuso e salvato nello storico'));
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
      <div class="camhint">${t('Inquadra lo scontrino, con il totale ben visibile')}</div>
      <div class="camctl"><button type="button" class="camcancel">${t('Annulla')}</button>
      <button type="button" class="shutter" aria-label="${t('Scatta')}"></button><span></span></div>`;
    document.body.appendChild(cd);
    const video = cd.querySelector('video');
    video.srcObject = stream;
    const done = result => { stream.getTracks().forEach(tr => tr.stop()); cd.close(); cd.remove(); resolve(result); };
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
  if (!openPeriod()) { toast(t('Crea prima una nota spese')); return; }
  const f = showDialog(`<h1>${e ? t('Modifica spesa') : t('Nuova spesa')}</h1>
    <button type="button" class="primary block" id="scancam">${t('📷 Scansiona scontrino')}</button>
    <label class="gallery" for="file">${t('oppure scegli una foto dalla galleria')}</label>
    <input type="file" id="file" accept="image/*" class="sr-only">
    <div id="scanmsg" class="muted" aria-live="polite"></div>
    <label>${t('Importo ({sym})', { sym: curSymbol() })}</label><input name="amount" id="amount" inputmode="decimal" required placeholder="${centsToInput(0)}" value="${e ? centsToInput(e.amount) : ''}">
    <label>${t('Causale')}</label><select name="cat">${catOptions(e?.categoryId)}</select>
    <label>${t('Data')}</label><input type="date" name="date" required value="${esc(e?.date ?? todayStr())}">
    <label>${t('Descrizione (opzionale)')}</label><input name="desc" maxlength="200" value="${esc(e?.desc ?? '')}">
    ${buttons(t('Salva'), e ? `<button type="button" class="danger" id="del">${t('Elimina')}</button>` : '')}`, async fd => {
    const amount = parseAmount(fd.get('amount'));
    if (!(amount > 0 && amount <= MAX_CENTS)) { toast(t('Importo non valido')); return false; }
    await DB.put('expenses', {
      id: e?.id ?? uid(), periodId: e?.periodId ?? openPeriod().id, amount, categoryId: fd.get('cat'),
      date: fd.get('date'), desc: fd.get('desc').trim(), createdAt: e?.createdAt ?? Date.now(),
    });
    await refresh();
  });
  const file = f.querySelector('#file');
  const msg = f.querySelector('#scanmsg');
  const steps = { 'loading tesseract core': 'Carico il motore di lettura (la prima volta serve la rete)…',
    'loading language traineddata': 'Carico la lingua di lettura…', 'initializing api': 'Avvio la lettura…' };

  async function readImage(img) {
    msg.textContent = t('Immagine ricevuta, preparo la lettura…');
    try {
      const { cents } = await scanReceipt(img, (status, p) => {
        msg.textContent = status === 'recognizing text' ? t('Lettura in corso… {p}%', { p: Math.round(p * 100) }) : (steps[status] ? t(steps[status]) : msg.textContent);
      });
      if (cents) {
        f.querySelector('#amount').value = centsToInput(cents);
        msg.textContent = t('Totale rilevato: {total}. Controlla che sia corretto.', { total: money(cents) });
      } else {
        msg.textContent = t('Totale non riconosciuto: inseriscilo a mano o riprova con una foto più nitida.');
      }
    } catch (err) {
      msg.textContent = t('Lettura non riuscita: {err} Puoi inserire l\'importo a mano.', { err: (err && err.message) || t('Errore imprevisto.') });
    }
  }

  // Fotocamera dentro l'app: non si esce dal browser, quindi Android non può chiudere la pagina
  // per liberare memoria mentre si scatta (succede coi telefoni con poca RAM usando l'app fotocamera).
  f.querySelector('#scancam').onclick = async () => {
    msg.textContent = t('Apro la fotocamera…');
    const r = await openCamera();
    if (r.blob) return readImage(r.blob);
    if (r.cancelled) { msg.textContent = ''; return; }
    msg.textContent = r.error === 'NotAllowedError'
      ? t('Permesso per la fotocamera negato. Consentilo dalle impostazioni del sito, oppure scegli una foto dalla galleria.')
      : t('Fotocamera non disponibile su questo dispositivo: scegli una foto dalla galleria.');
  };

  file.onchange = async () => {
    const img = file.files[0];
    if (!img) return;
    await readImage(img);
    file.value = ''; // permette di scegliere di nuovo la stessa foto
  };
  const del = f.querySelector('#del');
  if (del) del.onclick = async () => {
    if (!confirm(t('Eliminare questa spesa?'))) return;
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
  return `<div class="row"><span class="muted">${t('Budget {b}', { b: money(p.budget) })}</span><b class="${left < 0 ? 'neg' : 'pos'}">${left < 0 ? t('Sforato di {x}', { x: money(-left) }) : t('Restano {x}', { x: money(left) })}</b></div>
    <div class="bar ${left < 0 ? 'over' : ''}"><i style="width:${pct}%"></i></div>`;
}

function homeView() {
  const p = openPeriod();
  if (!p) {
    return `<h1>${t('Spese')}</h1><div class="card empty">${t('Nessuna nota spese aperta.')}<div class="actions" style="justify-content:center"><button class="primary" data-act="new-period">${t('Crea nota spese')}</button></div></div>`;
  }
  const list = periodExpenses(p.id);
  const total = sum(list);
  let lastDay = '';
  const items = list.map(e => {
    const head = e.date !== lastDay ? `<div class="day">${fmtDate(e.date)}</div>` : '';
    lastDay = e.date;
    return `${head}<div class="item" data-act="edit-exp" data-id="${esc(e.id)}">
      <div>${esc(catName(e.categoryId))}<small>${esc(e.desc)}</small></div><b>${money(e.amount)}</b></div>`;
  }).join('');
  return `
    <div class="row"><h1>${esc(p.name)}</h1><button class="link" data-act="edit-period">${t('Modifica')}</button></div>
    <div class="muted">${t('Aperta dal {d}', { d: fmtDate(p.start) })}</div>
    <div class="card"><div class="muted">${t('Speso')}</div><div class="big">${money(total)}</div>${budgetCard(p, total)}</div>
    <div class="card">${items || `<div class="empty">${t('Nessuna spesa. Tocca + per aggiungerne una.')}</div>`}</div>
    <div class="actions"><button data-act="close-period">${t('Chiudi periodo')}</button></div>
    <button class="primary fab" data-act="add-exp" aria-label="${t('Aggiungi spesa')}">+</button>`;
}

function statsHtml(p, list) {
  const total = sum(list);
  const days = Math.max(1, daysBetween(p.start, p.end || todayStr()));
  const rows = [
    [t('Apertura'), fmtDate(p.start)],
    [t('Chiusura'), p.end ? fmtDate(p.end) : t('in corso')],
    [t('Durata'), tn(days, '{n} giorno', '{n} giorni')],
    [t('Totale speso'), money(total)],
    [t('Media giornaliera'), money(Math.round(total / days))],
    [t('Numero spese'), list.length],
  ];
  return `<div class="card"><div class="kv">${rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div>${p.budget ? `<div style="margin-top:14px">${budgetCard(p, total)}</div>` : ''}</div>
    ${p.note ? `<div class="card"><div class="muted">${t('Nota di chiusura')}</div>${esc(p.note)}</div>` : ''}`;
}

function byCategoryHtml(list, p) {
  const total = sum(list) || 1;
  const days = Math.max(1, daysBetween(p.start, p.end || todayStr()));
  const map = Object.create(null);
  list.forEach(e => {
    const c = map[e.categoryId] || (map[e.categoryId] = { sum: 0, n: 0, max: 0 });
    c.sum += e.amount;
    c.n++;
    c.max = Math.max(c.max, e.amount);
  });
  const rows = Object.entries(map).sort((a, b) => b[1].sum - a[1].sum).map(([id, c]) => {
    const pct = Math.round((c.sum / total) * 100);
    return `<div class="stat"><div class="row"><span>${esc(catName(id))} <span class="muted">${pct}%</span></span><b>${money(c.sum)}</b></div>
     <div class="bar"><i style="width:${pct}%"></i></div>
     <div class="muted" style="margin-top:4px">${t('{count} · media {avg} · max {max} · {day}/giorno', { count: tn(c.n, '{n} spesa', '{n} spese'), avg: money(Math.round(c.sum / c.n)), max: money(c.max), day: money(Math.round(c.sum / days)) })}</div></div>`;
  }).join('');
  return `<h2>${t('Statistica per causale')}</h2><div class="card">${rows || `<div class="empty">${t('Nessuna spesa')}</div>`}</div>`;
}

function monthlyHtml() {
  const map = Object.create(null);
  state.expenses.forEach(e => { const k = e.date.slice(0, 7); map[k] = (map[k] || 0) + e.amount; });
  const rows = Object.keys(map).sort().reverse().map(k =>
    `<div class="item" style="cursor:default"><span>${esc(monthLabel(k))}</span><b>${money(map[k])}</b></div>`).join('');
  return `<h2>${t('Riepilogo mensile')}</h2><div class="card">${rows || `<div class="empty">${t('Nessuna spesa')}</div>`}</div>`;
}

function reportView() {
  const id = state.viewPeriodId && state.periods.find(p => p.id === state.viewPeriodId) ? state.viewPeriodId : (openPeriod() || state.periods[0] || {}).id;
  const p = state.periods.find(x => x.id === id);
  const sel = state.periods.map(x => `<option value="${esc(x.id)}" ${x.id === id ? 'selected' : ''}>${esc(x.name)} (${fmtDate(x.start)} – ${x.end ? fmtDate(x.end) : t('in corso')})</option>`).join('');
  if (!p) return `<h1>${t('Report')}</h1><div class="card empty">${t('Nessun dato.')}</div>`;
  const list = periodExpenses(p.id);
  const del = p.status === 'closed'
    ? `<div class="actions"><button class="danger block" data-act="del-period" data-id="${esc(p.id)}">${t('Elimina questo periodo')}</button></div>` : '';
  return `<h1>${t('Report')}</h1><select id="pick">${sel}</select>${statsHtml(p, list)}${del}${byCategoryHtml(list, p)}${monthlyHtml()}`;
}

function historyView() {
  const closed = state.periods.filter(p => p.status === 'closed');
  const rows = closed.map(p => {
    const list = periodExpenses(p.id);
    return `<div class="item" data-act="open-report" data-id="${esc(p.id)}">
      <div><b>${esc(p.name)}</b><small>${fmtDate(p.start)} – ${fmtDate(p.end)} · ${tn(list.length, '{n} spesa', '{n} spese')}</small>${p.note ? `<small>“${esc(p.note)}”</small>` : ''}</div>
      <b>${money(sum(list))}</b></div>`;
  }).join('');
  return `<h1>${t('Storico')}</h1><div class="card">${rows || `<div class="empty">${t('Nessun periodo chiuso.')}</div>`}</div>`;
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
  if (!confirm(t('Eliminare "{name}" con {count}? Non si può annullare.', { name: p.name, count: tn(n, '{n} spesa', '{n} spese') }))) return;
  await deletePeriods([id]);
  toast(t('Periodo eliminato'));
}

async function clearHistory() {
  const closed = state.periods.filter(p => p.status === 'closed');
  if (!closed.length) return;
  const n = closed.reduce((a, p) => a + periodExpenses(p.id).length, 0);
  const msg = t('Eliminare {periods} e {expenses}? Non si può annullare. La nota aperta non viene toccata.',
    { periods: tn(closed.length, '{n} periodo chiuso', '{n} periodi chiusi'), expenses: tn(n, '{n} spesa', '{n} spese') });
  if (!confirm(msg)) return;
  await deletePeriods(closed.map(p => p.id));
  toast(t('Storico svuotato'));
}

function historyCard() {
  const closed = state.periods.filter(p => p.status === 'closed');
  const n = closed.reduce((a, p) => a + periodExpenses(p.id).length, 0);
  const info = closed.length
    ? t('{periods}, {expenses}. La nota aperta non viene toccata.',
      { periods: tn(closed.length, '{n} periodo chiuso', '{n} periodi chiusi'), expenses: tn(n, '{n} spesa', '{n} spese') })
    : t('Lo storico è vuoto.');
  return `<h2>${t('Storico')}</h2><div class="card"><p class="muted">${info}</p>
    <div class="actions"><button class="danger" data-act="clear-history" ${closed.length ? '' : 'disabled'}>${t('Pulisci storico')}</button></div></div>`;
}

function prefsCard() {
  const langs = Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${v}</option>`).join('');
  const curs = CURRENCIES.map(c => `<option value="${c}" ${c === CUR ? 'selected' : ''}>${c} · ${esc(currencyName(c))}</option>`).join('');
  return `<h2>${t('Lingua e valuta')}</h2><div class="card">
    <label style="margin-top:0">${t('Lingua')}</label><select id="lang">${langs}</select>
    <label>${t('Valuta')}</label><select id="cur">${curs}</select></div>`;
}

function settingsView() {
  const cats = sortedCats().map(c => `<div class="item" style="cursor:default"><span>${esc(catLabel(c))}</span>
    <span><button class="link" data-act="ren-cat" data-id="${esc(c.id)}">${t('Rinomina')}</button><button class="link danger" data-act="del-cat" data-id="${esc(c.id)}">${t('Elimina')}</button></span></div>`).join('');
  return `<h1>${t('Impostazioni')}</h1>
    <div id="install"></div>
    <h2>${t('Causali')}</h2><div class="card">${cats}<div class="actions"><button class="primary" data-act="add-cat">${t('+ Nuova causale')}</button></div></div>
    ${prefsCard()}
    <h2>${t('Backup')}</h2><div class="card"><p class="muted">${t('I dati sono salvati su questo telefono e nel tuo Google Drive. Esporta un backup se vuoi una copia in più.')}</p>
      <div class="actions"><button data-act="export">${t('Esporta backup')}</button><button data-act="import">${t('Importa backup')}</button></div>
      <input type="file" id="imp" accept="application/json" hidden></div>
    ${historyCard()}
    ${accountCard()}
    <p class="muted small" style="text-align:center;margin-top:24px"><a href="${legalHref('privacy')}">${t('Privacy')}</a> · <a href="${legalHref('terms')}">${t('Termini di servizio')}</a> · <a href="${legalHref('cookies')}">${t('Cookie policy')}</a></p>`;
}

function accountCard() {
  const u = Auth.user;
  if (!u) return '';
  if (u.sub === 'dev') {
    return `<h2>${t('Account Google')}</h2><div class="card warnbox"><b>${t('Modalità prova')}</b>
      <p class="muted">${t('Nessun account Google collegato: i dati restano solo su questo telefono e non vengono salvati su Drive.')}</p>
      <div class="actions"><button class="primary" data-act="link-account">${t('Collega account Google')}</button></div></div>`;
  }
  const last = Sync.last ? fmtDateTime(Sync.last) : t('mai');
  return `<h2>${t('Account Google')}</h2><div class="card">
    <div style="overflow-wrap:anywhere"><b>${esc(u.name || u.email)}</b><div class="muted">${esc(u.email)}</div></div>
    <p class="muted">${t('I dati sono salvati nel tuo Google Drive, in una cartella riservata a questa app. Ultima sincronizzazione: {last}.', { last })}</p>
    ${Sync.state === 'error' && Sync.lastError ? `<p class="small neg" style="overflow-wrap:anywhere">${t('Errore: {e}', { e: esc(Sync.lastError) })}</p>` : ''}
    <div class="actions"><button class="primary" data-act="sync-now">${t('Sincronizza ora')}</button><button class="danger" data-act="logout">${t('Esci / cambia account')}</button></div></div>`;
}

// ---------- accesso e sincronizzazione ----------
const syncLabel = s => ({ idle: '', syncing: t('Sincronizzazione…'), ok: t('Salvato su Drive'), offline: t('Offline · modifiche in attesa'),
  auth: t('Tocca per sincronizzare'), error: t('Errore di sincronizzazione · riprova'), noconfig: t('Sincronizzazione non attiva') }[s] || '');

function paintSync(s = Sync.state) {
  const el = $('#sync');
  el.className = s;
  el.textContent = Auth.user ? syncLabel(s) : '';
  if (state.tab === 'settings' && Auth.user) render();
}
Sync.onState = paintSync;
Sync.onMerged = refresh;

async function syncNow() {
  const ok = await Sync.run(true); // chiamata da un tocco: può aprire la finestra di Google
  if (!ok && Sync.state === 'auth') toast(Sync.scopeMissing ? t('Manca il permesso per Google Drive. Tocca sincronizza e spunta la casella del permesso Drive.') : t('Autorizza l\'accesso a Google per sincronizzare'));
  if (!ok && Sync.state === 'error') toast(Sync.lastError || t('Errore di sincronizzazione'));
}

// Collega (o cambia) l'account Google scegliendolo dalla finestra di Google, senza uscire dall'app.
async function linkAccount() {
  if (!Auth.configured()) return toast(t('Manca il Client ID Google in config.js (vedi README.md)'));
  await Auth.preload();
  try {
    await Auth.signIn();
  } catch (e) {
    const code = e && (e.type || e.error);
    if (code === 'scope_missing') return toast(t('Manca il permesso per Google Drive. Riprova e spunta la casella del permesso Drive.'));
    return toast(code === 'popup_closed' ? t('Accesso annullato') : code === 'popup_failed_to_open' ? t('Consenti i popup del browser e riprova') : t('Accesso non riuscito'));
  }
  toast(t('Account collegato'));
  await Sync.run();
  await refresh();
}

function loginView(err = '') {
  document.body.classList.add('locked');
  const setup = !Auth.configured();
  const langLinks = Object.entries(LANGS).map(([k, v]) => k === LANG ? `<b>${v}</b>` : `<a href="#" data-act="lang" data-lang="${k}">${v}</a>`).join(' · ');
  view.innerHTML = `<div class="login">
    <img class="logo-big" src="icons/logo-512.png" alt="Pennylog, by istore-lab.com">
    <h1 class="sr-only">Pennylog</h1>
    <p class="muted">${t('Tieni sotto controllo le tue spese, per causale e per periodo. Accedi con Google per salvare i tuoi dati.')}</p>
    <p class="muted small">${t('I dati sono salvati nel tuo Google Drive, in una cartella riservata a questa app. Nessun altro può leggerli.')}</p>
    <p class="small"><a href="${legalHref('privacy')}">${t('Privacy')}</a> · <a href="${legalHref('terms')}">${t('Termini di servizio')}</a> · <a href="${legalHref('cookies')}">${t('Cookie policy')}</a> · ${langLinks}</p>
    <div id="install"></div>
    ${err ? `<div class="card warnbox">${esc(err)}</div>` : ''}
    ${setup ? `<div class="card warnbox small">${t('Accesso Google non configurato: inserisci il Client ID in <b>config.js</b> (vedi README.md).')}</div>` : ''}
    <button class="gbtn" data-act="login" ${setup ? 'disabled' : ''}>
      <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.5 5.8c4.4-4.1 7-10.1 7-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.500 14.500 0 0 1 9.5 24c0-1.600.3-3.200.9-4.700l-7.900-6.100A24 24 0 0 0 0 24c0 3.900.9 7.500 2.600 10.800l7.900-6.100z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.500-5.800c-2.100 1.400-4.800 2.300-8.400 2.300-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z"/></svg>
      ${t('Accedi con Google')}</button>
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
    text = t('Installala sul telefono: si apre a schermo intero come una vera app.');
    btn = `<button class="primary block" data-act="install">${t('Installa l\'app')}</button>`;
  } else if (inApp) {
    text = t('Questo browser non permette di installare l\'app. Aprila in Chrome.');
    const intent = `intent://${location.host}${location.pathname}#Intent;scheme=${location.protocol.replace(':', '')};package=com.android.chrome;end`;
    btn = `<a class="btn primary block" href="${esc(intent)}">${t('Apri in Chrome')}</a>`;
  } else if (ios) {
    text = t('Tocca Condividi (il quadrato con la freccia) e poi «Aggiungi alla schermata Home».');
  } else {
    text = t('Per installarla apri il menu ⋮ di Chrome e scegli «Installa app». Se non la vedi, usa Chrome e naviga qualche secondo nell\'app.');
  }
  return `<div class="card"><b>${t('Installa l\'app')}</b><p class="muted">${text}</p>${btn}</div>`;
}

async function doInstall() {
  if (!installEvent) return;
  installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  if (choice.outcome === 'accepted') toast(t('Installazione in corso…'));
  refreshInstall();
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; refreshInstall(); });
window.addEventListener('appinstalled', () => { installEvent = null; toast(t('App installata')); refreshInstall(); });

async function login() {
  const btn = $('.gbtn');
  btn.disabled = true;
  try {
    await Auth.signIn();
  } catch (e) {
    btn.disabled = false;
    const code = e && (e.type || e.error);
    if (code === 'scope_missing') return loginView(t('Manca il permesso per Google Drive. Riprova e spunta la casella del permesso Drive.'));
    if (code === 'popup_closed') return loginView(t('Accesso annullato.'));
    if (code === 'popup_failed_to_open') return loginView(t('Il browser ha bloccato la finestra di accesso. Consenti i popup e riprova.'));
    if (code === 'gsi_unavailable') return loginView(t('Impossibile contattare Google. Controlla la connessione e riprova.'));
    return loginView(t('Accesso non riuscito. Riprova.'));
  }
  view.innerHTML = `<div class="login"><p class="muted">${t('Recupero dei tuoi dati da Drive…')}</p></div>`;
  await Sync.run();
  await enterApp();
}

async function logout() {
  if (Sync.dirty) await Sync.run(true);
  const msg = Sync.dirty
    ? t('Ci sono modifiche non ancora salvate su Drive che andranno perse. Uscire comunque?')
    : t('I tuoi dati restano su Google Drive e verranno rimossi da questo telefono. Uscire?');
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
  applyStatic();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  view.innerHTML = { home: homeView, report: reportView, history: historyView, settings: settingsView }[state.tab]();
  const pick = $('#pick');
  if (pick) pick.onchange = () => { state.viewPeriodId = pick.value; render(); };
  const imp = $('#imp');
  if (imp) imp.onchange = importBackup;
  refreshInstall();
}

// Cambio di lingua o valuta: tutto il testo e i formati si aggiornano subito.
function changePrefs(apply) {
  apply();
  if (document.body.classList.contains('locked')) loginView();
  else render();
  paintSync();
}

// ---------- causali e backup ----------
function catDialog(c) {
  showDialog(`<h1>${c ? t('Rinomina causale') : t('Nuova causale')}</h1>
    <label>${t('Nome')}</label><input name="name" required maxlength="60" value="${esc(c ? catLabel(c) : '')}">
    ${buttons(t('Salva'))}`, async fd => {
    const name = fd.get('name').trim();
    if (!name) return false;
    if (state.cats.some(x => x.id !== c?.id && catLabel(x).toLowerCase() === name.toLowerCase())) { toast(t('Causale già presente')); return false; }
    await DB.put('categories', { id: c?.id ?? uid(), name });
    await refresh();
  });
}

async function delCat(id) {
  const used = state.expenses.filter(e => e.categoryId === id).length;
  const msg = used ? t('Questa causale è usata da {n} spese, che resteranno "Senza causale". Eliminarla?', { n: used }) : t('Eliminare la causale?');
  if (!confirm(msg)) return;
  await DB.del('categories', id);
  await refresh();
}

async function exportBackup() {
  const blob = new Blob([JSON.stringify(await DB.dump(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pennylog-backup-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importBackup(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error();
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !Array.isArray(data.periods) || !Array.isArray(data.expenses) || !Array.isArray(data.categories)) throw new Error();
    if (!confirm(t('L\'importazione sostituisce tutti i dati attuali. Continuare?'))) return;
    const { dropped } = await DB.replaceAll(data);
    toast(dropped ? t('Backup importato, {n} elementi non validi ignorati', { n: dropped }) : t('Backup importato'));
    await refresh();
  } catch {
    toast(t('File di backup non valido'));
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
    case 'lang': e.preventDefault(); return changePrefs(() => setLang(el.dataset.lang));
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'lang') changePrefs(() => setLang(e.target.value));
  if (e.target.id === 'cur') changePrefs(() => setCurrency(e.target.value));
});

$('#sync').addEventListener('click', () => {
  if (Sync.state === 'noconfig') return toast(t('Manca il Client ID Google in config.js (vedi README.md)'));
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
  applyStatic();
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
    store.set(LS_USER, JSON.stringify({ sub: 'dev', email: 'dev@localhost', name: 'Dev' }));
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
