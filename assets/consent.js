/* Pennylog: consenso ai cookie e Google Analytics.
 * Si usa solo sulle pagine del sito (landing, privacy, termini, cookie). NON è caricato nell'app (/app/).
 *
 * - Google Analytics (GA4) non viene caricato finché l'utente non acconsente.
 * - Consent Mode v2: tutto "negato" di default, solo analytics_storage passa a "granted" con il consenso.
 * - Accetta e Rifiuta hanno lo stesso peso visivo; la scelta si può cambiare in ogni momento
 *   dal link "Impostazioni cookie" e viene richiesta di nuovo dopo 6 mesi.
 * - Se il browser invia Global Privacy Control, l'analisi resta disattivata e il banner non compare.
 */
(function () {
  'use strict';

  var GA_ID = 'G-GJSYVKX67S';
  var KEY = 'pl_consent';
  var SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;

  var lang = /^it/i.test(document.documentElement.lang || '') ? 'it' : 'en';
  var LEGAL = lang === 'it' ? { cookies: '/it/cookies.html', privacy: '/it/privacy.html' } : { cookies: '/cookies.html', privacy: '/privacy.html' };

  var TXT = {
    en: {
      bannerTitle: 'Cookies on this website',
      bannerText: 'We use Google Analytics, only if you agree, to understand how this website is used. Strictly necessary storage is always on. The Pennylog app does not use cookies for statistics or advertising.',
      cookiePolicy: 'Cookie Policy', privacyPolicy: 'Privacy Policy',
      reject: 'Reject all', customize: 'Customize', accept: 'Accept all',
      prefsTitle: 'Cookie preferences', save: 'Save preferences', close: 'Close',
      necessary: 'Strictly necessary', alwaysOn: 'Always on',
      necessaryText: 'Remembers your cookie choice on this device. It does not identify you and is not used for statistics.',
      analytics: 'Analytics (Google Analytics)',
      analyticsText: 'Measures visits and page views in aggregate form, to improve the website. Sets the cookies _ga and _ga_GJSYVKX67S. Off unless you allow it.',
      on: 'On', off: 'Off'
    },
    it: {
      bannerTitle: 'Cookie su questo sito',
      bannerText: 'Usiamo Google Analytics, solo se acconsenti, per capire come viene usato il sito. Le memorizzazioni strettamente necessarie sono sempre attive. L\'app Pennylog non usa cookie per statistiche o pubblicità.',
      cookiePolicy: 'Cookie Policy', privacyPolicy: 'Privacy Policy',
      reject: 'Rifiuta tutti', customize: 'Personalizza', accept: 'Accetta tutti',
      prefsTitle: 'Preferenze sui cookie', save: 'Salva le preferenze', close: 'Chiudi',
      necessary: 'Strettamente necessari', alwaysOn: 'Sempre attivi',
      necessaryText: 'Ricordano la tua scelta sui cookie su questo dispositivo. Non ti identificano e non servono per le statistiche.',
      analytics: 'Statistiche (Google Analytics)',
      analyticsText: 'Misurano visite e pagine viste in forma aggregata, per migliorare il sito. Impostano i cookie _ga e _ga_GJSYVKX67S. Disattivati se non li consenti.',
      on: 'Attivo', off: 'Disattivo'
    }
  }[lang];

  // Consent Mode: tutto negato finché l'utente non sceglie
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
  gtag('set', 'ads_data_redaction', true);
  gtag('js', new Date());

  // ---------- scelta salvata ----------
  function readChoice() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY));
      if (v && v.v === 1 && typeof v.analytics === 'boolean' && Date.now() - v.ts < SIX_MONTHS) return v;
    } catch (e) { /* storage non disponibile */ }
    return null;
  }
  function saveChoice(analytics) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, analytics: !!analytics, ts: Date.now() })); } catch (e) { /* ignora */ }
  }

  // ---------- Google Analytics ----------
  var gaLoaded = false;
  function loadGA() {
    if (gaLoaded) return;
    gaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    gtag('config', GA_ID, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
  }

  function deleteGaCookies() {
    var names = ['_ga', '_gid', '_gat', '_ga_' + GA_ID.replace(/^G-/, '')];
    var host = location.hostname;
    var parts = host.split('.');
    var domains = [host, '.' + host];
    if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    names.forEach(function (n) {
      domains.forEach(function (d) {
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + d;
      });
      document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });
  }

  function apply(analytics) {
    gtag('consent', 'update', { analytics_storage: analytics ? 'granted' : 'denied' });
    if (analytics) {
      window['ga-disable-' + GA_ID] = false;
      loadGA();
    } else {
      window['ga-disable-' + GA_ID] = true;
      deleteGaCookies();
    }
  }

  // ---------- interfaccia ----------
  function h(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  var banner = null;
  var prefs = null;

  function closeBanner() { if (banner) { banner.remove(); banner = null; } }

  function choose(analytics) {
    saveChoice(analytics);
    apply(analytics);
    closeBanner();
    if (prefs) { prefs.close(); prefs.remove(); prefs = null; }
  }

  function showBanner() {
    if (banner || prefs) return;
    banner = h('<div class="plc-banner" role="region" aria-label="' + TXT.bannerTitle + '">' +
      '<div class="plc-text"><b>' + TXT.bannerTitle + '</b><p>' + TXT.bannerText + ' ' +
      '<a href="' + LEGAL.cookies + '">' + TXT.cookiePolicy + '</a> · <a href="' + LEGAL.privacy + '">' + TXT.privacyPolicy + '</a></p></div>' +
      '<div class="plc-actions">' +
      '<button type="button" class="plc-btn" data-plc="reject">' + TXT.reject + '</button>' +
      '<button type="button" class="plc-btn" data-plc="customize">' + TXT.customize + '</button>' +
      '<button type="button" class="plc-btn" data-plc="accept">' + TXT.accept + '</button>' +
      '</div></div>');
    document.body.appendChild(banner);
  }

  function openPrefs() {
    if (prefs) return;
    var current = readChoice();
    var on = !!(current && current.analytics);
    prefs = h('<dialog class="plc-prefs" aria-labelledby="plc-title">' +
      '<button type="button" class="plc-x" data-plc="close" aria-label="' + TXT.close + '">×</button>' +
      '<h2 id="plc-title">' + TXT.prefsTitle + '</h2>' +
      '<div class="plc-row"><div><b>' + TXT.necessary + '</b><p>' + TXT.necessaryText + '</p></div><span class="plc-fixed">' + TXT.alwaysOn + '</span></div>' +
      '<div class="plc-row"><div><b>' + TXT.analytics + '</b><p>' + TXT.analyticsText + '</p></div>' +
      '<label class="plc-switch"><input type="checkbox" id="plc-an"' + (on ? ' checked' : '') + '><span class="plc-track"></span><span class="plc-state">' + (on ? TXT.on : TXT.off) + '</span></label></div>' +
      '<p class="plc-links"><a href="' + LEGAL.cookies + '">' + TXT.cookiePolicy + '</a> · <a href="' + LEGAL.privacy + '">' + TXT.privacyPolicy + '</a></p>' +
      '<div class="plc-actions">' +
      '<button type="button" class="plc-btn" data-plc="reject">' + TXT.reject + '</button>' +
      '<button type="button" class="plc-btn" data-plc="save">' + TXT.save + '</button>' +
      '<button type="button" class="plc-btn" data-plc="accept">' + TXT.accept + '</button>' +
      '</div></dialog>');
    document.body.appendChild(prefs);
    var box = prefs.querySelector('#plc-an');
    box.addEventListener('change', function () { prefs.querySelector('.plc-state').textContent = box.checked ? TXT.on : TXT.off; });
    prefs.addEventListener('cancel', function (e) { e.preventDefault(); closePrefs(); });
    prefs.showModal();
  }

  function closePrefs() {
    if (!prefs) return;
    prefs.close();
    prefs.remove();
    prefs = null;
    if (!readChoice() && !banner) showBanner();
  }

  document.addEventListener('click', function (e) {
    var open = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (open) { e.preventDefault(); closeBanner(); openPrefs(); return; }
    var b = e.target.closest && e.target.closest('[data-plc]');
    if (!b) return;
    var a = b.getAttribute('data-plc');
    if (a === 'accept') choose(true);
    else if (a === 'reject') choose(false);
    else if (a === 'save') choose(!!prefs.querySelector('#plc-an').checked);
    else if (a === 'customize') { closeBanner(); openPrefs(); }
    else if (a === 'close') closePrefs();
  });

  // ---------- avvio ----------
  function start() {
    var saved = readChoice();
    if (saved) { apply(saved.analytics); return; }
    if (navigator.globalPrivacyControl === true) { apply(false); return; } // segnale di rifiuto del browser
    apply(false);
    showBanner();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  window.PennylogConsent = { open: openPrefs };
})();
