// Lingue, valuta e formati. La chiave di ogni traduzione è il testo italiano: in italiano si
// mostra così com'è, in inglese si cerca in EN. Se manca una voce si vede l'italiano.
const LANGS = { en: 'English', it: 'Italiano' };
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'NZD', 'INR', 'MXN', 'BRL']; // tutte con 2 decimali
const LS_LANG = 'pl_lang';
const LS_CUR = 'pl_cur';

const lsRead = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsWrite = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } };

const REGION_CURRENCY = { US: 'USD', CA: 'CAD', GB: 'GBP', AU: 'AUD', NZ: 'NZD', IN: 'INR', MX: 'MXN', BR: 'BRL', CH: 'CHF' };
'IT DE FR ES PT NL BE AT IE FI GR LU SK SI EE LV LT MT CY HR'.split(' ').forEach(r => { REGION_CURRENCY[r] = 'EUR'; });

function detectLang() {
  const saved = lsRead(LS_LANG);
  if (saved && LANGS[saved]) return saved;
  return /^it/i.test(navigator.language || '') ? 'it' : 'en';
}

let LANG = detectLang();
let CUR = null;

function detectCurrency() {
  const saved = lsRead(LS_CUR);
  if (saved && CURRENCIES.includes(saved)) return saved;
  const region = ((navigator.language || '').split('-')[1] || '').toUpperCase();
  return REGION_CURRENCY[region] || (LANG === 'it' ? 'EUR' : 'USD');
}
CUR = detectCurrency();
document.documentElement.lang = LANG;

function setLang(l) {
  if (!LANGS[l]) return;
  LANG = l;
  lsWrite(LS_LANG, l);
  document.documentElement.lang = l;
}

function setCurrency(c) {
  if (!CURRENCIES.includes(c)) return;
  CUR = c;
  lsWrite(LS_CUR, c);
}

// Formato di numeri e date: italiano per chi usa l'app in italiano, altrimenti quello del telefono (en-US, en-GB…).
const localeTag = () => (LANG === 'it' ? 'it-IT' : (/^en/i.test(navigator.language || '') ? navigator.language : 'en-US'));

