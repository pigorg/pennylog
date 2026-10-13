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

// Ogni record ha updatedAt; le cancellazioni sono "lapidi" ({id, deleted, updatedAt}) così la
// sincronizzazione con Drive sa che un record è stato eliminato e non lo reinserisce.
const DB = {
  onChange: null,

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
    const st = { n: 0 };
    return run(STORES, 'readwrite', t => {
      for (const s of STORES) {
        const os = t.objectStore(s);
        for (const r of remote[s] || []) {
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
    const now = Date.now();
    await run(STORES, 'readwrite', t => {
      for (const s of STORES) {
        const os = t.objectStore(s);
        const incoming = new Map((data[s] || []).map(o => [o.id, o]));
        os.getAllKeys().onsuccess = ev => {
          ev.target.result.forEach(k => { if (!incoming.has(k)) os.put({ id: k, deleted: true, updatedAt: now }); });
        };
        incoming.forEach(o => { const { deleted, ...rest } = o; os.put({ ...rest, updatedAt: now }); });
      }
    });
    DB.onChange && DB.onChange();
  },

  // Cancella tutto dal dispositivo (logout). Non genera lapidi: i dati restano su Drive.
  wipe: () => run(STORES, 'readwrite', t => { STORES.forEach(s => t.objectStore(s).clear()); }),
};

const uid = () => crypto.randomUUID();
