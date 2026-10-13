// OCR scontrini: Tesseract.js eseguito sul dispositivo. L'immagine non viene inviata a nessuno e
// tutto il codice e i dati di lettura arrivano dal nostro dominio (app/vendor/tesseract), mai da una CDN.
const OCR_BASE = new URL('vendor/tesseract/', location.href).href;
const TESS_URL = OCR_BASE + 'tesseract.min.js';

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error(t('Impossibile caricare il motore OCR (serve connessione la prima volta).')));
    document.head.appendChild(s);
  });
}

async function downscale(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
}

// "1.234,56", "1,234.56", "1 234,56", "18.40" → centesimi
const toCents = m => parseInt(m[1].replace(/[.,\s]/g, ''), 10) * 100 + parseInt(m[2], 10);

// Righe che contengono il totale: italiano e inglese.
const RX_TOTAL = /tot(ale)?\b|importo|da pagare|total|amount due|balance due|grand total/i;
const RX_PAID = /pagato|contant|carta|bancomat|cash|card|visa|mastercard|tendered|paid/i;
const RX_SKIP = /subtotal|sub total|sub-total|sconto|discount|resto|change|\b(iva|vat|tax)\b(?!.*total)/i;

// Cerca il totale: priorità alle righe con TOTALE/TOTAL/IMPORTO, poi quelle con contante/carta/cash/card,
// altrimenti l'importo più alto dello scontrino.
function parseTotal(text) {
  const num = /(\d{1,3}(?:[.,\s]\d{3})*|\d+)[,.](\d{2})\b/g;
  const strong = [];
  const weak = [];
  const all = [];
  for (const line of text.split('\n')) {
    const found = [...line.matchAll(num)].map(toCents);
    all.push(...found);
    if (!found.length || RX_SKIP.test(line)) continue;
    if (RX_TOTAL.test(line)) strong.push(Math.max(...found));
    else if (RX_PAID.test(line)) weak.push(Math.max(...found));
  }
  const pool = strong.length ? strong : weak.length ? weak : all;
  return pool.length ? Math.max(...pool) : null;
}

// Lingua di lettura: italiano se l'app è in italiano, altrimenti inglese.
const ocrLang = () => (LANG === 'it' ? 'ita' : 'eng');

async function scanReceipt(file, onProgress) {
  await loadScript(TESS_URL);
  const img = await downscale(file);
  const { data } = await Tesseract.recognize(img, ocrLang(), {
    workerPath: OCR_BASE + 'worker.min.js',
    corePath: OCR_BASE + 'core',
    langPath: OCR_BASE + 'lang',
    workerBlobURL: false, // il worker parte dal nostro file, senza blob
    logger: m => onProgress && onProgress(m.status, m.progress),
  });
  return { text: data.text, cents: parseTotal(data.text) };
}