const fmtCache = {};
function nf(opts) {
  const key = localeTag() + JSON.stringify(opts);
  return fmtCache[key] || (fmtCache[key] = new Intl.NumberFormat(localeTag(), opts));
}
const money = c => nf({ style: 'currency', currency: CUR }).format(c / 100);
const centsToInput = c => nf({ minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(c / 100);
const curSymbol = () => nf({ style: 'currency', currency: CUR }).formatToParts(0).find(p => p.type === 'currency').value;
const currencyName = c => { try { return new Intl.DisplayNames([localeTag()], { type: 'currency' }).of(c); } catch { return c; } };

// Legge un importo digitato in qualunque formato: "18,40", "18.40", "1.234,56", "1,234.56", "$ 18.4".
function parseAmount(input) {
  let s = String(input).trim().replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let dec = null;
  if (lastDot >= 0 && lastComma >= 0) {
    dec = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    // un solo separatore con 3 cifre dopo ("1,234") è un separatore delle migliaia; altrimenti è decimale
    dec = parts.length === 2 && parts[1].length !== 3 ? sep : null;
  }
  if (dec) {
    const other = dec === '.' ? ',' : '.';
    s = s.split(other).join('').replace(dec, '.');
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

const fmtDate = s => (s ? new Intl.DateTimeFormat(localeTag(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(s + 'T12:00:00')) : '');
const monthLabel = ym => new Date(ym + '-01T12:00:00').toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' });
const monthName = () => new Date().toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
const fmtDateTime = ms => new Date(ms).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' });

// Causali di base: id fissi (due telefoni non creano doppioni), nome nella lingua in uso quando vengono create.
const DEFAULT_CATS = [
  ['default-alimentari', 'Alimentari', 'Groceries'], ['default-trasporti', 'Trasporti', 'Transport'],
  ['default-casa', 'Casa', 'Home'], ['default-salute', 'Salute', 'Health'],
  ['default-svago', 'Svago', 'Leisure'], ['default-altro', 'Altro', 'Other'],
];
// Una causale di base non rinominata si vede nella lingua corrente.
function catLabel(c) {
  const d = DEFAULT_CATS.find(x => x[0] === c.id);
  return d && (c.name === d[1] || c.name === d[2]) ? (LANG === 'it' ? d[1] : d[2]) : c.name;
}

const EN = {
  // navigazione
  'Spese': 'Expenses', 'Report': 'Report', 'Storico': 'History', 'Impostazioni': 'Settings', 'Sezioni': 'Sections',
  // comuni
  'Annulla': 'Cancel', 'Salva': 'Save', 'Crea': 'Create', 'Elimina': 'Delete', 'Modifica': 'Edit', 'Rinomina': 'Rename',
  'Nome': 'Name', 'Data': 'Date', 'Causale': 'Category', 'Causali': 'Categories', 'Nessuna spesa': 'No expenses',
  'Senza causale': 'No category', 'in corso': 'ongoing', 'mai': 'never', 'Errore imprevisto.': 'Unexpected error.',
  '{n} spesa': '{n} expense', '{n} spese': '{n} expenses',
  '{n} giorno': '{n} day', '{n} giorni': '{n} days',
  '{n} periodo chiuso': '{n} closed period', '{n} periodi chiusi': '{n} closed periods',
  // nota spese
  'Nome della nota': 'Note name', 'Data di apertura': 'Opening date',
  'Budget ({sym}) · 0 = nessun budget': 'Budget ({sym}) · 0 = no budget',
  'Budget della nuova nota ({sym}) · 0 = nessun budget': 'Budget for the new note ({sym}) · 0 = no budget',
  'Nuova nota spese': 'New expense note', 'Modifica nota': 'Edit note', 'Budget non valido': 'Invalid budget',
  'Chiudi "{name}"': 'Close "{name}"',
  '{count}, totale {total}. Verranno salvate nello storico.': '{count}, total {total}. They will be saved to the history.',
  'Data di chiusura': 'Closing date', 'Nota di chiusura': 'Closing note', 'Come è andato il periodo?': 'How did the period go?',
  'Apri subito una nuova nota': 'Open a new note right away', 'Chiudi periodo': 'Close period',
  'La chiusura non può precedere l\'apertura': 'The closing date can\'t be before the opening date',
  'Nuova nota': 'New note', 'Periodo chiuso e salvato nello storico': 'Period closed and saved to the history',
  // spesa e scansione
  'Crea prima una nota spese': 'Create an expense note first', 'Nuova spesa': 'New expense', 'Modifica spesa': 'Edit expense',
  '📷 Scansiona scontrino': '📷 Scan receipt', 'oppure scegli una foto dalla galleria': 'or pick a photo from the gallery',
  'Importo ({sym})': 'Amount ({sym})', 'Descrizione (opzionale)': 'Description (optional)',
  'Importo non valido': 'Invalid amount', 'Eliminare questa spesa?': 'Delete this expense?',
  'Carico il motore di lettura (la prima volta serve la rete)…': 'Loading the reading engine (needs a connection the first time)…',
  'Carico la lingua di lettura…': 'Loading the language data…', 'Avvio la lettura…': 'Starting the reading…',
  'Immagine ricevuta, preparo la lettura…': 'Image received, getting ready to read it…',
  'Lettura in corso… {p}%': 'Reading… {p}%',
  'Totale rilevato: {total}. Controlla che sia corretto.': 'Total found: {total}. Check that it is correct.',
  'Totale non riconosciuto: inseriscilo a mano o riprova con una foto più nitida.': 'Total not recognised: enter it by hand or try again with a sharper photo.',
  'Lettura non riuscita: {err} Puoi inserire l\'importo a mano.': 'Reading failed: {err} You can enter the amount by hand.',
  'Impossibile caricare il motore OCR (serve connessione la prima volta).': 'Could not load the OCR engine (a connection is needed the first time).',
  'Apro la fotocamera…': 'Opening the camera…',
  'Permesso per la fotocamera negato. Consentilo dalle impostazioni del sito, oppure scegli una foto dalla galleria.': 'Camera permission denied. Allow it in the site settings, or pick a photo from the gallery.',
  'Fotocamera non disponibile su questo dispositivo: scegli una foto dalla galleria.': 'Camera not available on this device: pick a photo from the gallery.',
  'Inquadra lo scontrino, con il totale ben visibile': 'Frame the receipt with the total clearly visible', 'Scatta': 'Take photo',
  // schermate
  'Budget {b}': 'Budget {b}', 'Sforato di {x}': 'Over by {x}', 'Restano {x}': '{x} left',
  'Nessuna nota spese aperta.': 'No open expense note.', 'Crea nota spese': 'Create expense note',
  'Aperta dal {d}': 'Open since {d}', 'Speso': 'Spent', 'Nessuna spesa. Tocca + per aggiungerne una.': 'No expenses yet. Tap + to add one.',
  'Aggiungi spesa': 'Add expense',
  'Apertura': 'Opened', 'Chiusura': 'Closed', 'Durata': 'Duration', 'Totale speso': 'Total spent',
  'Media giornaliera': 'Daily average', 'Numero spese': 'Number of expenses',
  'Statistica per causale': 'Statistics by category',
  '{count} · media {avg} · max {max} · {day}/giorno': '{count} · avg {avg} · max {max} · {day}/day',
  'Riepilogo mensile': 'Monthly summary', 'Nessun dato.': 'No data.', 'Elimina questo periodo': 'Delete this period',
  'Nessun periodo chiuso.': 'No closed periods.',
  'Eliminare "{name}" con {count}? Non si può annullare.': 'Delete "{name}" with {count}? This cannot be undone.',
  'Periodo eliminato': 'Period deleted',
  'Eliminare {periods} e {expenses}? Non si può annullare. La nota aperta non viene toccata.': 'Delete {periods} and {expenses}? This cannot be undone. The open note is not touched.',
  'Storico svuotato': 'History cleared',
  '{periods}, {expenses}. La nota aperta non viene toccata.': '{periods}, {expenses}. The open note is not touched.',
  'Lo storico è vuoto.': 'The history is empty.', 'Pulisci storico': 'Clear history',
  // impostazioni
  '+ Nuova causale': '+ New category', 'Backup': 'Backup',
  'I dati sono salvati su questo telefono e nel tuo Google Drive. Esporta un backup se vuoi una copia in più.': 'Your data is stored on this phone and in your Google Drive. Export a backup if you want an extra copy.',
  'Esporta backup': 'Export backup', 'Importa backup': 'Import backup',
  'Lingua e valuta': 'Language and currency', 'Lingua': 'Language', 'Valuta': 'Currency',
  'Privacy': 'Privacy', 'Termini di servizio': 'Terms of service',
  'Rinomina causale': 'Rename category', 'Nuova causale': 'New category', 'Causale già presente': 'Category already exists',
  'Questa causale è usata da {n} spese, che resteranno "Senza causale". Eliminarla?': 'This category is used by {n} expenses, which will become "No category". Delete it?',
  'Eliminare la causale?': 'Delete the category?',
  'L\'importazione sostituisce tutti i dati attuali. Continuare?': 'Importing replaces all current data. Continue?',
  'Backup importato': 'Backup imported', 'File di backup non valido': 'Invalid backup file',
  // account e sincronizzazione
  'Account Google': 'Google account', 'Modalità prova': 'Test mode',
  'Nessun account Google collegato: i dati restano solo su questo telefono e non vengono salvati su Drive.': 'No Google account connected: your data stays on this phone only and is not saved to Drive.',
  'Collega account Google': 'Connect Google account',
  'I dati sono salvati nel tuo Google Drive, in una cartella riservata a questa app. Ultima sincronizzazione: {last}.': 'Your data is saved in your Google Drive, in a folder reserved for this app. Last sync: {last}.',
  'Errore: {e}': 'Error: {e}', 'Sincronizza ora': 'Sync now', 'Esci / cambia account': 'Sign out / switch account',
  'Sincronizzazione…': 'Syncing…', 'Salvato su Drive': 'Saved to Drive', 'Offline · modifiche in attesa': 'Offline · changes waiting',
  'Tocca per sincronizzare': 'Tap to sync', 'Errore di sincronizzazione · riprova': 'Sync error · tap to retry',
  'Sincronizzazione non attiva': 'Sync not active',
  'Autorizza l\'accesso a Google per sincronizzare': 'Allow Google access to sync', 'Errore di sincronizzazione': 'Sync error',
  'Manca il Client ID Google in config.js (vedi README.md)': 'The Google Client ID is missing in config.js (see README)',
  'Accesso annullato': 'Sign-in cancelled', 'Consenti i popup del browser e riprova': 'Allow browser pop-ups and try again',
  'Accesso non riuscito': 'Sign-in failed', 'Account collegato': 'Account connected',
  'Tieni sotto controllo le tue spese, per causale e per periodo. Accedi con Google per salvare i tuoi dati.': 'Keep track of your spending by category and by period. Sign in with Google to save your data.',
  'I dati sono salvati nel tuo Google Drive, in una cartella riservata a questa app. Nessun altro può leggerli.': 'Your data is saved in your Google Drive, in a folder reserved for this app. Nobody else can read it.',
  'Accesso Google non configurato: inserisci il Client ID in <b>config.js</b> (vedi README.md).': 'Google sign-in not configured: add the Client ID in <b>config.js</b> (see README).',
  'Accedi con Google': 'Sign in with Google',
  'Accesso annullato.': 'Sign-in cancelled.',
  'Il browser ha bloccato la finestra di accesso. Consenti i popup e riprova.': 'The browser blocked the sign-in window. Allow pop-ups and try again.',
  'Impossibile contattare Google. Controlla la connessione e riprova.': 'Could not reach Google. Check your connection and try again.',
  'Accesso non riuscito. Riprova.': 'Sign-in failed. Try again.',
  'Recupero dei tuoi dati da Drive…': 'Retrieving your data from Drive…',
  'Ci sono modifiche non ancora salvate su Drive che andranno perse. Uscire comunque?': 'There are changes not yet saved to Drive that will be lost. Sign out anyway?',
  'I tuoi dati restano su Google Drive e verranno rimossi da questo telefono. Uscire?': 'Your data stays in Google Drive and will be removed from this phone. Sign out?',
  // installazione
  'Installa l\'app': 'Install the app',
  'Installala sul telefono: si apre a schermo intero come una vera app.': 'Install it on your phone: it opens full screen like a real app.',
  'Questo browser non permette di installare l\'app. Aprila in Chrome.': 'This browser cannot install the app. Open it in Chrome.',
  'Apri in Chrome': 'Open in Chrome',
  'Tocca Condividi (il quadrato con la freccia) e poi «Aggiungi alla schermata Home».': 'Tap Share (the square with the arrow) and then "Add to Home Screen".',
  'Per installarla apri il menu ⋮ di Chrome e scegli «Installa app». Se non la vedi, usa Chrome e naviga qualche secondo nell\'app.': 'To install it, open the ⋮ menu in Chrome and choose "Install app". If you do not see it, use Chrome and browse the app for a few seconds.',
  'Installazione in corso…': 'Installing…', 'App installata': 'App installed',
};

// Traduce una chiave (testo italiano). vars: sostituisce {nome}.
function t(key, vars) {
  let s = LANG === 'it' ? key : (EN[key] ?? key);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
// Plurale: tn(3, '{n} spesa', '{n} spese') → "3 spese" / "3 expenses".
const tn = (n, one, many, vars) => t(n === 1 ? one : many, { n, ...vars });
