// OCR scontrini: Tesseract.js eseguito sul dispositivo, l'immagine non viene inviata a nessuno.
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('Impossibile caricare il motore OCR (serve connessione la prima volta).'));
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

const toCents = m => {
  const int = m[1].replace(/[.\s]/g, '');
  return parseInt(int, 10) * 100 + parseInt(m[2], 10);
};

// Cerca il totale: priorità alle righe con TOTALE/IMPORTO/DA PAGARE, altrimenti l'importo più alto.
function parseTotal(text) {
  const num = /(\d{1,3}(?:[.\s]\d{3})*|\d+)[,.](\d{2})\b/g;
  const strong = [];
  const weak = [];
  const all = [];
  for (const line of text.split('\n')) {
    const found = [...line.matchAll(num)].map(toCents);
    all.push(...found);
    if (!found.length || /subtotale|iva|resto|sconto/i.test(line)) continue;
    if (/tot(ale)?|importo|da pagare/i.test(line)) strong.push(Math.max(...found));
    else if (/pagato|contant|carta|bancomat/i.test(line)) weak.push(Math.max(...found));
  }
  const pool = strong.length ? strong : weak.length ? weak : all;
  return pool.length ? Math.max(...pool) : null;
}

async function scanReceipt(file, onProgress) {
  await loadScript(TESS_URL);
  const img = await downscale(file);
  const { data } = await Tesseract.recognize(img, 'ita', {
    logger: m => onProgress && m.status === 'recognizing text' && onProgress(m.progress),
  });
  return { text: data.text, cents: parseTotal(data.text) };
}
