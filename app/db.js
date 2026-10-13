const DB_NAME = 'pennylog';
const DB_VER = 1;
const STORES = ['categories', 'periods', 'expenses'];
let dbp;

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      STORES.forEach(s => r.result.createObjectStore(s, { keyPath: 'id' }));
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function run(stores, mode, fn) {
  const d = await openDb();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => res(out && out.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

// ---------- validazione dei dati che arrivano da fuori ----------
// Un backup importato o il file su Drive non sono fidati: potrebbero essere stati modificati a mano o
// provenire da qualcun altro. Ogni record viene ricostruito campo per campo; quello che non è nel formato
// atteso viene scartato. Così non può finire nell'app nulla che non sia un id, una data, un importo o un testo.
const MAX_RECORDS = 50000;
const MAX_CENTS = 100000000000; // 1 miliardo
const ID_RX = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const isId = v => typeof v === 'string' && ID_RX.test(v) && !RESERVED_IDS.has(v);
const isDate = v => typeof v === 'string' && DATE_RX.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
const isInt = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max) : '');
const stamp = v => (Number.isFinite(v) && v >= 0 && v <= 4e12 ? Math.floor(v) : 0);

function cleanRecord(store, r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || !isId(r.id)) return null;
  const updatedAt = stamp(r.updatedAt);
  if (r.deleted === true) return { id: r.id, deleted: true, updatedAt };
  if (store === 'categories') {
    const name = text(r.name, 60).trim();
    return name ? { id: r.id, name, updatedAt } : null;
  }
  if (store === 'periods') {
    if (!isDate(r.start) || (r.end != null && !isDate(r.end)) || (r.status !== 'open' && r.status !== 'closed')) return null;
    return {
      id: r.id, name: text(r.name, 80).trim() || '-', start: r.start, end: r.end ?? null,
      budget: isInt(r.budget, 0, MAX_CENTS) ? r.budget : 0, note: text(r.note, 1000), status: r.status, updatedAt,
    };
  }
  if (store === 'expenses') {
    if (!isId(r.periodId) || !isId(r.categoryId) || !isInt(r.amount, 1, MAX_CENTS) || !isDate(r.date)) return null;
    return {
      id: r.id, periodId: r.periodId, categoryId: r.categoryId, amount: r.amount, date: r.date,
      desc: text(r.desc, 200), createdAt: stamp(r.createdAt), updatedAt,
    };
  }
  return null;
}

// Ritorna i dati ripuliti e quanti elementi sono stati scartati.
function sanitizeData(data) {
  const clean = { categories: [], periods: [], expenses: [] };
  let dropped = 0;
  if (!data || typeof data !== 'object') return { clean, dropped };
  for (const s of STORES) {
    const list = Array.isArray(data[s]) ? data[s] : [];
    if (list.length > MAX_RECORDS) dropped += list.length - MAX_RECORDS;
    const seen = new Set();
    for (const r of list.slice(0, MAX_RECORDS)) {
      const c = cleanRecord(s, r);
      if (c && !seen.has(c.id)) { seen.add(c.id); clean[s].push(c); } else dropped++;
    }
  }
  return { clean, dropped };
}

// Ogni record ha updatedAt; le cancellazioni sono "lapidi" ({id, deleted, updatedAt}) così la
// sincronizzazione con Drive sa che un record è stato eliminato e non lo reinserisce.
const DB = {
  onChange: null,
  sanitize: sanitizeData,

  all: async store => (await run(store, 'readonly', t => t.objectStore(store).getAll())).filter(o => !o.deleted),

  async put(store, obj) {
    await run(store, 'readwrite', t => t.objectStore(store).put({ ...obj, updatedAt: Date.now() }));
    DB.onChange && DB.onChange();
  },

  async del(store, id) {
    await run(store, 'readwrite', t => t.objectStore(store).put({ id, deleted: true, updatedAt: Date.now() }));
    DB.onChange && DB.onChange();
  },

  // Elimina più record in un'unica operazione (lapidi, così la cancellazione arriva anche agli altri dispositivi).
  async delMany(items) { // items: [[store, id], ...]
    if (!items.length) return;
    const now = Date.now();
    await run(STORES, 'readwrite', t => {
      items.forEach(([store, id]) => t.objectStore(store).put({ id, deleted: true, updatedAt: now }));
    });
    DB.onChange && DB.onChange();
  },

  // raw=true include le lapidi (serve per la sincronizzazione), raw=false solo i dati veri (backup).
  async dump(raw = false) {
    const out = { version: 1, exportedAt: new Date().toISOString() };
    for (const s of STORES) {
      const rows = await run(s, 'readonly', t => t.objectStore(s).getAll());
      out[s] = raw ? rows : rows.filter(o => !o.deleted);
    }
    return out;
  },

  // Unisce i dati remoti: per ogni id vince il record con updatedAt più recente. Ritorna quanti ne ha applicati.
  mergeIn(remote) {
    const { clean } = sanitizeData(remote); // il file su Drive non è fidato: si accetta solo ciò che ha il formato giusto
    const st = { n: 0 };
    return run(STORES, 'readwrite', t => {
      for (const s of STORES) {
        const os = t.objectStore(s);
        for (const r of clean[s]) {
          os.get(r.id).onsuccess = ev => {
            const l = ev.target.result;
            if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) { os.put(r); st.n++; }
          };
        }
      }
      return { get result() { return st.n; } };
    });
  },

  // Importazione backup: sostituisce i dati; gli id non presenti diventano lapidi per propagare la cancellazione.
  async replaceAll(data) {
    const { clean, dropped } = sanitizeData(data);
    const now = Date.now();
    await run(STORES, 'readwrite', t => {
      for (const s of STORES) {
        const os = t.objectStore(s);
        const incoming = new Map(clean[s].map(o => [o.id, o]));
        os.getAllKeys().onsuccess = ev => {
          ev.target.result.forEach(k => { if (!incoming.has(k)) os.put({ id: k, deleted: true, updatedAt: now }); });
        };
        incoming.forEach(o => { if (!o.deleted) os.put({ ...o, updatedAt: now }); });
      }
    });
    DB.onChange && DB.onChange();
    return { dropped };
  },

  // Cancella tutto dal dispositivo (logout). Non genera lapidi: i dati restano su Drive.
  wipe: () => run(STORES, 'readwrite', t => { STORES.forEach(s => t.objectStore(s).clear()); }),
};

const uid = () => crypto.randomUUID();
