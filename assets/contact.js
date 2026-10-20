(function () {
  var f = document.getElementById('form');
  if (!f) return;
  var st = document.getElementById('status');
  var ts = f.elements.ts;
  ts.value = String(Date.now());
  function say(msg, ok) { st.hidden = false; st.textContent = msg; st.className = 'cstatus ' + (ok ? 'ok' : 'bad'); st.scrollIntoView({ block: 'nearest' }); }
  var q = new URLSearchParams(location.search).get('status');
  if (q) { var m = { ok: 'data-ok', error: 'data-err', invalid: 'data-invalid', wait: 'data-wait' }[q]; if (m) say(f.getAttribute(m), q === 'ok'); }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = f.querySelector('button[type=submit]'), label = btn.textContent;
    if (!f.checkValidity()) { say(f.getAttribute('data-invalid'), false); f.reportValidity && f.reportValidity(); return; }
    btn.disabled = true; btn.textContent = f.getAttribute('data-sending');
    fetch(f.action, { method: 'POST', body: new URLSearchParams(new FormData(f)), headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.json().catch(function () { return { status: 'error' }; }); })
      .then(function (j) {
        var s = j && j.status;
        if (s === 'ok') { f.reset(); ts.value = String(Date.now()); }
        say(f.getAttribute({ ok: 'data-ok', invalid: 'data-invalid', wait: 'data-wait' }[s] || 'data-err'), s === 'ok');
      })
      .catch(function () { say(f.getAttribute('data-err'), false); })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });
})();
