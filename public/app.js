(function () {
  'use strict';

  // ===== Hilfen =====

  // Gleiche Punktlogik wie src/score.js – für Live-Badge-Updates ohne Reload
  function calcPts(th, ta, rh, ra) {
    if (th == null || ta == null || rh == null || ra == null) return null;
    if (th === rh && ta === ra) return 4;
    var td = th - ta, rd = rh - ra;
    if (Math.sign(td) !== Math.sign(rd)) return 0;
    if (td !== 0 && td === rd) return 3;
    return 2;
  }

  function typingNow() {
    var ae = document.activeElement;
    return !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA'));
  }

  // ===== Tipps automatisch speichern (debounced, delegiert) =====
  var timers = {};

  document.addEventListener('input', function (e) {
    if (!e.target.classList || !e.target.classList.contains('gin') || !e.target.dataset.match) return;
    var id = e.target.dataset.match;
    clearTimeout(timers[id]);
    setState(id, 'Speichern…', true);
    timers[id] = setTimeout(function () { save(id); }, 700);
  });

  function inputs(id) {
    return document.querySelectorAll('.gin[data-match="' + id + '"]');
  }

  function setState(id, text, busy) {
    var el = document.querySelector('.savestate[data-match="' + id + '"]');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('busy', !!busy);
  }

  function save(id) {
    var vals = [];
    inputs(id).forEach(function (i) { vals.push(i.value.trim()); });
    var h = vals[0], a = vals[1];
    if ((h === '') !== (a === '')) {
      setState(id, 'Beide Felder ausfüllen', true);
      return;
    }
    fetch('/api/tip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match: Number(id), home: h, away: a }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) {
          setState(id, j.cleared ? 'Tipp gelöscht' : '✓ Gespeichert');
          var card = document.querySelector('article.match[data-id="' + id + '"]');
          if (card) {
            card.dataset.tipped = j.cleared ? '0' : '1';
            card.dataset.tipH = j.cleared ? '' : h;
            card.dataset.tipA = j.cleared ? '' : a;
          }
        } else if (r.status === 423) {
          setState(id, '🔒 Tippabgabe beendet');
          inputs(id).forEach(function (i) { i.disabled = true; });
        } else if (r.status === 401) {
          location.href = '/login';
        } else {
          setState(id, j.error || 'Fehler beim Speichern', true);
        }
      });
    }).catch(function () {
      setState(id, '⚠ Keine Verbindung', true);
    });
  }

  // ===== Bonustipps speichern =====
  var champSel = document.getElementById('bonus-champion');
  var gerSel = document.getElementById('bonus-germany');

  function saveBonus() {
    var state = document.getElementById('bonus-state');
    if (state) state.textContent = 'Speichern… ';
    fetch('/api/bonus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        champion: champSel ? champSel.value : '',
        germany_round: gerSel ? gerSel.value : '',
      }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!state) return;
        if (r.ok) state.textContent = '✓ Gespeichert. ';
        else state.textContent = (j.error || 'Fehler') + '. ';
      });
    }).catch(function () {
      if (state) state.textContent = '⚠ Keine Verbindung. ';
    });
  }
  if (champSel) champSel.addEventListener('change', saveBonus);
  if (gerSel) gerSel.addEventListener('change', saveBonus);

  // ===== Filter-Chips (delegiert, überleben DOM-Austausch) =====
  document.addEventListener('click', function (e) {
    var f = e.target.closest('.chip[data-filter]');
    if (f) {
      try { localStorage.setItem('tippFilter', f.dataset.filter); } catch (err) {}
      applyFilter(f.dataset.filter);
      return;
    }
    var p = e.target.closest('.chip[data-plan]');
    if (p) setPlanTab(p.dataset.plan);
  });

  function applyFilter(f) {
    document.querySelectorAll('.chip[data-filter]').forEach(function (x) {
      x.classList.toggle('on', x.dataset.filter === f);
    });
    var visible = 0;
    document.querySelectorAll('article.match').forEach(function (m) {
      var st = m.dataset.state;
      var show =
        f === 'alle' ||
        (f === 'offen' && st === 'open') ||
        (f === 'heute' && m.dataset.today === '1') ||
        (f === 'morgen' && m.dataset.tomorrow === '1') ||
        (f === 'ungetippt' && st === 'open' && m.dataset.tipped === '0') ||
        (f === 'beendet' && st !== 'open');
      m.hidden = !show;
      if (show) visible++;
    });
    document.querySelectorAll('.datehead').forEach(function (h) {
      var el = h.nextElementSibling;
      var any = false;
      while (el && !el.classList.contains('datehead')) {
        if (el.matches && el.matches('article.match') && !el.hidden) any = true;
        el = el.nextElementSibling;
      }
      h.hidden = !any;
    });
    var empty = document.querySelector('.filter-empty');
    if (empty) empty.hidden = visible > 0;
  }

  function setPlanTab(t) {
    document.querySelectorAll('.chip[data-plan]').forEach(function (x) {
      x.classList.toggle('on', x.dataset.plan === t);
    });
    var g = document.getElementById('plan-gruppen');
    var k = document.getElementById('plan-ko');
    if (g) g.hidden = t !== 'gruppen';
    if (k) k.hidden = t !== 'ko';
  }

  if (document.querySelector('.chip[data-filter]')) {
    var saved = 'offen';
    try { saved = localStorage.getItem('tippFilter') || 'offen'; } catch (e) {}
    if (!document.querySelector('.chip[data-filter="' + saved + '"]')) saved = 'offen';
    applyFilter(saved);
  }

  // ===== Lösch-Bestätigungen (delegiert) =====
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.classList && f.classList.contains('confirm') && !confirm(f.dataset.msg || 'Wirklich?')) {
      e.preventDefault();
    }
  });

  // ===== Live-Updates per SSE-Push =====
  if (document.querySelector('nav.bottom')) initLive();

  function initLive() {
    var last = null;
    var swapping = false;
    var lastReload = 0;

    function handle(text) {
      if (text == null || text === last) return;
      var data;
      try { data = JSON.parse(text); } catch (e) { return; }
      last = text;
      if (document.querySelector('article.match[data-id]')) {
        updateIndex(data);
      } else if (document.getElementById('plan-gruppen') || document.querySelector('.board') || document.querySelector('article.match.detail')) {
        swapContent();
      }
      // Admin-Seiten: bewusst keine Auto-Aktualisierung (Formulareingaben)
    }

    // Tippen-Seite: Tore/Punkte in den Karten direkt aktualisieren;
    // bei Struktur-Änderungen (Anpfiff, erstes Tor, Abpfiff) einmal neu laden.
    function updateIndex(data) {
      var reloadNeeded = false;
      data.m.forEach(function (m) {
        var card = document.querySelector('article.match[data-id="' + m.id + '"]');
        if (!card) return;
        var hasRes = m.h != null && m.a != null;
        var state = m.l === 1 ? (hasRes && m.s !== 'live' ? 'finished' : 'locked') : 'open';
        if (state !== card.dataset.state || (hasRes ? '1' : '0') !== card.dataset.hasres) {
          reloadNeeded = true;
          return;
        }
        if (state === 'open' || !hasRes) return;
        if (m.fh != null && !card.querySelector('.sub90')) { reloadNeeded = true; return; }

        var gres = card.querySelectorAll('.gres');
        if (gres.length === 2) {
          var dh = String(m.fh != null ? m.fh : m.h);
          var da = String(m.fa != null ? m.fa : m.a);
          if (gres[0].textContent !== dh) gres[0].textContent = dh;
          if (gres[1].textContent !== da) gres[1].textContent = da;
        }
        if (card.dataset.tipH !== '' && card.dataset.tipH !== undefined) {
          var p = calcPts(Number(card.dataset.tipH), Number(card.dataset.tipA), m.h, m.a);
          var badge = card.querySelector('.mfoot .badge');
          if (badge && p != null) {
            badge.textContent = '+' + p;
            badge.className = 'badge p' + p;
          }
        }
      });
      if (reloadNeeded) scheduleReload();
    }

    // Spielplan / Tabelle / Spiel-Detail: Seiteninhalt neu holen und austauschen
    // (keine Eingabefelder -> gefahrlos, kein Flackern, Scrollposition bleibt)
    function swapContent() {
      if (swapping) return;
      swapping = true;
      fetch(location.pathname + location.search, { headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (t) {
          if (!t) return;
          var doc = new DOMParser().parseFromString(t, 'text/html');
          var fresh = doc.querySelector('.wrap');
          var cur = document.querySelector('.wrap');
          if (!fresh || !cur) return;
          var planOn = document.querySelector('.chip[data-plan].on');
          var planTab = planOn ? planOn.dataset.plan : null;
          cur.innerHTML = fresh.innerHTML;
          if (planTab) setPlanTab(planTab);
        })
        .catch(function () {})
        .then(function () { swapping = false; });
    }

    function scheduleReload() {
      if (typingNow()) { setTimeout(scheduleReload, 3000); return; }
      if (Date.now() - lastReload < 5000) return;
      lastReload = Date.now();
      location.reload();
    }

    // SSE-Verbindung (Browser reconnectet automatisch, auch nach App-Wechsel)
    var es = null;
    if (window.EventSource) {
      es = new EventSource('/api/live');
      es.onmessage = function (ev) { handle(ev.data); };
    }

    function refresh() {
      fetch('/api/scores', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(handle)
        .catch(function () {});
    }

    // Zurück in die App gewechselt -> sofort aktualisieren (wichtig auf Mobile)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh();
    });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) refresh(); // aus dem Back-Forward-Cache zurückgeholt
    });

    // Fallback, falls SSE nicht verfügbar/verbunden ist
    setInterval(function () {
      if (!es || es.readyState !== 1) refresh();
    }, 60000);
  }
})();
